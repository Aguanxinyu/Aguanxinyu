import { describe, expect, it } from 'vitest';

import { cancelReminder, createReminderForTask, reminderTimeFor } from '../src/reminder.js';
import { createTask } from './fixtures.js';

describe('reminder rules', () => {
  const now = Date.UTC(2026, 6, 31, 4);
  const tenMinutes = 10 * 60 * 1000;

  it('calculates a reminder ten minutes before the due time', () => {
    expect(reminderTimeFor(now + tenMinutes)).toBe(now);
  });

  it('creates a scheduled reminder exactly ten minutes before due', () => {
    const task = createTask({
      dueAt: now + tenMinutes,
      dueHasTime: true,
      version: 4
    });

    expect(createReminderForTask(task, now, 'reminder-1')).toEqual({
      id: 'reminder-1',
      userId: 'user-1',
      taskId: 'task-1',
      taskVersion: 4,
      fireAt: now,
      state: 'SCHEDULED'
    });
  });

  it('rejects reminders without an exact due time', () => {
    const task = createTask({ dueAt: now + tenMinutes, dueHasTime: false });

    expect(() => createReminderForTask(task, now, 'reminder-1')).toThrow(
      'REMINDER_REQUIRES_DUE_TIME'
    );
  });

  it('rejects reminders less than ten minutes before due', () => {
    const task = createTask({
      dueAt: now + tenMinutes - 1,
      dueHasTime: true
    });

    expect(() => createReminderForTask(task, now, 'reminder-1')).toThrow('REMINDER_TOO_LATE');
  });

  it('rejects reminders for completed or trashed tasks', () => {
    expect(() =>
      createReminderForTask(
        createTask({ status: 'DONE', dueAt: now + tenMinutes, dueHasTime: true }),
        now,
        'reminder-1'
      )
    ).toThrow('REMINDER_TASK_INACTIVE');
    expect(() =>
      createReminderForTask(
        createTask({ status: 'TRASHED', dueAt: now + tenMinutes, dueHasTime: true }),
        now,
        'reminder-1'
      )
    ).toThrow('REMINDER_TASK_INACTIVE');
  });

  it('cancels a scheduled reminder without mutating it', () => {
    const reminder = createReminderForTask(
      createTask({ dueAt: now + tenMinutes, dueHasTime: true }),
      now,
      'reminder-1'
    );

    const cancelled = cancelReminder(reminder);

    expect(cancelled).toEqual({ ...reminder, state: 'SKIPPED' });
    expect(cancelled).not.toBe(reminder);
    expect(reminder.state).toBe('SCHEDULED');
  });
});
