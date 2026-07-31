import type { ActiveTaskStatus, Task } from '@today-todo/contracts';

import { DomainError } from './errors.js';
import { purgeAtFor } from './trash.js';

function requireActive(task: Task): asserts task is Task & { status: ActiveTaskStatus } {
  if (task.status === 'TRASHED') {
    throw new DomainError('TASK_INVALID_STATE');
  }
}

export function completeTask(task: Task, now: number): Task {
  requireActive(task);
  if (task.status === 'DONE') {
    return task;
  }
  return {
    ...task,
    status: 'DONE',
    completedAt: now,
    updatedAt: now,
    version: task.version + 1
  };
}

export function uncompleteTask(task: Task, now: number): Task {
  requireActive(task);
  if (task.status === 'TODO') {
    return task;
  }
  const { completedAt: _completedAt, ...withoutCompletion } = task;
  return {
    ...withoutCompletion,
    status: 'TODO',
    updatedAt: now,
    version: task.version + 1
  };
}

export function trashTask(task: Task, now: number): Task {
  requireActive(task);
  return {
    ...task,
    status: 'TRASHED',
    originalStatus: task.status,
    trashedAt: now,
    purgeAfterAt: purgeAtFor(now),
    updatedAt: now,
    version: task.version + 1
  };
}

export function restoreTask(task: Task, now: number): Task {
  if (task.status !== 'TRASHED') {
    throw new DomainError('TASK_INVALID_STATE');
  }
  if (task.originalStatus === undefined) {
    throw new DomainError('TASK_MISSING_ORIGINAL_STATE');
  }

  const {
    originalStatus,
    trashedAt: _trashedAt,
    purgeAfterAt: _purgeAfterAt,
    ...activeFields
  } = task;

  if (originalStatus === 'DONE') {
    return {
      ...activeFields,
      status: 'DONE',
      updatedAt: now,
      version: task.version + 1
    };
  }

  const { completedAt: _completedAt, ...todoFields } = activeFields;
  return {
    ...todoFields,
    status: 'TODO',
    updatedAt: now,
    version: task.version + 1
  };
}
