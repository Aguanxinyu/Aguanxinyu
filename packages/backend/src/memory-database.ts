import type { Task } from '@today-todo/contracts';

import type { BackendDatabase } from './database.js';
import { INBOX_LIST_ID } from './types.js';
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

interface IdempotencyRecord {
  readonly key: string;
  readonly result: HttpResult<ApiData>;
  readonly expiresAt: number;
}

interface Snapshot {
  readonly users: readonly UserRecord[];
  readonly sessions: readonly SessionRecord[];
  readonly tasks: readonly Task[];
  readonly lists: readonly TodoList[];
  readonly tags: readonly TodoTag[];
  readonly series: readonly SeriesRecord[];
  readonly reminders: readonly ReminderRecord[];
  readonly reminderGrants: Readonly<Record<string, number>>;
  readonly idempotency: readonly IdempotencyRecord[];
  readonly weeklyReviews: readonly WeeklyReviewRecord[];
}

const EMPTY_SNAPSHOT: Snapshot = {
  users: [],
  sessions: [],
  tasks: [],
  lists: [],
  tags: [],
  series: [],
  reminders: [],
  reminderGrants: {},
  idempotency: [],
  weeklyReviews: []
};

function upsertById<T extends { readonly id: string }>(
  items: readonly T[],
  value: T
): readonly T[] {
  const exists = items.some(({ id }) => id === value.id);
  return exists ? items.map((item) => (item.id === value.id ? value : item)) : [...items, value];
}

function upsertByUserAndId<T extends { readonly id: string; readonly userId: string }>(
  items: readonly T[],
  value: T
): readonly T[] {
  const matches = (item: T): boolean => item.userId === value.userId && item.id === value.id;
  return items.some(matches)
    ? items.map((item) => (matches(item) ? value : item))
    : [...items, value];
}

/**
 * In-memory implementation used by tests and local demos. Methods return
 * resolved promises so the type stays compatible with `BackendDatabase`.
 */
export class MemoryDatabase implements BackendDatabase {
  private snapshot: Snapshot = EMPTY_SNAPSHOT;
  private sequence = 0;

  public nextId(prefix: string): Promise<string> {
    this.sequence += 1;
    return Promise.resolve(`${prefix}-${String(this.sequence).padStart(6, '0')}`);
  }

  public findUserByOpenId(openId: string): Promise<UserRecord | undefined> {
    return this.findUserByMpOpenId(openId);
  }

  public findUserByMpOpenId(mpOpenId: string): Promise<UserRecord | undefined> {
    return Promise.resolve(
      this.snapshot.users.find((user) => user.mpOpenId === mpOpenId || user.openId === mpOpenId)
    );
  }

  public findUserByWebOpenId(webOpenId: string): Promise<UserRecord | undefined> {
    return Promise.resolve(this.snapshot.users.find((user) => user.webOpenId === webOpenId));
  }

  public findUserByUnionId(unionId: string): Promise<UserRecord | undefined> {
    return Promise.resolve(this.snapshot.users.find((user) => user.unionId === unionId));
  }

  public findUserById(userId: string): Promise<UserRecord | undefined> {
    return Promise.resolve(this.snapshot.users.find(({ id }) => id === userId));
  }

  public saveUser(user: UserRecord): Promise<void> {
    const normalized: UserRecord = {
      ...user,
      ...(user.mpOpenId !== undefined || user.openId !== undefined
        ? {
            mpOpenId: user.mpOpenId ?? user.openId,
            openId: user.mpOpenId ?? user.openId
          }
        : {})
    };
    this.snapshot = {
      ...this.snapshot,
      users: upsertById(this.snapshot.users, normalized)
    };
    return Promise.resolve();
  }

