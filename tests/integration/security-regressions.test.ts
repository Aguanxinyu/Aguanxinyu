import { describe, expect, it } from 'vitest';

import { createTestSystem } from '../../packages/backend/src/index.js';

describe('security and idempotency regressions', () => {
  it('issues opaque unique session tokens', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });

    const first = await system.login('secure-user');
    const second = await system.login('secure-user');

    expect(first.userId).toBe(second.userId);
    expect(first.token).not.toBe(second.token);
    expect(first.token.length).toBeGreaterThanOrEqual(40);
    expect(first.token).not.toContain(first.userId);
  });

  it('scopes idempotency keys to the method and route', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login('scope-user');

    const list = await system.request({
      method: 'POST',
      path: '/v1/lists',
      token: user.token,
      requestId: 'shared-id',
      body: { name: '工作' }
    });
    const task = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'shared-id',
      body: {
        title: '不同路由',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: []
      }
    });

    expect(list.status).toBe(201);
    expect(task.status).toBe(201);
    expect(task.body.success && task.body.data.title).toBe('不同路由');
  });

  it('claims an idempotency key before executing concurrent writes', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login('concurrent-idempotency-user');
    const request = {
      method: 'POST' as const,
      path: '/v1/tasks',
      token: user.token,
      requestId: 'same-concurrent-id',
      body: {
        title: '只能创建一次',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: []
      }
    };

    const results = await Promise.all([system.request(request), system.request(request)]);
    const tasks = await system.database.tasksForUser(user.userId);

    expect(tasks).toHaveLength(1);
    expect(results.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(
      results.some(({ body }) => !body.success && body.error.code === 'REQUEST_IN_PROGRESS')
    ).toBe(true);
  });

  it('does not let one user PATCH another user todo', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const alice = await system.login('alice');
    const bob = await system.login('bob');
    const created = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: alice.token,
      requestId: 'alice-task',
      body: {
        title: 'Alice private task',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: []
      }
    });
    const taskId = created.body.success ? created.body.data.id : '';
    const version = created.body.success ? created.body.data.version : 0;

    const response = await system.request({
      method: 'PATCH',
      path: `/v1/tasks/${taskId}`,
      token: bob.token,
      requestId: 'bob-patch',
      body: { version, title: 'hacked' }
    });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'TASK_NOT_FOUND' }
    });
  });

  it('does not persist a task when reminder validation fails', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = createTestSystem({ now });
    const user = await system.login('atomic-user');

    const rejected = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'invalid-reminder',
      body: {
        title: '提醒太晚',
        priority: 'MEDIUM',
        dueAt: now + 9 * 60 * 1000,
        dueHasTime: true,
        reminderEnabled: true,
        tagIds: []
      }
    });
    expect(rejected.status).toBe(409);

    const tasks = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: user.token
    });
    expect(tasks.body.success && tasks.body.data).toEqual([]);
  });

  it('does not cache validation failures and caps reminder grants', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login('retry-user');

    const invalid = await system.request({
      method: 'POST',
      path: '/v1/lists',
      token: user.token,
      requestId: 'retry-list',
      body: { name: '' }
    });
    expect(invalid.status).toBe(400);

    const retried = await system.request({
      method: 'POST',
      path: '/v1/lists',
      token: user.token,
      requestId: 'retry-list',
      body: { name: '重试成功' }
    });
    expect(retried.status).toBe(201);

    let available = 0;
    for (let index = 0; index < 25; index += 1) {
      const grant = await system.request({
        method: 'POST',
        path: '/v1/reminder-grants',
        token: user.token,
        requestId: `grant-${String(index)}`,
        body: { accepted: true }
      });
      available = grant.body.success ? grant.body.data.available : available;
    }
    expect(available).toBe(20);
  });
});
