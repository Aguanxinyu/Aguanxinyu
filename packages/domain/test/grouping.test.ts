import { describe, expect, it } from 'vitest';

import { getTaskGroup, sortTasks } from '../src/grouping.js';
import { createTask } from './fixtures.js';

describe('task grouping and sorting', () => {
  const now = Date.UTC(2026, 6, 31, 4);
  const todayStart = Date.UTC(2026, 6, 30, 16);
  const tomorrowStart = Date.UTC(2026, 6, 31, 16);

  it.each([
    [todayStart - 1, 'OVERDUE'],
    [todayStart, 'TODAY'],
    [tomorrowStart - 1, 'TODAY'],
    [tomorrowStart, 'UPCOMING']
  ] as const)('groups a due timestamp %s as %s in Asia/Shanghai', (dueAt, expected) => {
    expect(getTaskGroup(createTask({ dueAt }), now)).toBe(expected);
  });

  it('groups an undated todo separately', () => {
    expect(getTaskGroup(createTask(), now)).toBe('UNDATED');
  });

  it('excludes completed and trashed tasks', () => {
    expect(getTaskGroup(createTask({ status: 'DONE' }), now)).toBeNull();
    expect(getTaskGroup(createTask({ status: 'TRASHED' }), now)).toBeNull();
  });

  it('sorts by due time, then priority, then newest creation time', () => {
    const tasks = [
      createTask({
        id: 'low',
        dueAt: tomorrowStart,
        priority: 'LOW',
        createdAt: 3
      }),
      createTask({
        id: 'new-high',
        dueAt: tomorrowStart,
        priority: 'HIGH',
        createdAt: 3
      }),
      createTask({
        id: 'old-high',
        dueAt: tomorrowStart,
        priority: 'HIGH',
        createdAt: 1
      }),
      createTask({
        id: 'early',
        dueAt: todayStart,
        priority: 'LOW',
        createdAt: 1
      })
    ];

    expect(sortTasks(tasks).map(({ id }) => id)).toEqual(['early', 'new-high', 'old-high', 'low']);
    expect(tasks.map(({ id }) => id)).toEqual(['low', 'new-high', 'old-high', 'early']);
  });

  it('places undated tasks after dated tasks', () => {
    const tasks = [
      createTask({ id: 'undated', createdAt: 2 }),
      createTask({ id: 'dated', dueAt: tomorrowStart, createdAt: 1 })
    ];

    expect(sortTasks(tasks).map(({ id }) => id)).toEqual(['dated', 'undated']);
  });

  it('uses task ids as a deterministic final tie breaker', () => {
    const tasks = [
      createTask({ id: 'task-b', dueAt: tomorrowStart }),
      createTask({ id: 'task-a', dueAt: tomorrowStart })
    ];

    expect(sortTasks(tasks).map(({ id }) => id)).toEqual(['task-a', 'task-b']);
  });
});
