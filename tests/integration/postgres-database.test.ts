import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestSystem, PostgresDatabase } from '../../packages/backend/src/index.js';

const testUrl = process.env.PG_TEST_DATABASE_URL;
const enabled = testUrl !== undefined && testUrl.length > 0;
const databaseUrl = enabled ? testUrl : undefined;

function makeSystem(now: number, pool: pg.Pool) {
  return createTestSystem({ now, database: new PostgresDatabase(pool) });
}

describe.skipIf(!enabled)('PostgreSQL-backed database', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE users, sessions, tasks, lists, tags, series, reminders, reminder_grants, idempotency, sequences RESTART IDENTITY CASCADE;'
    );
  });

  it('persists the full task lifecycle across database instances', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = makeSystem(now, pool);
    const user = await system.login('pg-alice');

    const createRequest = {
      method: 'POST' as const,
      path: '/v1/tasks' as const,
      token: user.token,
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

    // A fresh instance over the same pool must see the persisted rows.
    const fresh = makeSystem(now, pool);
    const relogin = await fresh.login('pg-alice');
    const listed = await fresh.request({
      method: 'GET',
      path: '/v1/tasks',
      token: relogin.token
    });
    expect(listed.body.success && listed.body.data).toHaveLength(1);

    const completed = await fresh.request({
      method: 'POST',
      path: `/v1/tasks/${taskId}/complete`,
      token: relogin.token,
      requestId: 'complete-1'
    });
    expect(completed.body.success && completed.body.data.status).toBe('DONE');

    const removed = await fresh.request({
      method: 'DELETE',
      path: `/v1/tasks/${taskId}`,
      token: relogin.token,
      requestId: 'delete-1'
    });
    expect(removed.body.success && removed.body.data.status).toBe('TRASHED');

    const trash = await fresh.request({
      method: 'GET',
      path: '/v1/trash',
      token: relogin.token
    });
    expect(trash.body.success && trash.body.data).toHaveLength(1);

    const restored = await fresh.request({
      method: 'POST',
      path: `/v1/trash/${taskId}/restore`,
      token: relogin.token,
      requestId: 'restore-1'
    });
    expect(restored.body.success && restored.body.data.status).toBe('DONE');
  });

  it('edits a task with PATCH and syncs its reminder', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = makeSystem(now, pool);
    const user = await system.login('pg-edit-user');
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
  });

  it('rejects a PATCH that carries a stale version', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = makeSystem(now, pool);
    const user = await system.login('pg-stale-user');
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
  });

  it('prevents one user from reading another user todo', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = makeSystem(now, pool);
    const alice = await system.login('pg-alice');
    const bob = await system.login('pg-bob');
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

  it('moves tasks to inbox when a list is deleted', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = makeSystem(now, pool);
    const user = await system.login('pg-list-user');
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

    await system.request({
      method: 'DELETE',
      path: `/v1/lists/${listId}`,
      token: user.token,
      requestId: 'delete-list'
    });

    const moved = await system.request({
      method: 'GET',
      path: `/v1/tasks/${taskId}`,
      token: user.token
    });
    expect(moved.body.success && moved.body.data.listId).toBe('inbox');
    expect(moved.body.success && moved.body.data.version).toBe(2);
  });

  it('revokes sessions and purges data after account deletion retention', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = makeSystem(now, pool);
    const user = await system.login('pg-delete-user');
    await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'task-1',
      body: {
        title: '待删数据',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: []
      }
    });

    await system.request({
      method: 'POST',
      path: '/v1/account/deletion',
      token: user.token,
      requestId: 'delete-account'
    });
    const oldSession = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: user.token
    });
    expect(oldSession.status).toBe(401);

    system.setNow(now + 31 * 24 * 60 * 60 * 1000);
    const pending = await system.database.usersPendingPurge(now + 31 * 24 * 60 * 60 * 1000);
    expect(pending.map((record) => record.id)).toContain(user.userId);

    await system.database.purgeUser(user.userId);
    const allTasks = await system.database.allTasks();
    expect(allTasks).toEqual([]);
    const relogin = await system.request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { code: 'pg-delete-user' }
    });
    expect(relogin.status).toBe(403);
  });

  it('claims and sends a reminder at most once', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = makeSystem(now, pool);
    const user = await system.login('pg-reminder-user');
    await system.request({
      method: 'POST',
      path: '/v1/reminder-grants',
      token: user.token,
      requestId: 'grant-1',
      body: { accepted: true }
    });
    await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'reminded-task',
      body: {
        title: '准时提交',
        priority: 'HIGH',
        dueAt: now + 10 * 60 * 1000,
        dueHasTime: true,
        reminderEnabled: true,
        tagIds: []
      }
    });

    await system.runReminderTicker(now);
    await system.runReminderTicker(now);

    expect(system.sentMessages).toHaveLength(1);
    expect(system.sentMessages[0]).toMatchObject({
      userId: user.userId,
      title: '准时提交'
    });
  });

  it('materializes recurring instances through the given date', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = makeSystem(now, pool);
    const user = await system.login('pg-recurring-user');
    await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'daily-series',
      body: {
        title: '每日复盘',
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: [],
        recurrence: {
          frequency: 'DAILY',
          startDate: '2026-07-31',
          endDate: '2026-08-02'
        }
      }
    });

    await system.runMaintenance('2026-08-02');

    const tasks = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: user.token
    });
    expect(tasks.body.success ? tasks.body.data.map((task) => task.occurrenceDate) : []).toEqual([
      '2026-07-31',
      '2026-08-01',
      '2026-08-02'
    ]);
  });
});
