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

  it('edits a task with PATCH and syncs its reminder', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = createTestSystem({ now });
    const user = await system.login('edit-user');
    const created = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'create-1',
      body: {
        title: '原始标题',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: []
      }
    });
    expect(created.status).toBe(201);
    const taskId = created.body.success ? created.body.data.id : '';
    const version = created.body.success ? created.body.data.version : 0;

    const edited = await system.request({
      method: 'PATCH',
      path: `/v1/tasks/${taskId}`,
      token: user.token,
      requestId: 'patch-1',
      body: {
        version,
        title: '新标题',
        priority: 'HIGH',
        dueAt: now + 60 * 60 * 1000,
        dueHasTime: true,
        reminderEnabled: true
      }
    });
    expect(edited.status).toBe(200);
    expect(edited.body.success && edited.body.data).toMatchObject({
      title: '新标题',
      priority: 'HIGH',
      dueAt: now + 60 * 60 * 1000,
      dueHasTime: true,
      version: version + 1,
      remindAt: now + 50 * 60 * 1000
    });

    const newVersion = edited.body.success ? edited.body.data.version : 0;
    const disabled = await system.request({
      method: 'PATCH',
      path: `/v1/tasks/${taskId}`,
      token: user.token,
      requestId: 'patch-2',
      body: {
        version: newVersion,
        reminderEnabled: false
      }
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.success && disabled.body.data.remindAt).toBeUndefined();
  });

  it('clears optional task fields explicitly with null', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = createTestSystem({ now });
    const user = await system.login('clear-fields-user');
    const created = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'create-fields',
      body: {
        title: '清空字段',
        notes: '旧备注',
        priority: 'MEDIUM',
        startAt: now + 30 * 60 * 1000,
        startHasTime: true,
        dueAt: now + 60 * 60 * 1000,
        dueHasTime: true,
        location: { source: 'MANUAL', name: '旧地点' },
        tagIds: []
      }
    });
    const task = created.body.success ? created.body.data : undefined;

    const cleared = await system.request({
      method: 'PATCH',
      path: `/v1/tasks/${task?.id ?? ''}`,
      token: user.token,
      requestId: 'clear-fields',
      body: {
        version: task?.version ?? 0,
        notes: null,
        startAt: null,
        startHasTime: false,
        dueAt: null,
        dueHasTime: false,
        location: null
      }
    });

    expect(cleared.status).toBe(200);
    expect(cleared.body.success && cleared.body.data).not.toHaveProperty('notes');
    expect(cleared.body.success && cleared.body.data).not.toHaveProperty('startAt');
    expect(cleared.body.success && cleared.body.data).not.toHaveProperty('dueAt');
    expect(cleared.body.success && cleared.body.data).not.toHaveProperty('location');
  });

  it('rejects a PATCH that carries a stale version', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login('stale-version-user');
    const created = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'create-1',
      body: {
        title: '冲突目标',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: []
      }
    });
    const taskId = created.body.success ? created.body.data.id : '';

    await system.request({
      method: 'PATCH',
      path: `/v1/tasks/${taskId}`,
      token: user.token,
      requestId: 'patch-1',
      body: { version: 1, title: '第一次修改' }
    });

    const stale = await system.request({
      method: 'PATCH',
      path: `/v1/tasks/${taskId}`,
      token: user.token,
      requestId: 'patch-2',
      body: { version: 1, title: '冲突修改' }
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      success: false,
      error: { code: 'VERSION_CONFLICT' }
    });

    const current = await system.request({
      method: 'GET',
      path: `/v1/tasks/${taskId}`,
      token: user.token
    });
    expect(current.body.success && current.body.data.title).toBe('第一次修改');
  });

  it('allows only one concurrent PATCH for the same task version', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login('concurrent-version-user');
    const created = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'create-concurrent',
      body: {
        title: '并发目标',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: []
      }
    });
    const taskId = created.body.success ? created.body.data.id : '';
    const version = created.body.success ? created.body.data.version : 0;
    const update = (title: string, requestId: string) =>
      system.request({
        method: 'PATCH' as const,
        path: `/v1/tasks/${taskId}`,
        token: user.token,
        requestId,
        body: { version, title }
      });

    const responses = await Promise.all([
      update('并发修改 A', 'concurrent-a'),
      update('并发修改 B', 'concurrent-b')
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect((await system.database.findTask(user.userId, taskId))?.version).toBe(version + 1);
  });

  it('accepts a POST with an X-HTTP-Method-Override header as an update', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login('override-user');
    const created = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'create-1',
      body: {
        title: '覆盖前',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: []
      }
    });
    const taskId = created.body.success ? created.body.data.id : '';
    const version = created.body.success ? created.body.data.version : 0;

    const updated = await system.request({
      method: 'POST',
      path: `/v1/tasks/${taskId}`,
      methodOverride: 'PATCH',
      token: user.token,
      requestId: 'override-patch',
      body: { version, title: '覆盖后' }
    });
    expect(updated.status).toBe(200);
    expect(updated.body.success && updated.body.data).toMatchObject({
      title: '覆盖后',
      version: version + 1
    });
  });

  it('paginates the task list without duplicates or omissions', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login('page-user');
    for (let index = 0; index < 5; index += 1) {
      const created = await system.request({
        method: 'POST',
        path: '/v1/tasks',
        token: user.token,
        requestId: `create-${String(index)}`,
        body: {
          title: `待办 ${String(index)}`,
          priority: 'MEDIUM',
          dueHasTime: false,
          tagIds: []
        }
      });
      expect(created.status).toBe(201);
    }

    const first = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: user.token,
      query: { limit: '2' }
    });
    expect(first.status).toBe(200);
    expect(first.body.success && first.body.data).toHaveLength(2);
    expect(first.body.meta.hasMore).toBe(true);
    const cursor1 = first.body.meta.cursor;
    expect(cursor1).toBeDefined();

    const second = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: user.token,
      query: { limit: '2', cursor: cursor1 ?? '' }
    });
    expect(second.body.success && second.body.data).toHaveLength(2);
    expect(second.body.meta.hasMore).toBe(true);
    const cursor2 = second.body.meta.cursor;
    expect(cursor2).toBeDefined();

    const third = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: user.token,
      query: { limit: '2', cursor: cursor2 ?? '' }
    });
    expect(third.body.success && third.body.data).toHaveLength(1);
    expect(third.body.meta.hasMore).toBe(false);
    expect(third.body.meta.cursor).toBeUndefined();

    const ids = [
      ...(first.body.success ? first.body.data.map((task) => task.id) : []),
      ...(second.body.success ? second.body.data.map((task) => task.id) : []),
      ...(third.body.success ? third.body.data.map((task) => task.id) : [])
    ];
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('continues pagination when the cursor task was deleted', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login('deleted-cursor-user');
    for (let index = 0; index < 4; index += 1) {
      await system.request({
        method: 'POST',
        path: '/v1/tasks',
        token: user.token,
        requestId: `cursor-create-${String(index)}`,
        body: {
          title: `游标任务 ${String(index)}`,
          priority: 'MEDIUM',
          dueHasTime: false,
          tagIds: []
        }
      });
    }
    const first = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: user.token,
      query: { limit: '2' }
    });
    const cursorTaskId = first.body.success ? first.body.data[1]?.id : undefined;
    await system.request({
      method: 'DELETE',
      path: `/v1/tasks/${cursorTaskId ?? ''}`,
      token: user.token,
      requestId: 'delete-cursor'
    });

    const next = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: user.token,
      query: { limit: '2', cursor: first.body.meta.cursor ?? '' }
    });

    expect(next.body.success && next.body.data).toHaveLength(2);
  });

  it('filters tasks by Shanghai dueOn day including completed items', async () => {
    const system = createTestSystem({ now: Date.UTC(2026, 6, 31, 4) });
    const user = await system.login('due-on-user');
    const yesterday = Date.UTC(2026, 6, 29, 16); // 2026-07-30 00:00 Asia/Shanghai
    const todayNoon = Date.UTC(2026, 6, 31, 4); // 2026-07-31 12:00 Asia/Shanghai

    const past = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'due-on-past',
      body: {
        title: '昨天的安排',
        priority: 'MEDIUM',
        dueAt: yesterday + 10 * 60 * 60 * 1000,
        dueHasTime: true,
        tagIds: []
      }
    });
    expect(past.status).toBe(201);
    const pastId = past.body.success ? past.body.data.id : '';

    await system.request({
      method: 'POST',
      path: `/v1/tasks/${pastId}/complete`,
      token: user.token,
      requestId: 'due-on-complete'
    });

    await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'due-on-today',
      body: {
        title: '今天的安排',
        priority: 'HIGH',
        dueAt: todayNoon,
        dueHasTime: true,
        tagIds: []
      }
    });

    const dayList = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: user.token,
      query: { dueOn: '2026-07-30' }
    });
    expect(dayList.status).toBe(200);
    expect(dayList.body.success && dayList.body.data.map((task) => task.title)).toEqual([
      '昨天的安排'
    ]);
    expect(dayList.body.success && dayList.body.data[0]?.status).toBe('DONE');

    const invalid = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: user.token,
      query: { dueOn: '2026/07/30' }
    });
    expect(invalid.status).toBe(400);
    const impossibleDate = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: user.token,
      query: { dueOn: '2026-99-99' }
    });
    expect(impossibleDate.status).toBe(400);
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
