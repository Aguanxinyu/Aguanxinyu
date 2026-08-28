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

/** YYYY-MM-DD in Asia/Shanghai for a UTC instant. */
export function shanghaiDateKey(timestamp: number): string {
  const shifted = new Date(timestamp + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

function compareDateKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Inclusive Shanghai date span for calendar placement. */
export function taskDateSpan(
  task: Task,
  now: number
): { readonly from: string; readonly to: string } | null {
  if (task.occurrenceDate !== undefined) {
    return { from: task.occurrenceDate, to: task.occurrenceDate };
  }
  const startKey = task.startAt === undefined ? undefined : shanghaiDateKey(task.startAt);
  const dueKey = task.dueAt === undefined ? undefined : shanghaiDateKey(task.dueAt);
  if (startKey !== undefined && dueKey !== undefined) {
    return startKey <= dueKey ? { from: startKey, to: dueKey } : { from: dueKey, to: startKey };
  }
  if (dueKey !== undefined) {
    return { from: dueKey, to: dueKey };
  }
  if (startKey !== undefined) {
    return { from: startKey, to: startKey };
  }
  const today = shanghaiDateKey(now);
  return { from: today, to: today };
}

/** Whether a task belongs on a Shanghai calendar day (including undated → today). */
export function taskBelongsToDate(task: Task, dueOn: string, now: number): boolean {
  const span = taskDateSpan(task, now);
  if (span === null) {
    return false;
  }
  return compareDateKeys(span.from, dueOn) <= 0 && compareDateKeys(dueOn, span.to) <= 0;
}

/** Whether a task appears on any day within an inclusive Shanghai date range. */
export function taskOverlapsDateRange(
  task: Task,
  fromKey: string,
  toKey: string,
  now: number
): boolean {
  const span = taskDateSpan(task, now);
  if (span === null) {
    return false;
  }
  return compareDateKeys(span.from, toKey) <= 0 && compareDateKeys(fromKey, span.to) <= 0;
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

// MAX_SAFE 取代 Infinity，使排序键可被 JSON 安全编码（用于游标分页）。
const UNDATED_SORT_KEY = Number.MAX_SAFE_INTEGER;

export type TaskSortTuple = readonly [number, number, number, string];

export function taskSortTuple(task: Task): TaskSortTuple {
  return [task.dueAt ?? UNDATED_SORT_KEY, PRIORITY_ORDER[task.priority], -task.createdAt, task.id];
}

export function compareSortTuples(left: TaskSortTuple, right: TaskSortTuple): number {
  for (let index = 0; index < 3; index += 1) {
    const l = left[index] as number;
    const r = right[index] as number;
    if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  if (left[3] !== right[3]) {
    return left[3] < right[3] ? -1 : 1;
  }
  return 0;
}

export function sortTasks(tasks: readonly Task[]): readonly Task[] {
  return [...tasks].sort((left, right) =>
    compareSortTuples(taskSortTuple(left), taskSortTuple(right))
  );
}
