import type { Reminder, Task } from '@today-todo/contracts';

import { DomainError } from './errors.js';

const REMINDER_LEAD_MS = 10 * 60 * 1000;

export function reminderTimeFor(dueAt: number): number {
  return dueAt - REMINDER_LEAD_MS;
}

export function createReminderForTask(task: Task, now: number, reminderId: string): Reminder {
  if (task.status !== 'TODO') {
    throw new DomainError('REMINDER_TASK_INACTIVE');
  }
  if (!task.dueHasTime || task.dueAt === undefined) {
    throw new DomainError('REMINDER_REQUIRES_DUE_TIME');
  }

  const fireAt = reminderTimeFor(task.dueAt);
  if (fireAt < now) {
    throw new DomainError('REMINDER_TOO_LATE');
  }

  return {
    id: reminderId,
    userId: task.userId,
    taskId: task.id,
    taskVersion: task.version,
    fireAt,
    state: 'SCHEDULED'
  };
}

export function cancelReminder(reminder: Reminder): Reminder {
  if (reminder.state === 'SKIPPED') {
    return reminder;
  }
  if (reminder.state !== 'SCHEDULED') {
    throw new DomainError('REMINDER_INVALID_STATE');
  }
  return {
    ...reminder,
    state: 'SKIPPED'
  };
}