  public saveSession(session: SessionRecord): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      sessions: [...this.snapshot.sessions, session]
    };
    return Promise.resolve();
  }

  public findActiveSession(tokenHash: string, now: number): Promise<SessionRecord | undefined> {
    return Promise.resolve(
      this.snapshot.sessions.find(
        (session) => session.tokenHash === tokenHash && session.expiresAt > now
      )
    );
  }

  public revokeSession(tokenHash: string): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      sessions: this.snapshot.sessions.filter((session) => session.tokenHash !== tokenHash)
    };
    return Promise.resolve();
  }

  public revokeUserSessions(userId: string): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      sessions: this.snapshot.sessions.filter((session) => session.userId !== userId)
    };
    return Promise.resolve();
  }

  public purgeExpiredSessions(now: number): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      sessions: this.snapshot.sessions.filter(({ expiresAt }) => expiresAt > now)
    };
    return Promise.resolve();
  }

  public purgeExpiredIdempotencyResults(now: number): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      idempotency: this.snapshot.idempotency.filter(({ expiresAt }) => expiresAt > now)
    };
    return Promise.resolve();
  }

  public tasksForUser(userId: string, status?: Task['status']): Promise<readonly Task[]> {
    return Promise.resolve(
      this.snapshot.tasks.filter(
        (task) => task.userId === userId && (status === undefined || task.status === status)
      )
    );
  }

  public allTasks(): Promise<readonly Task[]> {
    return Promise.resolve(this.snapshot.tasks);
  }

  public findTask(userId: string, taskId: string): Promise<Task | undefined> {
    return Promise.resolve(
      this.snapshot.tasks.find((task) => task.userId === userId && task.id === taskId)
    );
  }

  public saveTask(task: Task): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      tasks: upsertByUserAndId(this.snapshot.tasks, task)
    };
    return Promise.resolve();
  }

  public deleteTask(userId: string, taskId: string): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      tasks: this.snapshot.tasks.filter((task) => task.userId !== userId || task.id !== taskId)
    };
    return Promise.resolve();
  }

  public listsForUser(userId: string): Promise<readonly TodoList[]> {
    return Promise.resolve(this.snapshot.lists.filter((list) => list.userId === userId));
  }

  public findList(userId: string, listId: string): Promise<TodoList | undefined> {
    return Promise.resolve(
      this.snapshot.lists.find((list) => list.userId === userId && list.id === listId)
    );
  }

  public saveList(list: TodoList): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      lists: upsertByUserAndId(this.snapshot.lists, list)
    };
    return Promise.resolve();
  }

  public deleteList(userId: string, listId: string): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      lists: this.snapshot.lists.filter((list) => list.userId !== userId || list.id !== listId),
      tasks: this.snapshot.tasks.map((task) =>
        task.userId === userId && task.listId === listId
          ? {
              ...task,
              listId: INBOX_LIST_ID,
              version: task.version + 1
            }
          : task
      )
    };
    return Promise.resolve();
  }

  public tagsForUser(userId: string): Promise<readonly TodoTag[]> {
    return Promise.resolve(this.snapshot.tags.filter((tag) => tag.userId === userId));
  }

  public findTag(userId: string, tagId: string): Promise<TodoTag | undefined> {
    return Promise.resolve(
      this.snapshot.tags.find((tag) => tag.userId === userId && tag.id === tagId)
    );
  }

  public saveTag(tag: TodoTag): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      tags: upsertByUserAndId(this.snapshot.tags, tag)
    };
    return Promise.resolve();
  }

  public deleteTag(userId: string, tagId: string): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      tags: this.snapshot.tags.filter((tag) => tag.userId !== userId || tag.id !== tagId),
      tasks: this.snapshot.tasks.map((task) =>
        task.userId === userId && task.tagIds.includes(tagId)
          ? {
              ...task,
              tagIds: task.tagIds.filter((candidate) => candidate !== tagId),
              version: task.version + 1
            }
          : task
      )
    };
    return Promise.resolve();
  }

  public seriesForUser(userId?: string): Promise<readonly SeriesRecord[]> {
    return Promise.resolve(
      userId === undefined
        ? this.snapshot.series
        : this.snapshot.series.filter((series) => series.userId === userId)
    );
  }

  public saveSeries(series: SeriesRecord): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      series: upsertByUserAndId(this.snapshot.series, series)
    };
    return Promise.resolve();
  }

  public remindersDueAtOrBefore(now: number): Promise<readonly ReminderRecord[]> {
    return Promise.resolve(
      this.snapshot.reminders.filter(
        (reminder) => reminder.state === 'SCHEDULED' && reminder.fireAt <= now
      )
    );
  }

  public findRemindersForTask(userId: string, taskId: string): Promise<readonly ReminderRecord[]> {
    return Promise.resolve(
      this.snapshot.reminders.filter(
        (reminder) => reminder.userId === userId && reminder.taskId === taskId
      )
    );
  }

  public saveReminder(reminder: ReminderRecord): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      reminders: upsertByUserAndId(this.snapshot.reminders, reminder)
    };
    return Promise.resolve();
  }

  public reminderGrantFor(userId: string): Promise<number> {
    return Promise.resolve(this.snapshot.reminderGrants[userId] ?? 0);
  }

  public async addReminderGrant(userId: string, maximum: number): Promise<number> {
    const current = await this.reminderGrantFor(userId);
    const available = Math.min(current + 1, maximum);
    this.snapshot = {
      ...this.snapshot,
      reminderGrants: {
        ...this.snapshot.reminderGrants,
        [userId]: available
      }
    };
    return available;
  }

  public async consumeReminderGrant(userId: string): Promise<boolean> {
    const current = await this.reminderGrantFor(userId);
    if (current < 1) {
      return false;
    }
    this.snapshot = {
      ...this.snapshot,
      reminderGrants: {
        ...this.snapshot.reminderGrants,
        [userId]: current - 1
      }
    };
    return true;
  }

  public findIdempotentResult(
    userId: string,
    scope: string,
    now: number
  ): Promise<HttpResult<ApiData> | undefined> {
    return Promise.resolve(
      this.snapshot.idempotency.find(
        ({ key, expiresAt }) => key === `${userId}:${scope}` && expiresAt > now
      )?.result
    );
  }

  public saveIdempotentResult(
    userId: string,
    scope: string,
    result: HttpResult<ApiData>,
    expiresAt: number
  ): Promise<void> {
    const key = `${userId}:${scope}`;
    this.snapshot = {
      ...this.snapshot,
      idempotency: [
        ...this.snapshot.idempotency.filter((record) => record.key !== key),
        {
          key,
          result,
          expiresAt
        }
      ]
    };
    return Promise.resolve();
  }

  public purgeUser(userId: string): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      users: this.snapshot.users.map((user) =>
        user.id === userId
          ? {
              id: user.id,
              status: 'DELETED',
              createdAt: user.createdAt,
              updatedAt: user.updatedAt
            }
          : user
      ),
      sessions: this.snapshot.sessions.filter((session) => session.userId !== userId),
      tasks: this.snapshot.tasks.filter((task) => task.userId !== userId),
      lists: this.snapshot.lists.filter((list) => list.userId !== userId),
      tags: this.snapshot.tags.filter((tag) => tag.userId !== userId),
      series: this.snapshot.series.filter((series) => series.userId !== userId),
      reminders: this.snapshot.reminders.filter((reminder) => reminder.userId !== userId),
      idempotency: this.snapshot.idempotency.filter(({ key }) => !key.startsWith(`${userId}:`)),
      reminderGrants: Object.fromEntries(
        Object.entries(this.snapshot.reminderGrants).filter(([id]) => id !== userId)
      ),
      weeklyReviews: this.snapshot.weeklyReviews.filter((review) => review.userId !== userId)
    };
    return Promise.resolve();
  }

  public findWeeklyReview(
    userId: string,
    weekStart: string
  ): Promise<WeeklyReviewRecord | undefined> {
    return Promise.resolve(
      this.snapshot.weeklyReviews.find(
        (review) => review.userId === userId && review.weekStart === weekStart
      )
    );
  }

  public saveWeeklyReview(review: WeeklyReviewRecord): Promise<void> {
    const without = this.snapshot.weeklyReviews.filter(
      (candidate) =>
        !(candidate.userId === review.userId && candidate.weekStart === review.weekStart)
    );
    this.snapshot = {
      ...this.snapshot,
      weeklyReviews: [...without, review]
    };
    return Promise.resolve();
  }

  public usersPendingPurge(now: number): Promise<readonly UserRecord[]> {
    return Promise.resolve(
      this.snapshot.users.filter(
        (user) =>
          user.status === 'DELETION_PENDING' &&
          user.purgeAfterAt !== undefined &&
          user.purgeAfterAt <= now
      )
    );
  }
}
