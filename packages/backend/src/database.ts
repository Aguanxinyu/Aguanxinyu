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
import type { WeeklyReviewRecord } from './weekly-review-types.js';

export interface BackendDatabase {
  nextId(prefix: string): Promise<string>;

  findUserByOpenId(openId: string): Promise<UserRecord | undefined>;
  findUserByMpOpenId(mpOpenId: string): Promise<UserRecord | undefined>;
  findUserByWebOpenId(webOpenId: string): Promise<UserRecord | undefined>;
  findUserByUnionId(unionId: string): Promise<UserRecord | undefined>;
  findUserById(userId: string): Promise<UserRecord | undefined>;
  saveUser(user: UserRecord): Promise<void>;
  usersPendingPurge(now: number): Promise<readonly UserRecord[]>;
  /**
   * Retains the user tombstone and permanently removes all user-owned data.
   */
  purgeUser(userId: string): Promise<void>;

  saveSession(session: SessionRecord): Promise<void>;
  findActiveSession(tokenHash: string, now: number): Promise<SessionRecord | undefined>;
  revokeSession(tokenHash: string): Promise<void>;
  revokeUserSessions(userId: string): Promise<void>;
  purgeExpiredSessions(now: number): Promise<void>;
  purgeExpiredIdempotencyResults(now: number): Promise<void>;

  allTasks(): Promise<readonly Task[]>;
  tasksForUser(userId: string, status?: Task['status']): Promise<readonly Task[]>;
  findTask(userId: string, taskId: string): Promise<Task | undefined>;
  saveTask(task: Task): Promise<void>;
  deleteTask(userId: string, taskId: string): Promise<void>;

  listsForUser(userId: string): Promise<readonly TodoList[]>;
  findList(userId: string, listId: string): Promise<TodoList | undefined>;
  saveList(list: TodoList): Promise<void>;
  /**
   * Deletes the list and moves its tasks to the user's inbox, incrementing
   * every affected task version.
   */
  deleteList(userId: string, listId: string): Promise<void>;

  tagsForUser(userId: string): Promise<readonly TodoTag[]>;
  findTag(userId: string, tagId: string): Promise<TodoTag | undefined>;
  saveTag(tag: TodoTag): Promise<void>;
  /**
   * Deletes the tag and removes it from affected tasks, incrementing every
   * affected task version.
   */
  deleteTag(userId: string, tagId: string): Promise<void>;

  seriesForUser(userId?: string): Promise<readonly SeriesRecord[]>;
  saveSeries(series: SeriesRecord): Promise<void>;

  remindersDueAtOrBefore(now: number): Promise<readonly ReminderRecord[]>;
  findRemindersForTask(userId: string, taskId: string): Promise<readonly ReminderRecord[]>;
  saveReminder(reminder: ReminderRecord): Promise<void>;
  reminderGrantFor(userId: string): Promise<number>;
  addReminderGrant(userId: string, maximum: number): Promise<number>;
  consumeReminderGrant(userId: string): Promise<boolean>;

  findIdempotentResult(
    userId: string,
    scope: string,
    now: number
  ): Promise<HttpResult<ApiData> | undefined>;
  saveIdempotentResult(
    userId: string,
    scope: string,
    result: HttpResult<ApiData>,
    expiresAt: number
  ): Promise<void>;

  findWeeklyReview(userId: string, weekStart: string): Promise<WeeklyReviewRecord | undefined>;
  saveWeeklyReview(review: WeeklyReviewRecord): Promise<void>;
}
