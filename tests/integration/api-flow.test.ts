import { describe, expect, it } from 'vitest';

import { createTestSystem } from '../../packages/backend/src/index.js';

describe('authenticated todo API flow', () => {
  it('creates, completes, trashes, and restores a todo idempotently', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const login = await system.request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { code: 'alice' }
    });
    expect(login.status).toBe(200);
    const token = login.body.success ? login.body.data.token : '';

    const createRequest = {
      method: 'POST' as const,
      path: '/v1/tasks',
      token,
      requestId: 'create-1',
      body: {
        title: '提交项目资料',
        priority: 'HIGH',
        dueHasTime: false,
        tagIds: []
      }
    } as const;
    const created = await system.request(createRequest);
    const duplicated = await system.request(createRequest);

    expect(created.status).toBe(201);
    expect(duplicated.body).toEqual(created.body);
    const taskId = created.body.success ? created.body.data.id : '';

    const listed = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token
    });
    expect(listed.body.success && listed.body.data).toHaveLength(1);

    const completed = await system.request({
      method: 'POST',
      path: `/v1/tasks/${taskId}/complete`,
      token,
      requestId: 'complete-1'
    });
    expect(completed.body.success && completed.body.data.status).toBe('DONE');

    const removed = await system.request({
      method: 'DELETE',
      path: `/v1/tasks/${taskId}`,
      token,
      requestId: 'delete-1'
    });
    expect(removed.body.success && removed.body.data.status).toBe('TRASHED');

    const trash = await system.request({
      method: 'GET',
      path: '/v1/trash',
      token
    });
    expect(trash.body.success && trash.body.data).toHaveLength(1);

    const restored = await system.request({
      method: 'POST',
      path: `/v1/trash/${taskId}/restore`,
      token,
      requestId: 'restore-1'
    });
    expect(restored.body.success && restored.body.data.status).toBe('DONE');
  });

  it('prevents one user from reading another user todo', async () => {
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

    const response = await system.request({
      method: 'GET',
      path: `/v1/tasks/${taskId}`,
      token: bob.token
    });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'TASK_NOT_FOUND' }
    });
  });

  it('manages lists and moves tasks to inbox when a list is deleted', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login('list-user');
    const list = await system.request({
      method: 'POST',
      path: '/v1/lists',
      token: user.token,
      requestId: 'list-1',
      body: { name: '工作' }
    });
    const listId = list.body.success ? list.body.data.id : '';
    const task = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'task-1',
      body: {
        title: '清单任务',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: [],
        listId
      }
    });
    const taskId = task.body.success ? task.body.data.id : '';

    expect(
      (
        await system.request({
          method: 'DELETE',
          path: `/v1/lists/${listId}`,
          token: user.token,
          requestId: 'delete-list'
        })
      ).status
    ).toBe(204);

    const moved = await system.request({
      method: 'GET',
      path: `/v1/tasks/${taskId}`,
      token: user.token
    });
    expect(moved.body.success && moved.body.data.listId).toBe('inbox');
  });

  it('revokes every session immediately when account deletion starts', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const first = await system.login('delete-user');
    const second = await system.login('delete-user');

    const deletion = await system.request({
      method: 'POST',
      path: '/v1/account/deletion',
      token: first.token,
      requestId: 'delete-account'
    });
    expect(deletion.status).toBe(202);

    const oldSession = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: second.token
    });
    expect(oldSession.status).toBe(401);
  });
});
