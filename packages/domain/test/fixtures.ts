import type { Series, Task } from '@today-todo/contracts';

const BASE_TIME = Date.UTC(2026, 6, 31, 2, 0, 0);

export function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    userId: 'user-1',
    title: '测试待办',
    dueHasTime: false,
    priority: 'MEDIUM',
    status: 'TODO',
    listId: 'inbox',
    tagIds: [],
    version: 1,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides
  };
}

export function createSeries(overrides: Partial<Series> = {}): Series {
  return {
    id: 'series-1',
    userId: 'user-1',
    status: 'ACTIVE',
    startDate: '2026-01-01',
    rule: {
      frequency: 'DAILY'
    },
    ...overrides
  };
}
