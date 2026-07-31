import { describe, expect, it } from 'vitest';

import { createTestSystem } from '../../packages/backend/src/index.js';

describe('background schedulers', () => {
  it('materializes recurring instances without waiting for earlier completion', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = createTestSystem({ now });
    const user = await system.login('recurring-user');

    const series = await system.request({
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
    expect(series.status).toBe(201);

    await system.runMaintenance('2026-08-02');
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

  it('claims and sends a reminder at most once', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = createTestSystem({ now });
    const user = await system.login('reminder-user');
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

  it('skips a reminder when its task was completed before dispatch', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = createTestSystem({ now });
    const user = await system.login('completed-user');
    await system.request({
      method: 'POST',
      path: '/v1/reminder-grants',
      token: user.token,
      requestId: 'grant-1',
      body: { accepted: true }
    });
    const task = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: user.token,
      requestId: 'task-1',
      body: {
        title: '已完成',
        priority: 'MEDIUM',
        dueAt: now + 10 * 60 * 1000,
        dueHasTime: true,
        reminderEnabled: true,
        tagIds: []
      }
    });
    const taskId = task.body.success ? task.body.data.id : '';
    await system.request({
      method: 'POST',
      path: `/v1/tasks/${taskId}/complete`,
      token: user.token,
      requestId: 'complete-1'
    });

    await system.runReminderTicker(now);

    expect(system.sentMessages).toEqual([]);
  });

  it('does not send without a grant and records sender failures once', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const noGrantSystem = createTestSystem({ now });
    const noGrantUser = await noGrantSystem.login('no-grant-user');
    await noGrantSystem.request({
      method: 'POST',
      path: '/v1/tasks',
      token: noGrantUser.token,
      requestId: 'task-1',
      body: {
        title: '没有授权',
        priority: 'MEDIUM',
        dueAt: now + 10 * 60 * 1000,
        dueHasTime: true,
        reminderEnabled: true,
        tagIds: []
      }
    });
    await noGrantSystem.runReminderTicker(now);
    expect(noGrantSystem.sentMessages).toEqual([]);

    const failingSystem = createTestSystem({ now, sendShouldFail: true });
    const failingUser = await failingSystem.login('failing-user');
    await failingSystem.request({
      method: 'POST',
      path: '/v1/reminder-grants',
      token: failingUser.token,
      requestId: 'grant-1',
      body: { accepted: true }
    });
    await failingSystem.request({
      method: 'POST',
      path: '/v1/tasks',
      token: failingUser.token,
      requestId: 'task-1',
      body: {
        title: '发送失败',
        priority: 'MEDIUM',
        dueAt: now + 10 * 60 * 1000,
        dueHasTime: true,
        reminderEnabled: true,
        tagIds: []
      }
    });
    await failingSystem.runReminderTicker(now);
    await failingSystem.runReminderTicker(now);
    expect(failingSystem.sentMessages).toEqual([]);
  });

  it('purges expired trash and accounts after their retention windows', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const system = createTestSystem({ now });
    const taskUser = await system.login('trash-purge-user');
    const task = await system.request({
      method: 'POST',
      path: '/v1/tasks',
      token: taskUser.token,
      requestId: 'task-1',
      body: {
        title: '过期待办',
        priority: 'LOW',
        dueHasTime: false,
        tagIds: []
      }
    });
    const taskId = task.body.success ? task.body.data.id : '';
    await system.request({
      method: 'DELETE',
      path: `/v1/tasks/${taskId}`,
      token: taskUser.token,
      requestId: 'trash-1'
    });

    const accountUser = await system.login('account-purge-user');
    await system.request({
      method: 'POST',
      path: '/v1/account/deletion',
      token: accountUser.token,
      requestId: 'delete-account'
    });

    system.setNow(now + 31 * 24 * 60 * 60 * 1000);
    await system.runMaintenance('2026-08-31');

    const refreshedTaskUser = await system.login('trash-purge-user');
    const trash = await system.request({
      method: 'GET',
      path: '/v1/trash',
      token: refreshedTaskUser.token
    });
    expect(trash.body.success && trash.body.data).toEqual([]);

    const relogin = await system.request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { code: 'account-purge-user' }
    });
    expect(relogin.status).toBe(403);
  });
});
