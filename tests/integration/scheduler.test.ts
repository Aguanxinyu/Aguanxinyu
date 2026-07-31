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
});
