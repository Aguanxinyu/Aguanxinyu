import type { Priority, Task } from '@today-todo/contracts';

import { shanghaiDateKey } from './grouping.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ImprovementType =
  | 'OVERDUE_PILEUP'
  | 'HIGH_PRIORITY_OPEN'
  | 'DAY_OVERLOAD'
  | 'UNDATED_PILEUP'
  | 'REPEAT_MISS'
  | 'REMINDER_INEFFECTIVE';

export type ImprovementSeverity = 'high' | 'medium' | 'low';

export interface WeeklyImprovement {
  readonly type: ImprovementType;
  readonly severity: ImprovementSeverity;
  readonly title: string;
  readonly rationale: string;
  readonly suggestion: string;
  readonly taskIds: readonly string[];
}

export interface WeeklyHighlight {
  readonly title: string;
  readonly taskIds: readonly string[];
}

export interface ListStat {
  readonly listId: string;
  readonly listName: string;
  readonly count: number;
}

export interface WeeklyStats {
  readonly total: number;
  readonly completed: number;
  readonly open: number;
  readonly overdueOpen: number;
  readonly highPriorityTotal: number;
  readonly highPriorityCompleted: number;
  readonly highPriorityCompletionRate: number;
  readonly busiestDay: string | null;
  readonly busiestDayCount: number;
  readonly listTop: readonly ListStat[];
  readonly carriedOverOverdue: number;
}

export interface WeeklyTaskFact {
  readonly id: string;
  readonly title: string;
  readonly notes?: string;
  readonly status: 'TODO' | 'DONE';
  readonly priority: Priority;
  readonly listId: string;
  readonly listName: string;
  readonly dueAt?: number;
  readonly occurrenceDate?: string;
  readonly dueHasTime: boolean;
  readonly undated: boolean;
  readonly dayKey: string | null;
  readonly reminderEnabled: boolean;
  readonly seriesId?: string;
  readonly completedAt?: number;
  readonly createdAt: number;
}

export interface WeeklyReviewFacts {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly generatedAt: number;
  readonly stats: WeeklyStats;
  readonly tasks: readonly WeeklyTaskFact[];
}

/** Monday 00:00 Asia/Shanghai as epoch ms for a YYYY-MM-DD (any day in that week). */
export function weekStartMs(weekStart: string): number {
  return Date.parse(`${weekStart}T00:00:00+08:00`);
}

export function weekEndExclusiveMs(weekStart: string): number {
  return weekStartMs(weekStart) + 7 * DAY_MS;
}

/** Monday date key (Shanghai) containing `now`. */
export function weekStartForInstant(now: number): string {
  const key = shanghaiDateKey(now);
  const noon = Date.parse(`${key}T12:00:00+08:00`);
  const weekday = new Date(noon).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return shanghaiDateKey(noon + mondayOffset * DAY_MS);
}

export function previousWeekStart(weekStart: string): string {
  return shanghaiDateKey(weekStartMs(weekStart) - 7 * DAY_MS);
}

export function weekEndDateKey(weekStart: string): string {
  return shanghaiDateKey(weekEndExclusiveMs(weekStart) - 1);
}

export function isValidWeekStart(weekStart: string): boolean {
  if (!DATE_PATTERN.test(weekStart)) {
    return false;
  }
  return weekStart === weekStartForInstant(weekStartMs(weekStart) + 12 * 60 * 60 * 1000);
}

/**
 * AI is allowed when the week has fully ended, or it is Sunday >= 19:00
 * Shanghai within that week.
 */
export function aiAllowed(weekStart: string, now: number): boolean {
  if (!isValidWeekStart(weekStart)) {
    return false;
  }
  const endExclusive = weekEndExclusiveMs(weekStart);
  if (now >= endExclusive) {
    return true;
  }
  const start = weekStartMs(weekStart);
  if (now < start || now >= endExclusive) {
    return false;
  }
  const parts = shanghaiDateKey(now);
  const sundayKey = weekEndDateKey(weekStart);
  if (parts !== sundayKey) {
    return false;
  }
  const sundaySevenPm = Date.parse(`${sundayKey}T19:00:00+08:00`);
  return now >= sundaySevenPm;
}

