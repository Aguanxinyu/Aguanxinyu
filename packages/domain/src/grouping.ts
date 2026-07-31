import type { Priority, Task } from '@today-todo/contracts';

export type TaskGroup = 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'UNDATED';

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const PRIORITY_ORDER: Readonly<Record<Priority, number>> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2
};

function shanghaiDay(timestamp: number): number {
  return Math.floor((timestamp + SHANGHAI_OFFSET_MS) / DAY_MS);
}

export function getTaskGroup(task: Task, now: number): TaskGroup | null {
  if (task.status !== 'TODO') {
    return null;
  }
  if (task.dueAt === undefined) {
    return 'UNDATED';
  }

  const dueDay = shanghaiDay(task.dueAt);
  const currentDay = shanghaiDay(now);
  if (dueDay < currentDay) {
    return 'OVERDUE';
  }
  if (dueDay === currentDay) {
    return 'TODAY';
  }
  return 'UPCOMING';
}

export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    const dueDifference =
      (left.dueAt ?? Number.POSITIVE_INFINITY) -
      (right.dueAt ?? Number.POSITIVE_INFINITY);
    if (dueDifference !== 0) {
      return dueDifference;
    }

    const priorityDifference =
      PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    const creationDifference = right.createdAt - left.createdAt;
    if (creationDifference !== 0) {
      return creationDifference;
    }

    return left.id.localeCompare(right.id);
  });
}
