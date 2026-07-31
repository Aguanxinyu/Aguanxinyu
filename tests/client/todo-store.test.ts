import { describe, expect, it } from 'vitest';

import {
  acknowledgeMutation,
  createTodoState,
  enqueueMutation,
  replaceTasks,
  setTaskStatus
} from '../../miniprogram/stores/todo-store.js';

describe('mini program todo store', () => {
  const task = {
    id: 'task-1',
    title: '完成测试',
    priority: 'MEDIUM' as const,
    status: 'TODO' as const,
    dueHasTime: false,
    listId: 'inbox',
    tagIds: [],
    version: 1,
    createdAt: 1,
    updatedAt: 1
  };

  it('replaces tasks without mutating the prior state', () => {
    const original = createTodoState();
    const next = replaceTasks(original, [task], 10);

    expect(next).not.toBe(original);
    expect(next.tasks).toEqual([task]);
    expect(next.syncedAt).toBe(10);
    expect(original.tasks).toEqual([]);
  });

  it('applies and rolls back an optimistic status update', () => {
    const original = replaceTasks(createTodoState(), [task], 10);
    const completed = setTaskStatus(original, task.id, 'DONE', 20);
    const rolledBack = setTaskStatus(completed, task.id, 'TODO', 30);

    expect(completed.tasks[0]).toMatchObject({
      status: 'DONE',
      updatedAt: 20,
      version: 2
    });
    expect(rolledBack.tasks[0]).toMatchObject({
      status: 'TODO',
      updatedAt: 30,
      version: 3
    });
    expect(original.tasks[0]?.status).toBe('TODO');
  });

  it('queues offline mutations and acknowledges only the matching item', () => {
    const initial = createTodoState();
    const first = enqueueMutation(initial, {
      id: 'mutation-1',
      taskId: 'task-1',
      action: 'COMPLETE',
      createdAt: 1
    });
    const second = enqueueMutation(first, {
      id: 'mutation-2',
      taskId: 'task-2',
      action: 'TRASH',
      createdAt: 2
    });

    const acknowledged = acknowledgeMutation(second, 'mutation-1');

    expect(acknowledged.pendingMutations.map(({ id }) => id)).toEqual(['mutation-2']);
    expect(second.pendingMutations.map(({ id }) => id)).toEqual(['mutation-1', 'mutation-2']);
  });

  it('returns the same state when the target task or mutation is absent', () => {
    const state = createTodoState();

    expect(setTaskStatus(state, 'missing', 'DONE', 1)).toBe(state);
    expect(acknowledgeMutation(state, 'missing')).toBe(state);
  });
});