/**
 * Default week to show when opening 本周回顾.
 * Mon–Fri: current week. Sat – Sun 18:59: previous week. Sun 19:00+: current week.
 */
export function defaultWeekStart(now: number): string {
  const current = weekStartForInstant(now);
  const sundayKey = weekEndDateKey(current);
  const sundaySevenPm = Date.parse(`${sundayKey}T19:00:00+08:00`);
  const saturdayStart = Date.parse(
    `${shanghaiDateKey(weekStartMs(current) + 5 * DAY_MS)}T00:00:00+08:00`
  );
  if (now >= saturdayStart && now < sundaySevenPm) {
    return previousWeekStart(current);
  }
  return current;
}

function taskDayKeyInWeek(task: Task, weekStart: string, weekEnd: string): string | null {
  if (task.occurrenceDate !== undefined) {
    return task.occurrenceDate >= weekStart && task.occurrenceDate <= weekEnd
      ? task.occurrenceDate
      : null;
  }
  if (task.dueAt !== undefined) {
    const key = shanghaiDateKey(task.dueAt);
    return key >= weekStart && key <= weekEnd ? key : null;
  }
  return null;
}

export function taskBelongsToWeek(task: Task, weekStart: string): boolean {
  if (task.status === 'TRASHED') {
    return false;
  }
  const weekEnd = weekEndDateKey(weekStart);
  const startMs = weekStartMs(weekStart);
  const endExclusive = weekEndExclusiveMs(weekStart);
  if (taskBelongsToWeekByDate(task, weekStart, weekEnd)) {
    return true;
  }
  // Undated: created or completed within the week.
  if (task.dueAt === undefined && task.occurrenceDate === undefined) {
    if (task.createdAt >= startMs && task.createdAt < endExclusive) {
      return true;
    }
    if (
      task.completedAt !== undefined &&
      task.completedAt >= startMs &&
      task.completedAt < endExclusive
    ) {
      return true;
    }
  }
  return false;
}

function taskBelongsToWeekByDate(task: Task, weekStart: string, weekEnd: string): boolean {
  return taskDayKeyInWeek(task, weekStart, weekEnd) !== null;
}

export interface BuildWeeklyFactsOptions {
  readonly weekStart: string;
  readonly now: number;
  readonly tasks: readonly Task[];
  readonly listNames: Readonly<Record<string, string>>;
}

