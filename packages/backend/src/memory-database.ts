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

interface IdempotencyRecord {
  readonly key: string;
  readonly result: HttpResult<ApiData>;
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
  idempotency: []
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

export class MemoryDatabase {
  private snapshot: Snapshot = EMPTY_SNAPSHOT;
  private sequence = 0;

  public nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence).padStart(6, '0')}`;
  }

  public findUserByOpenId(openId: string): UserRecord | undefined {
    return this.snapshot.users.find((user) => user.openId === openId);
  }

  public findUserById(userId: string): UserRecord | undefined {
    return this.snapshot.users.find(({ id }) => id === userId);
  }

  public saveUser(user: UserRecord): void {
    this.snapshot = {
      ...this.snapshot,
      users: upsertById(this.snapshot.users, user)
    };
  }

  public saveSession(session: SessionRecord): void {
    this.snapshot = {
      ...this.snapshot,
      sessions: [...this.snapshot.sessions, session]
    };
  }

  public findActiveSession(token: string, now: number): SessionRecord | undefined {
    return this.snapshot.sessions.find(
      (session) => session.token === token && session.expiresAt > now
    );
  }

  public revokeUserSessions(userId: string): void {
    this.snapshot = {
      ...this.snapshot,
      sessions: this.snapshot.sessions.filter((session) => session.userId !== userId)
    };
  }

  public tasksForUser(userId: string, status?: Task['status']): readonly Task[] {
    return this.snapshot.tasks.filter(
      (task) => task.userId === userId && (status === undefined || task.status === status)
    );
  }

  public allTasks(): readonly Task[] {
    return this.snapshot.tasks;
  }

  public findTask(userId: string, taskId: string): Task | undefined {
    return this.snapshot.tasks.find((task) => task.userId === userId && task.id === taskId);
  }

  public saveTask(task: Task): void {
    this.snapshot = {
      ...this.snapshot,
      tasks: upsertByUserAndId(this.snapshot.tasks, task)
    };
  }

  public deleteTask(userId: string, taskId: string): void {
    this.snapshot = {
      ...this.snapshot,
      tasks: this.snapshot.tasks.filter((task) => task.userId !== userId || task.id !== taskId)
    };
  }

  public listsForUser(userId: string): readonly TodoList[] {
    return this.snapshot.lists.filter((list) => list.userId === userId);
  }

  public findList(userId: string, listId: string): TodoList | undefined {
    return this.snapshot.lists.find((list) => list.userId === userId && list.id === listId);
  }

  public saveList(list: TodoList): void {
    this.snapshot = {
      ...this.snapshot,
      lists: upsertByUserAndId(this.snapshot.lists, list)
    };
  }

  public deleteList(userId: string, listId: string): void {
    this.snapshot = {
      ...this.snapshot,
      lists: this.snapshot.lists.filter((list) => list.userId !== userId || list.id !== listId),
      tasks: this.snapshot.tasks.map((task) =>
        task.userId === userId && task.listId === listId
          ? {
              ...task,
              listId: 'inbox',
              version: task.version + 1
            }
          : task
      )
    };
  }

  public tagsForUser(userId: string): readonly TodoTag[] {
    return this.snapshot.tags.filter((tag) => tag.userId === userId);
  }

  public findTag(userId: string, tagId: string): TodoTag | undefined {
    return this.snapshot.tags.find((tag) => tag.userId === userId && tag.id === tagId);
  }

  public saveTag(tag: TodoTag): void {
    this.snapshot = {
      ...this.snapshot,
      tags: upsertByUserAndId(this.snapshot.tags, tag)
    };
  }

  public deleteTag(userId: string, tagId: string): void {
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
  }

  public seriesForUser(userId?: string): readonly SeriesRecord[] {
    return userId === undefined
      ? this.snapshot.series
      : this.snapshot.series.filter((series) => series.userId === userId);
  }

  public saveSeries(series: SeriesRecord): void {
    this.snapshot = {
      ...this.snapshot,
      series: upsertByUserAndId(this.snapshot.series, series)
    };
  }

  public remindersDueAtOrBefore(now: number): readonly ReminderRecord[] {
    return this.snapshot.reminders.filter(
      (reminder) => reminder.state === 'SCHEDULED' && reminder.fireAt <= now
    );
  }

  public saveReminder(reminder: ReminderRecord): void {
    this.snapshot = {
      ...this.snapshot,
      reminders: upsertByUserAndId(this.snapshot.reminders, reminder)
    };
  }

  public reminderGrantFor(userId: string): number {
    return this.snapshot.reminderGrants[userId] ?? 0;
  }

  public addReminderGrant(userId: string): number {
    const available = this.reminderGrantFor(userId) + 1;
    this.snapshot = {
      ...this.snapshot,
      reminderGrants: {
        ...this.snapshot.reminderGrants,
        [userId]: available
      }
    };
    return available;
  }

  public consumeReminderGrant(userId: string): boolean {
    const current = this.reminderGrantFor(userId);
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

  public findIdempotentResult(userId: string, requestId: string): HttpResult<ApiData> | undefined {
    return this.snapshot.idempotency.find(({ key }) => key === `${userId}:${requestId}`)?.result;
  }

  public saveIdempotentResult(
    userId: string,
    requestId: string,
    result: HttpResult<ApiData>
  ): void {
    this.snapshot = {
      ...this.snapshot,
      idempotency: [
        ...this.snapshot.idempotency,
        {
          key: `${userId}:${requestId}`,
          result
        }
      ]
    };
  }

  public purgeUser(userId: string): void {
    this.snapshot = {
      ...this.snapshot,
      users: this.snapshot.users.map((user) =>
        user.id === userId
          ? {
              ...user,
              status: 'DELETED'
            }
          : user
      ),
      sessions: this.snapshot.sessions.filter((session) => session.userId !== userId),
      tasks: this.snapshot.tasks.filter((task) => task.userId !== userId),
      lists: this.snapshot.lists.filter((list) => list.userId !== userId),
      tags: this.snapshot.tags.filter((tag) => tag.userId !== userId),
      series: this.snapshot.series.filter((series) => series.userId !== userId),
      reminders: this.snapshot.reminders.filter((reminder) => reminder.userId !== userId),
      reminderGrants: Object.fromEntries(
        Object.entries(this.snapshot.reminderGrants).filter(([id]) => id !== userId)
      )
    };
  }

  public usersPendingPurge(now: number): readonly UserRecord[] {
    return this.snapshot.users.filter(
      (user) =>
        user.status === 'DELETION_PENDING' &&
        user.purgeAfterAt !== undefined &&
        user.purgeAfterAt <= now
    );
  }
}
