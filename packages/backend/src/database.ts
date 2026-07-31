import type { Task } from '@today-todo/contracts';

import type {
  ApiData,
  HttpResult,
  ReminderRecord,
  SeriesRecord,
  SessionRecord,
  TodoList,
  TodoTag,
  UserRecord
} from './types.js';

export interface BackendDatabase {
  nextId(prefix: string): string;

  findUserByOpenId(openId: string): UserRecord | undefined;
  findUserById(userId: string): UserRecord | undefined;
  saveUser(user: UserRecord): void;
  usersPendingPurge(now: number): readonly UserRecord[];
  purgeUser(userId: string): void;

  saveSession(session: SessionRecord): void;
  findActiveSession(tokenHash: string, now: number): SessionRecord | undefined;
  revokeUserSessions(userId: string): void;
  purgeExpiredSessions(now: number): void;

  allTasks(): readonly Task[];
  tasksForUser(userId: string, status?: Task['status']): readonly Task[];
  findTask(userId: string, taskId: string): Task | undefined;
  saveTask(task: Task): void;
  deleteTask(userId: string, taskId: string): void;

  listsForUser(userId: string): readonly TodoList[];
  findList(userId: string, listId: string): TodoList | undefined;
  saveList(list: TodoList): void;
  deleteList(userId: string, listId: string): void;

  tagsForUser(userId: string): readonly TodoTag[];
  findTag(userId: string, tagId: string): TodoTag | undefined;
  saveTag(tag: TodoTag): void;
  deleteTag(userId: string, tagId: string): void;

  seriesForUser(userId?: string): readonly SeriesRecord[];
  saveSeries(series: SeriesRecord): void;

  remindersDueAtOrBefore(now: number): readonly ReminderRecord[];
  saveReminder(reminder: ReminderRecord): void;
  reminderGrantFor(userId: string): number;
  addReminderGrant(userId: string, maximum: number): number;
  consumeReminderGrant(userId: string): boolean;

  findIdempotentResult(
    userId: string,
    scope: string,
    now: number
  ): HttpResult<ApiData> | undefined;
  saveIdempotentResult(
    userId: string,
    scope: string,
    result: HttpResult<ApiData>,
    expiresAt: number
  ): void;
}