export function buildWeeklyFacts(options: BuildWeeklyFactsOptions): WeeklyReviewFacts {
  const { weekStart, now, tasks, listNames } = options;
  const weekEnd = weekEndDateKey(weekStart);
  const members = tasks.filter((task) => taskBelongsToWeek(task, weekStart));
  const facts: WeeklyTaskFact[] = members.map((task) => {
    const undated = task.dueAt === undefined && task.occurrenceDate === undefined;
    const dayKey = undated ? null : taskDayKeyInWeek(task, weekStart, weekEnd);
    return {
      id: task.id,
      title: task.title,
      ...(task.notes === undefined ? {} : { notes: task.notes }),
      status: task.status === 'DONE' ? 'DONE' : 'TODO',
      priority: task.priority,
      listId: task.listId,
      listName: listNames[task.listId] ?? task.listId,
      ...(task.dueAt === undefined ? {} : { dueAt: task.dueAt }),
      ...(task.occurrenceDate === undefined ? {} : { occurrenceDate: task.occurrenceDate }),
      dueHasTime: task.dueHasTime,
      undated,
      dayKey,
      reminderEnabled: task.remindAt !== undefined,
      ...(task.seriesId === undefined ? {} : { seriesId: task.seriesId }),
      ...(task.completedAt === undefined ? {} : { completedAt: task.completedAt }),
      createdAt: task.createdAt
    };
  });

  const completed = facts.filter((task) => task.status === 'DONE').length;
  const open = facts.filter((task) => task.status === 'TODO').length;
  const overdueOpen = facts.filter((task) => {
    if (task.status !== 'TODO' || task.undated || task.dayKey === null) {
      return false;
    }
    if (task.dueHasTime && task.dueAt !== undefined) {
      return task.dueAt < now;
    }
    return task.dayKey < shanghaiDateKey(now);
  }).length;

  // Carried-over: due before week but still TODO and included via undated? Actually
  // carried over overdue means due before weekStart still TODO — those are NOT in
  // week by date. Spec says count them separately if we include them. MVP: count
  // tasks with dueAt before week that are TODO among all user tasks passed in.
  const carriedOverOverdue = tasks.filter((task) => {
    if (task.status !== 'TODO' || task.dueAt === undefined) {
      return false;
    }
    return shanghaiDateKey(task.dueAt) < weekStart;
  }).length;

  const highPriority = facts.filter((task) => task.priority === 'HIGH');
  const highPriorityCompleted = highPriority.filter((task) => task.status === 'DONE').length;

  const dayCounts = new Map<string, number>();
  for (const task of facts) {
    const key = task.dayKey ?? (task.undated ? shanghaiDateKey(task.createdAt) : null);
    if (key === null || key < weekStart || key > weekEnd) {
      continue;
    }
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
  }
  let busiestDay: string | null = null;
  let busiestDayCount = 0;
  for (const [day, count] of dayCounts) {
    if (count > busiestDayCount) {
      busiestDay = day;
      busiestDayCount = count;
    }
  }

  const listCounts = new Map<string, { name: string; count: number }>();
  for (const task of facts) {
    const existing = listCounts.get(task.listId);
    if (existing === undefined) {
      listCounts.set(task.listId, { name: task.listName, count: 1 });
    } else {
      listCounts.set(task.listId, { name: existing.name, count: existing.count + 1 });
    }
  }
  const listTop = [...listCounts.entries()]
    .map(([listId, value]) => ({
      listId,
      listName: value.name,
      count: value.count
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);

  const highPriorityTotal = highPriority.length;
  const stats: WeeklyStats = {
    total: facts.length,
    completed,
    open,
    overdueOpen,
    highPriorityTotal,
    highPriorityCompleted,
    highPriorityCompletionRate:
      highPriorityTotal === 0 ? 1 : highPriorityCompleted / highPriorityTotal,
    busiestDay,
    busiestDayCount,
    listTop,
    carriedOverOverdue
  };

  return {
    weekStart,
    weekEnd,
    generatedAt: now,
    stats,
    tasks: facts
  };
}

const MAX_IMPROVEMENTS = 5;

export function buildRulesReview(facts: WeeklyReviewFacts): {
  readonly summary: string;
  readonly improvements: readonly WeeklyImprovement[];
  readonly highlights: readonly WeeklyHighlight[];
} {
  const improvements: WeeklyImprovement[] = [];
  const openTasks = facts.tasks.filter((task) => task.status === 'TODO');
  const overdue = openTasks.filter((task) => {
    if (task.undated || task.dayKey === null) {
      return false;
    }
    return task.dayKey < shanghaiDateKey(facts.generatedAt);
  });
  if (overdue.length >= 3) {
    improvements.push({
      type: 'OVERDUE_PILEUP',
      severity: 'high',
      title: '逾期安排偏多',
      rationale: `本周仍有 ${String(overdue.length)} 项已过期未完成`,
      suggestion: '先清空最早的 2～3 项逾期，或改期到明确的一天',
      taskIds: overdue.slice(0, 5).map((task) => task.id)
    });
  }

  const highOpen = openTasks.filter((task) => task.priority === 'HIGH');
  if (highOpen.length > 0) {
    improvements.push({
      type: 'HIGH_PRIORITY_OPEN',
      severity: 'high',
      title: '高优先级尚未闭环',
      rationale: `还有 ${String(highOpen.length)} 项高优待办未完成`,
      suggestion: '明天只盯最高优的一两项，完成后再加新任务',
      taskIds: highOpen.slice(0, 5).map((task) => task.id)
    });
  }

  const dayBuckets = new Map<string, string[]>();
  for (const task of facts.tasks) {
    if (task.dayKey === null) {
      continue;
    }
    const bucket = dayBuckets.get(task.dayKey) ?? [];
    bucket.push(task.id);
    dayBuckets.set(task.dayKey, bucket);
  }
  for (const [day, ids] of dayBuckets) {
    if (ids.length >= 8 && improvements.length < MAX_IMPROVEMENTS) {
      improvements.push({
        type: 'DAY_OVERLOAD',
        severity: 'medium',
        title: `${day} 安排过载`,
        rationale: `当天有 ${String(ids.length)} 项安排`,
        suggestion: '把低优或可延后事项挪到相邻较空的一天',
        taskIds: ids.slice(0, 8)
      });
      break;
    }
  }

  const undatedOpen = openTasks.filter((task) => task.undated);
  if (undatedOpen.length >= 5) {
    improvements.push({
      type: 'UNDATED_PILEUP',
      severity: 'medium',
      title: '无日期待办堆积',
      rationale: `有 ${String(undatedOpen.length)} 项未设日期仍未完成`,
      suggestion: '给每项定一个具体日期，或删掉不再需要的',
      taskIds: undatedOpen.slice(0, 5).map((task) => task.id)
    });
  }

  const seriesMiss = new Map<string, string[]>();
  for (const task of openTasks) {
    if (task.seriesId === undefined) {
      continue;
    }
    const ids = seriesMiss.get(task.seriesId) ?? [];
    ids.push(task.id);
    seriesMiss.set(task.seriesId, ids);
  }
  for (const ids of seriesMiss.values()) {
    if (ids.length >= 2 && improvements.length < MAX_IMPROVEMENTS) {
      improvements.push({
        type: 'REPEAT_MISS',
        severity: 'medium',
        title: '重复任务多次未完成',
        rationale: '同一重复系列本周有多次未完成',
        suggestion: '调低频率，或把单次改成更小的可完成动作',
        taskIds: ids.slice(0, 5)
      });
      break;
    }
  }

  const reminderMiss = openTasks.filter((task) => task.reminderEnabled);
  if (reminderMiss.length > 0 && improvements.length < MAX_IMPROVEMENTS) {
    improvements.push({
      type: 'REMINDER_INEFFECTIVE',
      severity: 'low',
      title: '开了提醒仍未完成',
      rationale: `有 ${String(reminderMiss.length)} 项开启提醒但尚未完成`,
      suggestion: '检查提醒时间是否过晚，或改到你通常有空的时段',
      taskIds: reminderMiss.slice(0, 5).map((task) => task.id)
    });
  }

  const summary =
    facts.stats.total === 0
      ? '这一周几乎没有记录的安排。下一周可以从每天一两件小事开始。'
      : `本周共 ${String(facts.stats.total)} 项安排，完成 ${String(facts.stats.completed)} 项，未完成 ${String(facts.stats.open)} 项。` +
        (facts.stats.overdueOpen > 0
          ? `其中逾期未完成 ${String(facts.stats.overdueOpen)} 项。`
          : '整体节奏尚可。') +
        (facts.stats.busiestDay !== null
          ? `最忙的一天是 ${facts.stats.busiestDay}（${String(facts.stats.busiestDayCount)} 项）。`
          : '');

  const doneHigh = facts.tasks.filter((task) => task.status === 'DONE' && task.priority === 'HIGH');
  const highlights: WeeklyHighlight[] =
    doneHigh.length > 0
      ? [
          {
            title: `完成了 ${String(doneHigh.length)} 项高优安排`,
            taskIds: doneHigh.slice(0, 3).map((task) => task.id)
          }
        ]
      : [];

  return {
    summary,
    improvements: improvements.slice(0, MAX_IMPROVEMENTS),
    highlights
  };
}

export function sanitizeImprovements(
  improvements: readonly WeeklyImprovement[],
  validIds: ReadonlySet<string>
): readonly WeeklyImprovement[] {
  return improvements
    .map((item) => ({
      ...item,
      taskIds: item.taskIds.filter((id) => validIds.has(id))
    }))
    .filter((item) => item.taskIds.length > 0)
    .slice(0, MAX_IMPROVEMENTS);
}
