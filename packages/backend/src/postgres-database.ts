import type { ActiveTaskStatus, RecurrenceRule, Task } from '@today-todo/contracts';
import pg from 'pg';

import type { BackendDatabase } from './database.js';
import {
  INBOX_LIST_ID,
  type ApiData,
  type HttpResult,
  type ReminderRecord,
  type SeriesRecord,
  type SessionRecord,
  type TaskTemplate,
  type TodoList,
  type TodoTag,
  type UserRecord
} from './types.js';
import type { WeeklyReviewRecord } from './weekly-review-types.js';

// pg returns BIGINT columns as strings unless a type parser is registered.
pg.types.setTypeParser(20, (value) => parseInt(value, 10));

interface UserRow {
  id: string;
  open_id: string | null;
  mp_open_id: string | null;
  web_open_id: string | null;
  union_id: string | null;
  status: UserRecord['status'];
  deletion_requested_at: number | null;
  purge_after_at: number | null;
  created_at: number;
  updated_at: number;
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}

interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  due_at: number | null;
  due_has_time: boolean;
  priority: Task['priority'];
  status: Task['status'];
  original_status: ActiveTaskStatus | null;
  list_id: string;
  tag_ids: readonly string[];
  location: Exclude<Task['location'], undefined> | null;
  series_id: string | null;
  occurrence_date: string | null;
  remind_at: number | null;
  version: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  trashed_at: number | null;
  purge_after_at: number | null;
}

interface SeriesRow {
  id: string;
  user_id: string;
  status: SeriesRecord['status'];
  start_date: string;
  rule: RecurrenceRule;
  template: TaskTemplate;
  materialized_through: string | null;
  created_at: number;
  updated_at: number;
}

interface ListRow {
  id: string;
  user_id: string;
  name: string;
  is_inbox: boolean;
  created_at: number;
  updated_at: number;
}

interface TagRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: number;
  updated_at: number;
}

interface ReminderRow {
  id: string;
  user_id: string;
  task_id: string;
  task_version: number;
  fire_at: number;
  state: ReminderRecord['state'];
  title: string;
}

interface IdempotencyRow {
  result: HttpResult<ApiData>;
  expires_at: number;
}

