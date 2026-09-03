import type { Task } from '@today-todo/contracts';

import { shanghaiDateKey, taskBelongsToDate } from './grouping.js';

export interface DailyStats {
  readonly total: number;
  readonly completed: number;
  readonly open: number;
  readonly overdueOpen: number;
  readonly highPriorityOpen: number;
  readonly completionRate: number;
}

export interface DailyTaskFact {
  readonly id: string;
  readonly title: string;
  readonly notes?: string;
  readonly status: 'TODO' | 'DONE';
  readonly priority: Task['priority'];
  readonly listName: string;
  readonly dueAt?: number;
  readonly dueHasTime: boolean;
  readonly completedAt?: number;
}

export interface DailyReviewFacts {
  readonly date: string;
  readonly generatedAt: number;
  readonly stats: DailyStats;
  readonly tasks: readonly DailyTaskFact[];
}

export interface DailyReviewItem {
  readonly title: string;
  readonly detail: string;
  readonly taskIds: readonly string[];
}

export interface DailyReviewContent {
  readonly summary: string;
  readonly highlights: readonly DailyReviewItem[];
  readonly blockers: readonly DailyReviewItem[];
  readonly tomorrowSuggestions: readonly DailyReviewItem[];
}

export interface BuildDailyFactsOptions {
  readonly date: string;
  readonly now: number;
  readonly tasks: readonly Task[];
  readonly listNames: Readonly<Record<string, string>>;
}

function belongsToDailyReview(task: Task, date: string, now: number): boolean {
  if (task.status === 'TRASHED') {
    return false;
  }
  if (task.occurrenceDate === undefined && task.startAt === undefined && task.dueAt === undefined) {
    return shanghaiDateKey(task.createdAt) === date;
  }
  return taskBelongsToDate(task, date, now);
}

function isOverdue(task: Task, date: string, now: number): boolean {
  if (task.status !== 'TODO') {
    return false;
  }
  const today = shanghaiDateKey(now);
  if (date < today) {
    return true;
  }
  return date === today && task.dueHasTime && task.dueAt !== undefined && task.dueAt < now;
}

export function buildDailyFacts(options: BuildDailyFactsOptions): DailyReviewFacts {
  const members = options.tasks.filter((task) =>
    belongsToDailyReview(task, options.date, options.now)
  );
  const facts = members.map((task): DailyTaskFact => ({
    id: task.id,
    title: task.title,
    ...(task.notes === undefined ? {} : { notes: task.notes }),
    status: task.status === 'DONE' ? 'DONE' : 'TODO',
    priority: task.priority,
    listName: options.listNames[task.listId] ?? task.listId,
    ...(task.dueAt === undefined ? {} : { dueAt: task.dueAt }),
    dueHasTime: task.dueHasTime,
    ...(task.completedAt === undefined ? {} : { completedAt: task.completedAt })
  }));
  const completed = facts.filter(({ status }) => status === 'DONE').length;
  const openTasks = members.filter(({ status }) => status === 'TODO');
  const total = facts.length;
  return {
    date: options.date,
    generatedAt: options.now,
    stats: {
      total,
      completed,
      open: total - completed,
      overdueOpen: openTasks.filter((task) => isOverdue(task, options.date, options.now)).length,
      highPriorityOpen: openTasks.filter(({ priority }) => priority === 'HIGH').length,
      completionRate: total === 0 ? 0 : completed / total
    },
    tasks: facts
  };
}

export function buildRulesDailyReview(facts: DailyReviewFacts): DailyReviewContent {
  const completed = facts.tasks.filter(({ status }) => status === 'DONE');
  const open = facts.tasks.filter(({ status }) => status === 'TODO');
  const completionPercent = Math.round(facts.stats.completionRate * 100);
  const summary =
    facts.stats.total === 0
      ? '这一天还没有记录安排。'
      : `这一天共安排 ${String(facts.stats.total)} 项，完成 ${String(facts.stats.completed)} 项，完成率 ${String(completionPercent)}%。${facts.stats.open === 0 ? '所有安排均已完成。' : `还有 ${String(facts.stats.open)} 项待继续处理。`}`;
  const highlights =
    completed.length === 0
      ? []
      : [
          {
            title: '今日完成',
            detail: `完成了 ${completed
              .slice(0, 3)
              .map(({ title }) => `「${title}」`)
              .join('、')}`,
            taskIds: completed.slice(0, 3).map(({ id }) => id)
          }
        ];
  const blockers = open
    .filter(({ priority }) => priority === 'HIGH')
    .slice(0, 3)
    .map((task) => ({
      title: task.title,
      detail: '高优先级任务尚未完成，建议确认阻碍并重新安排。',
      taskIds: [task.id]
    }));
  const tomorrowSuggestions = open.slice(0, 3).map((task) => ({
    title: task.title,
    detail: '建议明确下一步动作，并安排到合适的时间。',
    taskIds: [task.id]
  }));
  return { summary, highlights, blockers, tomorrowSuggestions };
}
