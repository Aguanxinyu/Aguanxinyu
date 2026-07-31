import type { Task } from '@today-todo/contracts';

import { DomainError } from './errors.js';

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function purgeAtFor(trashedAt: number): number {
  return trashedAt + TRASH_RETENTION_MS;
}

export function isTrashExpired(task: Task, now: number): boolean {
  if (task.status !== 'TRASHED') {
    throw new DomainError('TASK_NOT_TRASHED');
  }
  if (task.purgeAfterAt === undefined) {
    throw new DomainError('TASK_MISSING_PURGE_TIME');
  }
  return now >= task.purgeAfterAt;
}