function toUserRecord(row: UserRow): UserRecord {
  const mpOpenId = row.mp_open_id ?? row.open_id ?? undefined;
  return {
    id: row.id,
    ...(mpOpenId === undefined ? {} : { mpOpenId, openId: mpOpenId }),
    ...(row.web_open_id === null ? {} : { webOpenId: row.web_open_id }),
    ...(row.union_id === null ? {} : { unionId: row.union_id }),
    status: row.status,
    ...(row.deletion_requested_at !== null
      ? { deletionRequestedAt: row.deletion_requested_at }
      : {}),
    ...(row.purge_after_at !== null ? { purgeAfterAt: row.purge_after_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
}

function toTaskRecord(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    ...(row.notes !== null ? { notes: row.notes } : {}),
    ...(row.due_at !== null ? { dueAt: row.due_at } : {}),
    dueHasTime: row.due_has_time,
    priority: row.priority,
    status: row.status,
    ...(row.original_status !== null ? { originalStatus: row.original_status } : {}),
    listId: row.list_id,
    tagIds: row.tag_ids,
    ...(row.location !== null ? { location: row.location } : {}),
    ...(row.series_id !== null ? { seriesId: row.series_id } : {}),
    ...(row.occurrence_date !== null ? { occurrenceDate: row.occurrence_date } : {}),
    ...(row.remind_at !== null ? { remindAt: row.remind_at } : {}),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
    ...(row.trashed_at !== null ? { trashedAt: row.trashed_at } : {}),
    ...(row.purge_after_at !== null ? { purgeAfterAt: row.purge_after_at } : {})
  };
}

function toSeriesRecord(row: SeriesRow): SeriesRecord {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    startDate: row.start_date,
    rule: row.rule,
    template: row.template,
    ...(row.materialized_through !== null ? { materializedThrough: row.materialized_through } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toListRecord(row: ListRow): TodoList {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    isInbox: row.is_inbox,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTagRecord(row: TagRow): TodoTag {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toReminderRecord(row: ReminderRow): ReminderRecord {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    taskVersion: row.task_version,
    fireAt: row.fire_at,
    state: row.state,
    title: row.title
  };
}

/**
 * PostgreSQL-backed implementation of `BackendDatabase` used in production.
 * The pool is owned by the caller; release it explicitly (e.g. `pool.end()`).
 */
export class PostgresDatabase implements BackendDatabase {
  public constructor(private readonly pool: pg.Pool) {}

  public async nextId(prefix: string): Promise<string> {
    const result = await this.pool.query<{ value: number }>(
      'INSERT INTO sequences (name, value) VALUES ($1, 1) ON CONFLICT (name) DO UPDATE SET value = sequences.value + 1 RETURNING value',
      [prefix]
    );
    return `${prefix}-${String(result.rows[0]?.value).padStart(6, '0')}`;
  }

  public async findUserByOpenId(openId: string): Promise<UserRecord | undefined> {
    return this.findUserByMpOpenId(openId);
  }

  public async findUserByMpOpenId(mpOpenId: string): Promise<UserRecord | undefined> {
    const result = await this.pool.query<UserRow>(
      `SELECT * FROM users
       WHERE mp_open_id = $1 OR open_id = $1
       LIMIT 1`,
      [mpOpenId]
    );
    return result.rows[0] === undefined ? undefined : toUserRecord(result.rows[0]);
  }

  public async findUserByWebOpenId(webOpenId: string): Promise<UserRecord | undefined> {
    const result = await this.pool.query<UserRow>(
      'SELECT * FROM users WHERE web_open_id = $1 LIMIT 1',
      [webOpenId]
    );
    return result.rows[0] === undefined ? undefined : toUserRecord(result.rows[0]);
  }

  public async findUserByUnionId(unionId: string): Promise<UserRecord | undefined> {
    const result = await this.pool.query<UserRow>(
      'SELECT * FROM users WHERE union_id = $1 LIMIT 1',
      [unionId]
    );
    return result.rows[0] === undefined ? undefined : toUserRecord(result.rows[0]);
  }

  public async findUserById(userId: string): Promise<UserRecord | undefined> {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1 LIMIT 1', [
      userId
    ]);
    return result.rows[0] === undefined ? undefined : toUserRecord(result.rows[0]);
  }

  public async saveUser(user: UserRecord): Promise<void> {
    const mpOpenId = user.mpOpenId ?? user.openId ?? null;
    await this.pool.query(
      `INSERT INTO users (
         id, open_id, mp_open_id, web_open_id, union_id, status,
         deletion_requested_at, purge_after_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         open_id = EXCLUDED.open_id,
         mp_open_id = EXCLUDED.mp_open_id,
         web_open_id = EXCLUDED.web_open_id,
         union_id = EXCLUDED.union_id,
         status = EXCLUDED.status,
         deletion_requested_at = EXCLUDED.deletion_requested_at,
         purge_after_at = EXCLUDED.purge_after_at,
         updated_at = EXCLUDED.updated_at`,
      [
        user.id,
        mpOpenId,
        mpOpenId,
        user.webOpenId ?? null,
        user.unionId ?? null,
        user.status,
        user.deletionRequestedAt ?? null,
        user.purgeAfterAt ?? null,
        user.createdAt,
        user.updatedAt
      ]
    );
  }

  public async usersPendingPurge(now: number): Promise<readonly UserRecord[]> {
    const result = await this.pool.query<UserRow>(
      "SELECT * FROM users WHERE status = 'DELETION_PENDING' AND purge_after_at <= $1",
      [now]
    );
    return result.rows.map(toUserRecord);
  }

  public async purgeUser(userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE users SET status = 'DELETED' WHERE id = $1", [userId]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM tasks WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM lists WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM tags WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM series WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM reminders WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM reminder_grants WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM idempotency WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM weekly_reviews WHERE user_id = $1', [userId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async saveSession(session: SessionRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)',
      [session.tokenHash, session.userId, session.expiresAt, session.createdAt]
    );
  }

  public async findActiveSession(
    tokenHash: string,
    now: number
  ): Promise<SessionRecord | undefined> {
    const result = await this.pool.query<SessionRow>(
      'SELECT * FROM sessions WHERE token_hash = $1 AND expires_at > $2 LIMIT 1',
      [tokenHash, now]
    );
    return result.rows[0] === undefined ? undefined : toSessionRecord(result.rows[0]);
  }

  public async revokeSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  public async revokeUserSessions(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }

  public async purgeExpiredSessions(now: number): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
  }

  public async purgeExpiredIdempotencyResults(now: number): Promise<void> {
    await this.pool.query('DELETE FROM idempotency WHERE expires_at <= $1', [now]);
  }

  public async allTasks(): Promise<readonly Task[]> {
    const result = await this.pool.query<TaskRow>('SELECT * FROM tasks');
    return result.rows.map(toTaskRecord);
  }

  public async tasksForUser(userId: string, status?: Task['status']): Promise<readonly Task[]> {
    if (status === undefined) {
      const result = await this.pool.query<TaskRow>(
        'SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at, id',
        [userId]
      );
      return result.rows.map(toTaskRecord);
    }
    const result = await this.pool.query<TaskRow>(
      'SELECT * FROM tasks WHERE user_id = $1 AND status = $2 ORDER BY created_at, id',
      [userId, status]
    );
    return result.rows.map(toTaskRecord);
  }

  public async findTask(userId: string, taskId: string): Promise<Task | undefined> {
    const result = await this.pool.query<TaskRow>(
      'SELECT * FROM tasks WHERE user_id = $1 AND id = $2 LIMIT 1',
      [userId, taskId]
    );
    return result.rows[0] === undefined ? undefined : toTaskRecord(result.rows[0]);
  }

  public async saveTask(task: Task): Promise<void> {
    await this.pool.query(
      `INSERT INTO tasks (
         user_id, id, title, notes, due_at, due_has_time, priority, status, original_status,
         list_id, tag_ids, location, series_id, occurrence_date, remind_at,
         version, created_at, updated_at, completed_at, trashed_at, purge_after_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       ON CONFLICT (user_id, id) DO UPDATE SET
         title = EXCLUDED.title,
         notes = EXCLUDED.notes,
         due_at = EXCLUDED.due_at,
         due_has_time = EXCLUDED.due_has_time,
         priority = EXCLUDED.priority,
         status = EXCLUDED.status,
         original_status = EXCLUDED.original_status,
         list_id = EXCLUDED.list_id,
         tag_ids = EXCLUDED.tag_ids,
         location = EXCLUDED.location,
         series_id = EXCLUDED.series_id,
         occurrence_date = EXCLUDED.occurrence_date,
         remind_at = EXCLUDED.remind_at,
         version = EXCLUDED.version,
         updated_at = EXCLUDED.updated_at,
         completed_at = EXCLUDED.completed_at,
         trashed_at = EXCLUDED.trashed_at,
         purge_after_at = EXCLUDED.purge_after_at`,
      [
        task.userId,
        task.id,
        task.title,
        task.notes ?? null,
        task.dueAt ?? null,
        task.dueHasTime,
        task.priority,
        task.status,
        task.originalStatus ?? null,
        task.listId,
        JSON.stringify(task.tagIds),
        task.location ?? null,
        task.seriesId ?? null,
        task.occurrenceDate ?? null,
        task.remindAt ?? null,
        task.version,
        task.createdAt,
        task.updatedAt,
        task.completedAt ?? null,
        task.trashedAt ?? null,
        task.purgeAfterAt ?? null
      ]
    );
  }

  public async deleteTask(userId: string, taskId: string): Promise<void> {
    await this.pool.query('DELETE FROM tasks WHERE user_id = $1 AND id = $2', [userId, taskId]);
  }

  public async listsForUser(userId: string): Promise<readonly TodoList[]> {
    const result = await this.pool.query<ListRow>(
      'SELECT * FROM lists WHERE user_id = $1 ORDER BY created_at, id',
      [userId]
    );
    return result.rows.map(toListRecord);
  }

  public async findList(userId: string, listId: string): Promise<TodoList | undefined> {
    const result = await this.pool.query<ListRow>(
      'SELECT * FROM lists WHERE user_id = $1 AND id = $2 LIMIT 1',
      [userId, listId]
    );
    return result.rows[0] === undefined ? undefined : toListRecord(result.rows[0]);
  }

  public async saveList(list: TodoList): Promise<void> {
    await this.pool.query(
      `INSERT INTO lists (user_id, id, name, is_inbox, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, id) DO UPDATE SET
         name = EXCLUDED.name,
         is_inbox = EXCLUDED.is_inbox,
         updated_at = EXCLUDED.updated_at`,
      [list.userId, list.id, list.name, list.isInbox, list.createdAt, list.updatedAt]
    );
  }

  public async deleteList(userId: string, listId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM lists WHERE user_id = $1 AND id = $2', [userId, listId]);
      await client.query(
        'UPDATE tasks SET list_id = $1, version = version + 1 WHERE user_id = $2 AND list_id = $3',
        [INBOX_LIST_ID, userId, listId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async tagsForUser(userId: string): Promise<readonly TodoTag[]> {
    const result = await this.pool.query<TagRow>(
      'SELECT * FROM tags WHERE user_id = $1 ORDER BY created_at, id',
      [userId]
    );
    return result.rows.map(toTagRecord);
  }

  public async findTag(userId: string, tagId: string): Promise<TodoTag | undefined> {
    const result = await this.pool.query<TagRow>(
      'SELECT * FROM tags WHERE user_id = $1 AND id = $2 LIMIT 1',
      [userId, tagId]
    );
    return result.rows[0] === undefined ? undefined : toTagRecord(result.rows[0]);
  }

  public async saveTag(tag: TodoTag): Promise<void> {
    await this.pool.query(
      `INSERT INTO tags (user_id, id, name, color, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, id) DO UPDATE SET
         name = EXCLUDED.name,
         color = EXCLUDED.color,
         updated_at = EXCLUDED.updated_at`,
      [tag.userId, tag.id, tag.name, tag.color, tag.createdAt, tag.updatedAt]
    );
  }

  public async deleteTag(userId: string, tagId: string): Promise<void> {
    await this.pool.query('DELETE FROM tags WHERE user_id = $1 AND id = $2', [userId, tagId]);
    await this.pool.query(
      `UPDATE tasks SET tag_ids = COALESCE(
         (SELECT jsonb_agg(elem) FROM jsonb_array_elements(tag_ids) AS elem WHERE elem <> $2),
         '[]'::jsonb
       ), version = version + 1
       WHERE user_id = $1 AND tag_ids @> $2::jsonb`,
      [userId, JSON.stringify(tagId)]
    );
  }

  public async seriesForUser(userId?: string): Promise<readonly SeriesRecord[]> {
    if (userId === undefined) {
      const result = await this.pool.query<SeriesRow>('SELECT * FROM series');
      return result.rows.map(toSeriesRecord);
    }
    const result = await this.pool.query<SeriesRow>(
      'SELECT * FROM series WHERE user_id = $1 ORDER BY created_at, id',
      [userId]
    );
    return result.rows.map(toSeriesRecord);
  }

  public async saveSeries(series: SeriesRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO series (
         user_id, id, status, start_date, rule, template, materialized_through, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, id) DO UPDATE SET
         status = EXCLUDED.status,
         start_date = EXCLUDED.start_date,
         rule = EXCLUDED.rule,
         template = EXCLUDED.template,
         materialized_through = EXCLUDED.materialized_through,
         updated_at = EXCLUDED.updated_at`,
      [
        series.userId,
        series.id,
        series.status,
        series.startDate,
        series.rule,
        series.template,
        series.materializedThrough ?? null,
        series.createdAt,
        series.updatedAt
      ]
    );
  }

  public async remindersDueAtOrBefore(now: number): Promise<readonly ReminderRecord[]> {
    const result = await this.pool.query<ReminderRow>(
      "SELECT * FROM reminders WHERE state = 'SCHEDULED' AND fire_at <= $1 ORDER BY fire_at, id",
      [now]
    );
    return result.rows.map(toReminderRecord);
  }

  public async findRemindersForTask(
    userId: string,
    taskId: string
  ): Promise<readonly ReminderRecord[]> {
    const result = await this.pool.query<ReminderRow>(
      'SELECT * FROM reminders WHERE user_id = $1 AND task_id = $2 ORDER BY fire_at, id',
      [userId, taskId]
    );
    return result.rows.map(toReminderRecord);
  }

  public async saveReminder(reminder: ReminderRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO reminders (id, user_id, task_id, task_version, fire_at, state, title)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         task_id = EXCLUDED.task_id,
         task_version = EXCLUDED.task_version,
         fire_at = EXCLUDED.fire_at,
         state = EXCLUDED.state,
         title = EXCLUDED.title`,
      [
        reminder.id,
        reminder.userId,
        reminder.taskId,
        reminder.taskVersion,
        reminder.fireAt,
        reminder.state,
        reminder.title
      ]
    );
  }

  public async reminderGrantFor(userId: string): Promise<number> {
    const result = await this.pool.query<{ available: number }>(
      'SELECT available FROM reminder_grants WHERE user_id = $1',
      [userId]
    );
    return result.rows[0]?.available ?? 0;
  }

  public async addReminderGrant(userId: string, maximum: number): Promise<number> {
    const result = await this.pool.query<{ available: number }>(
      `INSERT INTO reminder_grants (user_id, available) VALUES ($1, 1)
       ON CONFLICT (user_id) DO UPDATE SET available = LEAST(reminder_grants.available + 1, $2)
       RETURNING available`,
      [userId, maximum]
    );
    return result.rows[0]?.available ?? 0;
  }

  public async consumeReminderGrant(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE reminder_grants SET available = available - 1 WHERE user_id = $1 AND available >= 1',
      [userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async findIdempotentResult(
    userId: string,
    scope: string,
    now: number
  ): Promise<HttpResult<ApiData> | undefined> {
    const result = await this.pool.query<IdempotencyRow>(
      'SELECT result FROM idempotency WHERE user_id = $1 AND scope = $2 AND expires_at > $3 LIMIT 1',
      [userId, scope, now]
    );
    return result.rows[0]?.result;
  }

  public async saveIdempotentResult(
    userId: string,
    scope: string,
    result: HttpResult<ApiData>,
    expiresAt: number
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO idempotency (user_id, scope, result, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, scope) DO UPDATE SET result = EXCLUDED.result, expires_at = EXCLUDED.expires_at`,
      [userId, scope, result, expiresAt]
    );
  }

  public async findWeeklyReview(
    userId: string,
    weekStart: string
  ): Promise<WeeklyReviewRecord | undefined> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      week_start: string;
      status: WeeklyReviewRecord['status'];
      source: WeeklyReviewRecord['source'];
      stats: WeeklyReviewRecord['stats'];
      summary: string;
      improvements: WeeklyReviewRecord['improvements'];
      highlights: WeeklyReviewRecord['highlights'];
      model: string | null;
      error_code: string | null;
      generation_count: number;
      created_at: number;
      updated_at: number;
    }>('SELECT * FROM weekly_reviews WHERE user_id = $1 AND week_start = $2 LIMIT 1', [
      userId,
      weekStart
    ]);
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      id: row.id,
      userId: row.user_id,
      weekStart: row.week_start,
      status: row.status,
      source: row.source,
      stats: row.stats,
      summary: row.summary,
      improvements: row.improvements,
      highlights: row.highlights,
      ...(row.model === null ? {} : { model: row.model }),
      ...(row.error_code === null ? {} : { errorCode: row.error_code }),
      generationCount: row.generation_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public async saveWeeklyReview(review: WeeklyReviewRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO weekly_reviews (
         id, user_id, week_start, status, source, stats, summary, improvements, highlights,
         model, error_code, generation_count, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (user_id, week_start) DO UPDATE SET
         id = EXCLUDED.id,
         status = EXCLUDED.status,
         source = EXCLUDED.source,
         stats = EXCLUDED.stats,
         summary = EXCLUDED.summary,
         improvements = EXCLUDED.improvements,
         highlights = EXCLUDED.highlights,
         model = EXCLUDED.model,
         error_code = EXCLUDED.error_code,
         generation_count = EXCLUDED.generation_count,
         updated_at = EXCLUDED.updated_at`,
      [
        review.id,
        review.userId,
        review.weekStart,
        review.status,
        review.source,
        JSON.stringify(review.stats),
        review.summary,
        JSON.stringify(review.improvements),
        JSON.stringify(review.highlights),
        review.model ?? null,
        review.errorCode ?? null,
        review.generationCount,
        review.createdAt,
        review.updatedAt
      ]
    );
  }
}
