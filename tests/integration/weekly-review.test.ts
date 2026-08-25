import { describe, expect, it } from 'vitest';

import { createTestSystem } from '../../packages/backend/src/index.js';

describe('weekly review API', () => {
  it('rejects AI generation before Sunday 19:00 and allows rules generation after', async () => {
    const friday = Date.parse('2026-08-21T12:00:00+08:00');
    const system = createTestSystem({ now: friday });
    const user = await system.login('weekly-user');

    await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'wr-task-1',
      body: {
        title: '高优事项',
        priority: 'HIGH',
        dueAt: Date.parse('2026-08-18T10:00:00+08:00'),
        dueHasTime: true,
        tagIds: []
      }
    });

    const blocked = await system.request({
      method: 'POST',
      path: '/v1/weekly-reviews/generate',
      token: user.token,
      requestId: 'wr-gen-blocked',
      body: { weekStart: '2026-08-17' }
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.success).toBe(false);

    system.setNow(Date.parse('2026-08-23T19:05:00+08:00'));
    const generated = await system.request({
      method: 'POST',
      path: '/v1/weekly-reviews/generate',
      token: user.token,
      requestId: 'wr-gen-ok',
      body: { weekStart: '2026-08-17' }
    });
    expect(generated.status).toBe(200);
    expect(generated.body.success && generated.body.data.source).toBe('rules');
    expect(generated.body.success && generated.body.data.summary.length).toBeGreaterThan(0);

    const current = await system.request({
      method: 'GET',
      path: '/v1/weekly-reviews/current',
      token: user.token
    });
    expect(current.status).toBe(200);
    expect(current.body.success && current.body.data.weekStart).toBe('2026-08-17');
    expect(current.body.success && current.body.data.aiAllowed).toBe(true);
    expect(current.body.success && current.body.data.review?.source).toBe('rules');
  });

  it('uses model output when LLM client succeeds', async () => {
    let capturedTaskId = '';
    const system = createTestSystem({
      now: Date.parse('2026-08-24T10:00:00+08:00'),
      generateWeeklyReviewWithLlm: (facts) =>
        Promise.resolve({
          summary: '模型摘要：本周节奏偏紧。',
          improvements: [
            {
              type: 'HIGH_PRIORITY_OPEN' as const,
              severity: 'high' as const,
              title: '高优未完成',
              rationale: `备注是否送达：${facts.tasks[0]?.notes ?? ''}`,
              suggestion: '明天优先处理',
              taskIds: [capturedTaskId]
            }
          ],
          highlights: [],
          model: 'test-model'
        })
    });
    const user = await system.login('weekly-llm');
    const created = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'wr-llm-task',
      body: {
        title: '模型任务',
        priority: 'HIGH',
        dueAt: Date.parse('2026-08-18T10:00:00+08:00'),
        dueHasTime: true,
        notes: '备注送模',
        tagIds: []
      }
    });
    capturedTaskId = created.body.success ? created.body.data.id : '';

    const generated = await system.request({
      method: 'POST',
      path: '/v1/weekly-reviews/generate',
      token: user.token,
      requestId: 'wr-llm-gen',
      body: { weekStart: '2026-08-17' }
    });
    expect(generated.status).toBe(200);
    expect(generated.body.success && generated.body.data.source).toBe('model');
    expect(generated.body.success && generated.body.data.model).toBe('test-model');
    expect(generated.body.success && generated.body.data.improvements[0]?.taskIds).toEqual([
      capturedTaskId
    ]);
    expect(generated.body.success && generated.body.data.improvements[0]?.rationale).toContain(
      '备注送模'
    );
  });
});
