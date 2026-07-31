import { describe, expect, it } from 'vitest';

import { createTestSystem } from '../../packages/backend/src/index.js';

describe('API validation and resource boundaries', () => {
  it('returns stable errors for authentication, routing, and request identifiers', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });

    const anonymous = await system.request({
      method: 'GET',
      path: '/v1/tasks'
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({
      success: false,
      error: { code: 'AUTH_REQUIRED' }
    });

    const malformedLogin = await system.request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { code: '' }
    });
    expect(malformedLogin.status).toBe(400);
    expect(malformedLogin.body).toMatchObject({
      success: false,
      error: { code: 'INPUT_INVALID' }
    });

    const user = await system.login('boundary-user');
    const missingRequestId = await system.request({
      method: 'POST',
      path: '/v1/lists',
      token: user.token,
      body: { name: '工作' }
    });
    expect(missingRequestId.status).toBe(400);
    expect(missingRequestId.body).toMatchObject({
      success: false,
      error: { code: 'REQUEST_ID_REQUIRED' }
    });

    const unknown = await system.request({
      method: 'GET',
      path: '/v1/unknown',
      token: user.token
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({
      success: false,
      error: { code: 'ROUTE_NOT_FOUND' }
    });
  });

  it.each([
    [
      {
        title: '',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: []
      },
      'TITLE_REQUIRED'
    ],
    [
      {
        title: '缺少时间',
        priority: 'MEDIUM',
        dueHasTime: true,
        tagIds: []
      },
      'DUE_AT_REQUIRED'
    ],
    [
      {
        title: '未知清单',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: [],
        listId: 'missing-list'
      },
      'LIST_NOT_FOUND'
    ],
    [
      {
        title: '未知标签',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: ['missing-tag']
      },
      'TAG_NOT_FOUND'
    ]
  ] as const)('rejects invalid task input %#', async (body, code) => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login(`validation-${code}`);

    const response = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: code,
      body
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code }
    });
  });

  it('creates and deletes tags while detaching them from tasks', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login('tag-user');
    const tag = await system.request({
      method: 'POST',
      path: '/v1/tags',
      token: user.token,
      requestId: 'tag-1',
      body: { name: '重要', color: '#2563EB' }
    });
    const tagId = tag.body.success ? tag.body.data.id : '';
    const task = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'task-1',
      body: {
        title: '带标签任务',
        priority: 'HIGH',
        dueHasTime: false,
        tagIds: [tagId]
      }
    });
    const taskId = task.body.success ? task.body.data.id : '';

    const tags = await system.request({
      method: 'GET',
      path: '/v1/tags',
      token: user.token
    });
    expect(tags.body.success && tags.body.data).toHaveLength(1);

    expect(
      (
        await system.request({
          method: 'DELETE',
          path: `/v1/tags/${tagId}`,
          token: user.token,
          requestId: 'delete-tag'
        })
      ).status
    ).toBe(204);

    const updatedTask = await system.request({
      method: 'GET',
      path: `/v1/tasks/${taskId}`,
      token: user.token
    });
    expect(updatedTask.body.success && updatedTask.body.data.tagIds).toEqual([]);
  });

  it('protects the inbox and returns not-found for missing resources', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login('missing-user');

    const inbox = await system.request({
      method: 'DELETE',
      path: '/v1/lists/inbox',
      token: user.token,
      requestId: 'delete-inbox'
    });
    expect(inbox.status).toBe(409);
    expect(inbox.body).toMatchObject({
      success: false,
      error: { code: 'INBOX_IMMUTABLE' }
    });

    const missingTask = await system.request({
      method: 'POST',
      path: '/v1/tasks/missing/complete',
      token: user.token,
      requestId: 'missing-task'
    });
    expect(missingTask.status).toBe(404);
    expect(missingTask.body).toMatchObject({
      success: false,
      error: { code: 'TASK_NOT_FOUND' }
    });
  });
});
