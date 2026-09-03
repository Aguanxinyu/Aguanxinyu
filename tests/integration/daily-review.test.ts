import { describe, expect, it } from 'vitest';

import { createTestSystem } from '../../packages/backend/src/index.js';

const NOW = Date.parse('2026-09-03T20:00:00+08:00');
const DATE = '2026-09-03';

async function seedTask(system: ReturnType<typeof createTestSystem>, token: string) {
  return system.request({
    method: 'POST',
    path: '/v1/tasks',
    token,
    requestId: 'daily-task',
    body: {
      title: '整理每日总结',
      notes: '包含任务详细内容',
      priority: 'HIGH',
      dueAt: Date.parse('2026-09-03T18:00:00+08:00'),
      dueHasTime: true,
      tagIds: []
    }
  });
}

describe('daily review API', () => {
  it('manually generates a rules review and marks it stale after task changes', async () => {
    const system = createTestSystem({ now: NOW });
    const user = await system.login('daily-rules-user');
    const task = await seedTask(system, user.token);

    const initial = await system.request({
      method: 'GET',
      path: '/v1/daily-reviews',
      token: user.token,
      query: { date: DATE }
    });
    expect(initial.body.success && initial.body.data).toMatchObject({
      date: DATE,
      needsRefresh: false,
      stats: { total: 1, open: 1 },
      review: null
    });

    const generated = await system.request({
      method: 'POST',
      path: '/v1/daily-reviews/generate',
      token: user.token,
      requestId: 'generate-daily',
      body: { date: DATE }
    });
    expect(generated.body.success && generated.body.data).toMatchObject({
      source: 'rules',
      generationCount: 1
    });
    expect(generated.body.success && generated.body.data.summary).toContain('共安排 1 项');

    const cached = await system.request({
      method: 'POST',
      path: '/v1/daily-reviews/generate',
      token: user.token,
      requestId: 'generate-daily-cached',
      body: { date: DATE }
    });
    expect(cached.body.success && cached.body.data.generationCount).toBe(1);

    await system.request({
      method: 'POST',
      path: `/v1/tasks/${task.body.success ? task.body.data.id : ''}/complete`,
      token: user.token,
      requestId: 'complete-daily-task'
    });
    const stale = await system.request({
      method: 'GET',
      path: '/v1/daily-reviews',
      token: user.token,
      query: { date: DATE }
    });
    expect(stale.body.success && stale.body.data.needsRefresh).toBe(true);
  });

  it('uses model content when available and rules when the model fails', async () => {
    const modelSystem = createTestSystem({
      now: NOW,
      generateDailyReviewWithLlm: (facts) =>
        Promise.resolve({
          summary: `模型总结 ${facts.tasks[0]?.notes ?? ''}`,
          highlights: [],
          blockers: [],
          tomorrowSuggestions: [],
          model: 'test-model'
        })
    });
    const modelUser = await modelSystem.login('daily-model-user');
    await seedTask(modelSystem, modelUser.token);
    const modelReview = await modelSystem.request({
      method: 'POST',
      path: '/v1/daily-reviews/generate',
      token: modelUser.token,
      requestId: 'daily-model',
      body: { date: DATE }
    });
    expect(modelReview.body.success && modelReview.body.data).toMatchObject({
      source: 'model',
      model: 'test-model'
    });
    expect(modelReview.body.success && modelReview.body.data.summary).toContain('包含任务详细内容');

    const fallbackSystem = createTestSystem({
      now: NOW,
      generateDailyReviewWithLlm: () => Promise.resolve(null)
    });
    const fallbackUser = await fallbackSystem.login('daily-fallback-user');
    await seedTask(fallbackSystem, fallbackUser.token);
    const fallback = await fallbackSystem.request({
      method: 'POST',
      path: '/v1/daily-reviews/generate',
      token: fallbackUser.token,
      requestId: 'daily-fallback',
      body: { date: DATE }
    });
    expect(fallback.body.success && fallback.body.data.source).toBe('rules');
  });

  it('rejects future, empty, and excessive generation requests', async () => {
    const system = createTestSystem({ now: NOW });
    const user = await system.login('daily-limits-user');
    const empty = await system.request({
      method: 'POST',
      path: '/v1/daily-reviews/generate',
      token: user.token,
      requestId: 'daily-empty',
      body: { date: DATE }
    });
    expect(empty.status).toBe(400);
    const future = await system.request({
      method: 'GET',
      path: '/v1/daily-reviews',
      token: user.token,
      query: { date: '2026-09-04' }
    });
    expect(future.status).toBe(400);

    await seedTask(system, user.token);
    for (let index = 0; index < 3; index += 1) {
      const generated = await system.request({
        method: 'POST',
        path: '/v1/daily-reviews/generate',
        token: user.token,
        requestId: `daily-force-${String(index)}`,
        body: { date: DATE, force: true }
      });
      expect(generated.status).toBe(200);
    }
    const limited = await system.request({
      method: 'POST',
      path: '/v1/daily-reviews/generate',
      token: user.token,
      requestId: 'daily-force-limited',
      body: { date: DATE, force: true }
    });
    expect(limited.status).toBe(429);
  });
});
