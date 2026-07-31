import { describe, expect, it } from 'vitest';

import { completeTask, restoreTask, trashTask, uncompleteTask } from '../src/task-state.js';
import { createTask } from './fixtures.js';

describe('task state transitions', () => {
  const now = Date.UTC(2026, 6, 31, 4);

  it('completes a todo without mutating the original', () => {
    const original = createTask();

    const completed = completeTask(original, now);

    expect(completed).not.toBe(original);
    expect(completed).toMatchObject({
      status: 'DONE',
      completedAt: now,
      updatedAt: now,
      version: 2
    });
    expect(original.status).toBe('TODO');
    expect(original.completedAt).toBeUndefined();
  });

  it('returns an already completed task unchanged', () => {
    const task = createTask({ status: 'DONE', completedAt: now });

    expect(completeTask(task, now)).toBe(task);
  });

  it('uncompletes a done task', () => {
    const task = createTask({ status: 'DONE', completedAt: now, version: 2 });

    expect(uncompleteTask(task, now + 1)).toMatchObject({
      status: 'TODO',
      updatedAt: now + 1,
      version: 3
    });
    expect(uncompleteTask(task, now + 1).completedAt).toBeUndefined();
  });

  it('returns an already active todo unchanged when uncompleting', () => {
    const task = createTask();

    expect(uncompleteTask(task, now)).toBe(task);
  });

  it('trashes a todo and records its original status', () => {
    const task = createTask();

    expect(trashTask(task, now)).toMatchObject({
      status: 'TRASHED',
      originalStatus: 'TODO',
      trashedAt: now,
      purgeAfterAt: now + 30 * 24 * 60 * 60 * 1000
    });
  });

  it('trashes a completed task and restores it as completed', () => {
    const task = createTask({ status: 'DONE', completedAt: now - 1 });
    const trashed = trashTask(task, now);
    const restored = restoreTask(trashed, now + 1);

    expect(trashed.originalStatus).toBe('DONE');
    expect(restored).toMatchObject({
      status: 'DONE',
      completedAt: now - 1,
      updatedAt: now + 1
    });
    expect(restored.trashedAt).toBeUndefined();
    expect(restored.purgeAfterAt).toBeUndefined();
    expect(restored.originalStatus).toBeUndefined();
  });

  it('restores a trashed todo as a todo', () => {
    const task = createTask();
    const restored = restoreTask(trashTask(task, now), now + 1);

    expect(restored).toMatchObject({
      status: 'TODO',
      updatedAt: now + 1,
      version: 3
    });
    expect(restored.completedAt).toBeUndefined();
  });

  it('rejects a corrupted trashed task without its original status', () => {
    const task = createTask({
      status: 'TRASHED',
      trashedAt: now,
      purgeAfterAt: now + 1
    });

    expect(() => restoreTask(task, now + 1)).toThrow('TASK_MISSING_ORIGINAL_STATE');
  });

  it('rejects invalid transitions from the trash', () => {
    const trashed = trashTask(createTask(), now);

    expect(() => completeTask(trashed, now + 1)).toThrow('TASK_INVALID_STATE');
    expect(() => uncompleteTask(trashed, now + 1)).toThrow('TASK_INVALID_STATE');
    expect(() => trashTask(trashed, now + 1)).toThrow('TASK_INVALID_STATE');
  });

  it('rejects restoring an active task', () => {
    expect(() => restoreTask(createTask(), now)).toThrow('TASK_INVALID_STATE');
  });
});
