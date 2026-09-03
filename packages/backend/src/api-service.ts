import { createHash, randomBytes } from 'node:crypto';

import type { ApiMeta, RecurrenceRule, Task } from '@today-todo/contracts';
import {
  aiAllowed,
  buildDailyFacts,
  buildRulesDailyReview,
  buildRulesReview,
  buildWeeklyFacts,
  cancelReminder,
  compareSortTuples,
  completeTask,
  createReminderForTask,
  defaultWeekStart,
  DomainError,
  expandOccurrences,
  isValidWeekStart,
  occurrenceKey,
  reactivateReminder,
  reminderTimeFor,
  resolveIdentityMerge,
  restoreTask,
  sortTasks,
  shanghaiDateKey,
  taskBelongsToDate,
  taskOverlapsDateRange,
  taskSortTuple,
  trashTask,
  uncompleteTask,
  validateListName,
  validateTagName,
  validateTaskInput,
  weekEndDateKey,
  weekEndExclusiveMs,
  weekStartForInstant,
  type AuthChannel,
  type DailyReviewFacts,
  type TaskSortTuple,
  type WeChatIdentity,
  type WeeklyReviewFacts
} from '@today-todo/domain';
import { z, ZodError } from 'zod';

import type { BackendDatabase } from './database.js';
import type { DailyReviewRecord, DailyReviewView } from './daily-review-types.js';
import type { LlmDailyContent, LlmWeeklyContent } from './llm-client.js';
import { INBOX_LIST_ID } from './types.js';
import type {
  ApiData,
  AuthData,
  HttpRequest,
  HttpResult,
  ReminderRecord,
  SeriesRecord,
  TaskTemplate,
  TodoList,
  TodoTag,
  UserRecord
} from './types.js';
import type { WeeklyReviewRecord, WeeklyReviewView } from './weekly-review-types.js';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const ACCOUNT_PURGE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_REMINDER_GRANTS = 20;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WEEKLY_GENERATIONS = 5;
const MAX_DAILY_GENERATIONS = 3;
const RECURRENCE_HORIZON_MS = 60 * 24 * 60 * 60 * 1000;

function isValidDateKey(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === (month ?? 0) - 1 &&
    parsed.getUTCDate() === day
  );
}

const locationSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('MAP'),
    name: z.string().min(1).max(100),
    address: z.string().max(200).optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180)
  }),
  z.object({
    source: z.literal('MANUAL'),
    name: z.string().min(1).max(100),
    address: z.string().max(200).optional()
  })
]);

const recurrenceSchema = z.discriminatedUnion('frequency', [
  z.object({
    frequency: z.literal('DAILY'),
    startDate: z.string().refine(isValidDateKey),
    endDate: z.string().refine(isValidDateKey).optional()
  }),
  z.object({
    frequency: z.literal('WEEKLY'),
    startDate: z.string().refine(isValidDateKey),
    endDate: z.string().refine(isValidDateKey).optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7)
  }),
  z.object({
    frequency: z.literal('MONTHLY'),
    startDate: z.string().refine(isValidDateKey),
    endDate: z.string().refine(isValidDateKey).optional(),
    monthDay: z.number().int().min(1).max(31)
  })
]);

const createTaskSchema = z.object({
  title: z.string().max(100),
  notes: z.string().max(1000).optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  startAt: z.number().optional(),
  startHasTime: z.boolean().default(false),
  dueAt: z.number().optional(),
  dueHasTime: z.boolean(),
  listId: z.string().optional(),
  tagIds: z.array(z.string()).max(5),
  location: locationSchema.optional(),
  reminderEnabled: z.boolean().optional(),
  recurrence: recurrenceSchema.optional()
});

const updateTaskSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().max(100).optional(),
  notes: z.string().max(1000).nullable().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  startAt: z.number().nullable().optional(),
  startHasTime: z.boolean().optional(),
  dueAt: z.number().nullable().optional(),
  dueHasTime: z.boolean().optional(),
  listId: z.string().optional(),
  tagIds: z.array(z.string()).max(5).optional(),
  location: locationSchema.nullable().optional(),
  reminderEnabled: z.boolean().optional()
});

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type ReminderSyncResult =
  | { readonly kind: 'active'; readonly reminder: ReminderRecord }
  | { readonly kind: 'disabled'; readonly reminder: ReminderRecord | null }
  | { readonly kind: 'unchanged' };

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE);
}

function decodeCursor(raw: string | undefined): TaskSortTuple | undefined {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      typeof parsed[0] === 'number' &&
      typeof parsed[1] === 'number' &&
      typeof parsed[2] === 'number' &&
      typeof parsed[3] === 'string'
    ) {
      return parsed as unknown as TaskSortTuple;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function encodeCursor(task: Task): string {
  return Buffer.from(JSON.stringify(taskSortTuple(task)), 'utf8').toString('base64url');
}

function success<T>(status: number, data: T, meta: ApiMeta = {}): HttpResult<T> {
  return {
    status,
    body: {
      success: true,
      data,
      error: null,
      meta
    }
  };
}

function failure(status: number, code: string, message: string): HttpResult<never> {
  return {
    status,
    body: {
      success: false,
      data: null,
      error: { code, message },
      meta: {}
    }
  };
}

function asApiData<T extends ApiData>(result: HttpResult<T>): HttpResult<ApiData> {
  return result;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toIdentitySnapshot(user: UserRecord): {
  readonly id: string;
  readonly mpOpenId?: string;
  readonly webOpenId?: string;
  readonly unionId?: string;
} {
  return {
    id: user.id,
    ...(user.mpOpenId === undefined && user.openId === undefined
      ? {}
      : { mpOpenId: user.mpOpenId ?? user.openId }),
    ...(user.webOpenId === undefined ? {} : { webOpenId: user.webOpenId }),
    ...(user.unionId === undefined ? {} : { unionId: user.unionId })
  };
}

function ruleFromInput(input: z.infer<typeof recurrenceSchema>): RecurrenceRule {
  switch (input.frequency) {
    case 'DAILY':
      return input.endDate === undefined
        ? { frequency: 'DAILY' }
        : { frequency: 'DAILY', endDate: input.endDate };
    case 'WEEKLY':
      return input.endDate === undefined
        ? { frequency: 'WEEKLY', weekdays: input.weekdays }
        : {
            frequency: 'WEEKLY',
            weekdays: input.weekdays,
            endDate: input.endDate
          };
    case 'MONTHLY':
      return input.endDate === undefined
        ? { frequency: 'MONTHLY', monthDay: input.monthDay }
        : {
            frequency: 'MONTHLY',
            monthDay: input.monthDay,
            endDate: input.endDate
          };
  }
}

export interface ApiServiceOptions {
  readonly database: BackendDatabase;
  readonly now: () => number;
  readonly resolveWeChatIdentity?: (input: {
    readonly channel: AuthChannel;
    readonly code: string;
  }) => Promise<WeChatIdentity>;
  /** Prefer `resolveWeChatIdentity`. Legacy miniprogram-only adapter. */
  readonly exchangeLoginCode?: (code: string) => Promise<string>;
  readonly generateWeeklyReviewWithLlm?: (
    facts: WeeklyReviewFacts
  ) => Promise<LlmWeeklyContent | null>;
  readonly generateDailyReviewWithLlm?: (
    facts: DailyReviewFacts
  ) => Promise<LlmDailyContent | null>;
}

export class ApiService {
  private readonly database: BackendDatabase;
  private readonly now: () => number;
  private readonly resolveWeChatIdentity: (input: {
    readonly channel: AuthChannel;
    readonly code: string;
  }) => Promise<WeChatIdentity>;
  private readonly generateWeeklyReviewWithLlm?: (
    facts: WeeklyReviewFacts
  ) => Promise<LlmWeeklyContent | null>;
  private readonly generateDailyReviewWithLlm?: (
    facts: DailyReviewFacts
  ) => Promise<LlmDailyContent | null>;

  public constructor(options: ApiServiceOptions) {
    this.database = options.database;
    this.now = options.now;
    if (options.resolveWeChatIdentity !== undefined) {
      this.resolveWeChatIdentity = options.resolveWeChatIdentity;
    } else if (options.exchangeLoginCode !== undefined) {
      const exchange = options.exchangeLoginCode;
      this.resolveWeChatIdentity = async (input) => {
        if (input.channel === 'web') {
          throw new DomainError('WECHAT_WEB_NOT_CONFIGURED');
        }
        const openId = await exchange(input.code);
        return { channel: 'miniprogram', mpOpenId: openId };
      };
    } else {
      throw new Error('ApiService requires resolveWeChatIdentity or exchangeLoginCode');
    }
    if (options.generateWeeklyReviewWithLlm !== undefined) {
      this.generateWeeklyReviewWithLlm = options.generateWeeklyReviewWithLlm;
    }
    if (options.generateDailyReviewWithLlm !== undefined) {
      this.generateDailyReviewWithLlm = options.generateDailyReviewWithLlm;
    }
  }

  public async handle(request: HttpRequest): Promise<HttpResult<ApiData>> {
    try {
      if (request.method === 'POST' && request.path === '/v1/auth/login') {
        return asApiData(await this.login(request.body));
      }

      const method = request.methodOverride ?? request.method;
      const effectiveRequest: HttpRequest =
        method === request.method ? request : { ...request, method };

      if (request.method === 'POST' && request.path === '/v1/auth/logout') {
        return asApiData(await this.logout(request.token, request.requestId));
      }

      const user = await this.authenticate(request.token);
      if (user === undefined) {
        return asApiData(failure(401, 'AUTH_REQUIRED', '登录状态已失效，请重新登录'));
      }

      let idempotencyScope: string | undefined;
      if (method !== 'GET') {
        if (request.requestId === undefined || request.requestId.length === 0) {
          return asApiData(failure(400, 'REQUEST_ID_REQUIRED', '写操作必须提供请求标识'));
        }
        idempotencyScope = `${method}:${request.path}:${request.requestId}`;
        const claim = await this.database.claimIdempotency(
          user.id,
          idempotencyScope,
          this.now(),
          this.now() + IDEMPOTENCY_LIFETIME_MS
        );
        if (claim.kind === 'result') {
          return claim.result;
        }
        if (claim.kind === 'pending') {
          return asApiData(failure(409, 'REQUEST_IN_PROGRESS', '相同请求正在处理中，请稍后重试'));
        }
      }

      try {
        const result = await this.routeAuthenticated(user, effectiveRequest);
        if (idempotencyScope !== undefined) {
          if (result.status >= 200 && result.status < 400) {
            await this.database.saveIdempotentResult(
              user.id,
              idempotencyScope,
              result,
              this.now() + IDEMPOTENCY_LIFETIME_MS
            );
          } else {
            await this.database.releaseIdempotencyClaim(user.id, idempotencyScope);
          }
        }
        return result;
      } catch (error) {
        if (idempotencyScope !== undefined) {
          await this.database.releaseIdempotencyClaim(user.id, idempotencyScope);
        }
        throw error;
      }
    } catch (error) {
      return this.errorResult(error);
    }
  }

  private async login(body: unknown): Promise<HttpResult<AuthData>> {
    const input = z
      .object({
        code: z.string().min(1),
        channel: z.enum(['miniprogram', 'web']).optional()
      })
      .parse(body);
    const channel: AuthChannel = input.channel ?? 'miniprogram';
    const identity = await this.resolveWeChatIdentity({ channel, code: input.code });
    const now = this.now();

    const byUnionId =
      identity.unionId === undefined
        ? undefined
        : await this.database.findUserByUnionId(identity.unionId);
    const byMpOpenId =
      identity.mpOpenId === undefined
        ? undefined
        : await this.database.findUserByMpOpenId(identity.mpOpenId);
    const byWebOpenId =
      identity.webOpenId === undefined
        ? undefined
        : await this.database.findUserByWebOpenId(identity.webOpenId);

    const decision = resolveIdentityMerge(identity, {
      ...(byUnionId === undefined ? {} : { byUnionId: toIdentitySnapshot(byUnionId) }),
      ...(byMpOpenId === undefined ? {} : { byMpOpenId: toIdentitySnapshot(byMpOpenId) }),
      ...(byWebOpenId === undefined ? {} : { byWebOpenId: toIdentitySnapshot(byWebOpenId) })
    });

    if (decision.type === 'conflict') {
      throw new DomainError('IDENTITY_CONFLICT');
    }

    let user: UserRecord;
    if (decision.type === 'create') {
      user = {
        id: await this.database.nextId('user'),
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        ...(decision.mpOpenId === undefined
          ? {}
          : { mpOpenId: decision.mpOpenId, openId: decision.mpOpenId }),
        ...(decision.webOpenId === undefined ? {} : { webOpenId: decision.webOpenId }),
        ...(decision.unionId === undefined ? {} : { unionId: decision.unionId })
      };
      await this.database.saveUser(user);
      await this.database.saveList({
        id: INBOX_LIST_ID,
        userId: user.id,
        name: '收件箱',
        isInbox: true,
        createdAt: now,
        updatedAt: now
      });
    } else {
      const existing = await this.database.findUserById(decision.userId);
      if (existing === undefined) {
        throw new Error(`identity merge target missing: ${decision.userId}`);
      }
      const patched: UserRecord = {
        ...existing,
        ...(decision.patch.mpOpenId === undefined
          ? {}
          : { mpOpenId: decision.patch.mpOpenId, openId: decision.patch.mpOpenId }),
        ...(decision.patch.webOpenId === undefined ? {} : { webOpenId: decision.patch.webOpenId }),
        ...(decision.patch.unionId === undefined ? {} : { unionId: decision.patch.unionId }),
        updatedAt: now
      };
      if (
        decision.patch.mpOpenId !== undefined ||
        decision.patch.webOpenId !== undefined ||
        decision.patch.unionId !== undefined
      ) {
        await this.database.saveUser(patched);
      }
      user = patched;
    }

    if (user.status !== 'ACTIVE') {
      return failure(403, 'ACCOUNT_UNAVAILABLE', '账号正在注销或已被删除');
    }

    const token = randomBytes(32).toString('base64url');
    await this.database.saveSession({
      tokenHash: tokenHash(token),
      userId: user.id,
      expiresAt: now + SESSION_LIFETIME_MS,
      createdAt: now
    });
    return success(200, { token, userId: user.id });
  }

  private async logout(
    token: string | undefined,
    requestId: string | undefined
  ): Promise<HttpResult<null>> {
    if (token === undefined) {
      return failure(401, 'AUTH_REQUIRED', '登录状态已失效，请重新登录');
    }
    if (requestId === undefined || requestId.length === 0) {
      return failure(400, 'REQUEST_ID_REQUIRED', '写操作必须提供请求标识');
    }
    await this.database.revokeSession(tokenHash(token));
    return success(200, null);
  }

  private async authenticate(token: string | undefined): Promise<UserRecord | undefined> {
    if (token === undefined) {
      return undefined;
    }
    const session = await this.database.findActiveSession(tokenHash(token), this.now());
    if (session === undefined) {
      return undefined;
    }
    const user = await this.database.findUserById(session.userId);
    return user?.status === 'ACTIVE' ? user : undefined;
  }

  private async routeAuthenticated(
    user: UserRecord,
    request: HttpRequest
  ): Promise<HttpResult<ApiData>> {
    if (request.method === 'GET' && request.path === '/v1/tasks') {
      return this.listTasks(user, request.query);
    }
    if (request.method === 'GET' && request.path === '/v1/trash') {
      return success(200, sortTasks(await this.database.tasksForUser(user.id, 'TRASHED')));
    }
    if (request.method === 'POST' && request.path === '/v1/tasks') {
      return this.createTask(user, request.body);
    }
    if (request.method === 'GET' && request.path === '/v1/lists') {
      return success(200, await this.database.listsForUser(user.id));
    }
    if (request.method === 'POST' && request.path === '/v1/lists') {
      return this.createList(user, request.body);
    }
    if (request.method === 'GET' && request.path === '/v1/tags') {
      return success(200, await this.database.tagsForUser(user.id));
    }
    if (request.method === 'POST' && request.path === '/v1/tags') {
      return this.createTag(user, request.body);
    }
    if (request.method === 'POST' && request.path === '/v1/reminder-grants') {
      const input = z.object({ accepted: z.boolean() }).parse(request.body);
      const available = input.accepted
        ? await this.database.addReminderGrant(user.id, MAX_REMINDER_GRANTS)
        : await this.database.reminderGrantFor(user.id);
      return success(200, { userId: user.id, available });
    }
    if (request.method === 'POST' && request.path === '/v1/account/deletion') {
      return this.startAccountDeletion(user);
    }
    if (request.method === 'GET' && request.path === '/v1/daily-reviews') {
      return this.getDailyReview(user, request.query);
    }
    if (request.method === 'POST' && request.path === '/v1/daily-reviews/generate') {
      return this.generateDailyReview(user, request.body);
    }
    if (request.method === 'GET' && request.path === '/v1/weekly-reviews/current') {
      return this.getCurrentWeeklyReview(user);
    }
    if (request.method === 'GET' && request.path === '/v1/weekly-reviews') {
      return this.getWeeklyReview(user, request.query);
    }
    if (request.method === 'POST' && request.path === '/v1/weekly-reviews/generate') {
      return this.generateWeeklyReview(user, request.body);
    }

    const listMatch = /^\/v1\/lists\/([^/]+)$/.exec(request.path);
    if (request.method === 'DELETE' && listMatch?.[1] !== undefined) {
      return this.deleteList(user, listMatch[1]);
    }
    const tagMatch = /^\/v1\/tags\/([^/]+)$/.exec(request.path);
    if (request.method === 'DELETE' && tagMatch?.[1] !== undefined) {
      return this.deleteTag(user, tagMatch[1]);
    }
    const restoreMatch = /^\/v1\/trash\/([^/]+)\/restore$/.exec(request.path);
    if (request.method === 'POST' && restoreMatch?.[1] !== undefined) {
      return this.restoreTask(user, restoreMatch[1]);
    }
    const completeMatch = /^\/v1\/tasks\/([^/]+)\/complete$/.exec(request.path);
    if (request.method === 'POST' && completeMatch?.[1] !== undefined) {
      return this.updateTaskState(user, completeMatch[1], 'complete');
    }
    const uncompleteMatch = /^\/v1\/tasks\/([^/]+)\/uncomplete$/.exec(request.path);
    if (request.method === 'POST' && uncompleteMatch?.[1] !== undefined) {
      return this.updateTaskState(user, uncompleteMatch[1], 'uncomplete');
    }
    const taskMatch = /^\/v1\/tasks\/([^/]+)$/.exec(request.path);
    if (taskMatch?.[1] !== undefined) {
      if (request.method === 'GET') {
        return this.getTask(user, taskMatch[1]);
      }
      if (request.method === 'PATCH') {
        return this.updateTask(user, taskMatch[1], request.body);
      }
      if (request.method === 'DELETE') {
        return this.trashTask(user, taskMatch[1]);
      }
    }

    return asApiData(failure(404, 'ROUTE_NOT_FOUND', '请求的接口不存在'));
  }

  private async createTask(user: UserRecord, body: unknown): Promise<HttpResult<Task>> {
    const input = createTaskSchema.parse(body);
    const validation = validateTaskInput(input);
    if (!validation.valid) {
      return failure(400, validation.issues[0]?.code ?? 'TASK_INVALID', '待办信息不完整');
    }

    const listId = input.listId ?? INBOX_LIST_ID;
    if ((await this.database.findList(user.id, listId)) === undefined) {
      return failure(400, 'LIST_NOT_FOUND', '所选清单不存在');
    }
    for (const tagId of input.tagIds) {
      if ((await this.database.findTag(user.id, tagId)) === undefined) {
        return failure(400, 'TAG_NOT_FOUND', '所选标签不存在');
      }
    }

    const now = this.now();
    if (input.recurrence !== undefined) {
      return this.createRecurringTask(user, input, now, listId);
    }

    const task = this.newTask({
      id: await this.database.nextId('task'),
      userId: user.id,
      input,
      listId,
      now
    });
    const reminder =
      input.reminderEnabled === true
        ? createReminderForTask(task, now, await this.database.nextId('reminder'))
        : undefined;
    const savedTask: Task = reminder === undefined ? task : { ...task, remindAt: reminder.fireAt };
    await this.database.saveTask(savedTask);
    if (reminder !== undefined) {
      await this.database.saveReminder({ ...reminder, title: task.title });
    }
    return success(201, savedTask);
  }

  private async createRecurringTask(
    user: UserRecord,
    input: z.infer<typeof createTaskSchema>,
    now: number,
    listId: string
  ): Promise<HttpResult<Task>> {
    const recurrence = input.recurrence;
    if (recurrence === undefined) {
      throw new DomainError('RECURRENCE_INVALID_DATE');
    }
    const seriesId = await this.database.nextId('series');
    const template: TaskTemplate = {
      title: input.title,
      priority: input.priority,
      listId,
      tagIds: input.tagIds,
      startHasTime: input.startHasTime,
      dueHasTime: input.dueHasTime,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.startAt === undefined ? {} : { startAt: input.startAt }),
      ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
      ...(input.location === undefined ? {} : { location: input.location })
    };
    const series: SeriesRecord = {
      id: seriesId,
      userId: user.id,
      status: 'ACTIVE',
      startDate: recurrence.startDate,
      rule: ruleFromInput(recurrence),
      template,
      createdAt: now,
      updatedAt: now
    };
    const horizonDate = shanghaiDateKey(now + RECURRENCE_HORIZON_MS);
    const throughDate = recurrence.startDate > horizonDate ? recurrence.startDate : horizonDate;
    const occurrenceDates = expandOccurrences(series, recurrence.startDate, throughDate);
    const firstDate = occurrenceDates[0];
    if (firstDate === undefined) {
      throw new DomainError('RECURRENCE_INVALID_RANGE');
    }

    const tasks = occurrenceDates.map((date) => this.taskFromSeries(series, date, now));
    let firstTask = tasks[0] as Task;
    let reminder: ReminderRecord | undefined;
    if (input.reminderEnabled === true) {
      reminder = {
        ...createReminderForTask(firstTask, now, await this.database.nextId('reminder')),
        title: firstTask.title
      };
      firstTask = { ...firstTask, remindAt: reminder.fireAt };
      tasks[0] = firstTask;
    }

    await this.database.saveSeries(series);
    for (const task of tasks) {
      await this.database.saveTask(task);
    }
    if (reminder !== undefined) {
      await this.database.saveReminder(reminder);
    }
    await this.database.saveSeries({
      ...series,
      materializedThrough: throughDate
    });
    return success(201, firstTask);
  }

  public taskFromSeries(series: SeriesRecord, occurrenceDate: string, now: number): Task {
    const startMs = Date.parse(`${series.startDate}T00:00:00+08:00`);
    const occurrenceMs = Date.parse(`${occurrenceDate}T00:00:00+08:00`);
    const scheduleOffset = occurrenceMs - startMs;
    return {
      id: occurrenceKey(series.id, occurrenceDate),
      userId: series.userId,
      title: series.template.title,
      priority: series.template.priority,
      status: 'TODO',
      listId: series.template.listId,
      tagIds: series.template.tagIds,
      startHasTime: series.template.startHasTime,
      dueHasTime: series.template.dueHasTime,
      seriesId: series.id,
      occurrenceDate,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...(series.template.notes === undefined ? {} : { notes: series.template.notes }),
      ...(series.template.startAt === undefined
        ? {}
        : { startAt: series.template.startAt + scheduleOffset }),
      ...(series.template.dueAt === undefined
        ? {}
        : { dueAt: series.template.dueAt + scheduleOffset }),
      ...(series.template.location === undefined ? {} : { location: series.template.location })
    };
  }

  private newTask(options: {
    readonly id: string;
    readonly userId: string;
    readonly input: z.infer<typeof createTaskSchema>;
    readonly listId: string;
    readonly now: number;
  }): Task {
    const { id, userId, input, listId, now } = options;
    return {
      id,
      userId,
      title: input.title,
      priority: input.priority,
      status: 'TODO',
      listId,
      tagIds: input.tagIds,
      startHasTime: input.startHasTime,
      dueHasTime: input.dueHasTime,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.startAt === undefined ? {} : { startAt: input.startAt }),
      ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
      ...(input.location === undefined ? {} : { location: input.location })
    };
  }

  private async getTask(user: UserRecord, taskId: string): Promise<HttpResult<Task>> {
    const task = await this.database.findTask(user.id, taskId);
    return task === undefined
      ? failure(404, 'TASK_NOT_FOUND', '待办不存在或已删除')
      : success(200, task);
  }

  private async updateTaskState(
    user: UserRecord,
    taskId: string,
    action: 'complete' | 'uncomplete'
  ): Promise<HttpResult<Task>> {
    const task = await this.database.findTask(user.id, taskId);
    if (task === undefined) {
      return failure(404, 'TASK_NOT_FOUND', '待办不存在或已删除');
    }
    const updated =
      action === 'complete' ? completeTask(task, this.now()) : uncompleteTask(task, this.now());
    if (updated !== task && !(await this.database.saveTask(updated, task.version))) {
      return failure(409, 'VERSION_CONFLICT', '任务已被其他操作修改，请刷新后重试');
    }
    return success(200, updated);
  }

  private async updateTask(
    user: UserRecord,
    taskId: string,
    body: unknown
  ): Promise<HttpResult<Task>> {
    const input = updateTaskSchema.parse(body);
    const existing = await this.database.findTask(user.id, taskId);
    if (existing === undefined) {
      return failure(404, 'TASK_NOT_FOUND', '待办不存在或已删除');
    }
    if (existing.version !== input.version) {
      return failure(409, 'VERSION_CONFLICT', '任务已被其他操作修改，请刷新后重试');
    }

    const listId = input.listId ?? existing.listId;
    if ((await this.database.findList(user.id, listId)) === undefined) {
      return failure(400, 'LIST_NOT_FOUND', '所选清单不存在');
    }
    const tagIds = input.tagIds ?? existing.tagIds;
    for (const tagId of tagIds) {
      if ((await this.database.findTag(user.id, tagId)) === undefined) {
        return failure(400, 'TAG_NOT_FOUND', '所选标签不存在');
      }
    }

    const now = this.now();
    const updated = {
      ...existing,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.notes === undefined || input.notes === null ? {} : { notes: input.notes }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.startAt === undefined || input.startAt === null ? {} : { startAt: input.startAt }),
      ...(input.startHasTime === undefined ? {} : { startHasTime: input.startHasTime }),
      ...(input.dueAt === undefined || input.dueAt === null ? {} : { dueAt: input.dueAt }),
      ...(input.dueHasTime === undefined ? {} : { dueHasTime: input.dueHasTime }),
      ...(input.location === undefined || input.location === null
        ? {}
        : { location: input.location }),
      listId,
      tagIds,
      version: existing.version + 1,
      updatedAt: now
    } satisfies Task;
    if (input.notes === null) {
      delete updated.notes;
    }
    if (input.startAt === null) {
      delete updated.startAt;
    }
    if (input.dueAt === null) {
      delete updated.dueAt;
    }
    if (input.location === null) {
      delete updated.location;
    }
    const validation = validateTaskInput(updated);
    if (!validation.valid) {
      return failure(400, validation.issues[0]?.code ?? 'TASK_INVALID', '待办信息不完整');
    }

    const reminders = await this.database.findRemindersForTask(user.id, taskId);
    const sync = await this.syncReminder(
      existing,
      updated,
      reminders.find(
        (candidate) => candidate.state === 'SCHEDULED' || candidate.state === 'SKIPPED'
      ),
      input.reminderEnabled,
      now
    );
    let savedTask: Task;
    if (sync.kind === 'active') {
      savedTask = { ...updated, remindAt: sync.reminder.fireAt };
    } else if (sync.kind === 'disabled') {
      const withoutReminder = { ...updated };
      delete withoutReminder.remindAt;
      savedTask = withoutReminder;
    } else {
      savedTask = updated;
    }
    if (!(await this.database.saveTask(savedTask, existing.version))) {
      return failure(409, 'VERSION_CONFLICT', '任务已被其他操作修改，请刷新后重试');
    }
    if (sync.kind === 'active') {
      await this.database.saveReminder(sync.reminder);
    } else if (sync.kind === 'disabled' && sync.reminder !== null) {
      await this.database.saveReminder(sync.reminder);
    }
    return success(200, savedTask);
  }

  private async syncReminder(
    original: Task,
    updated: Task,
    existing: ReminderRecord | undefined,
    reminderEnabled: boolean | undefined,
    now: number
  ): Promise<ReminderSyncResult> {
    if (reminderEnabled === true) {
      if (!updated.dueHasTime || updated.dueAt === undefined) {
        throw new DomainError('REMINDER_REQUIRES_DUE_TIME');
      }
      const fireAt = reminderTimeFor(updated.dueAt);
      if (fireAt <= now) {
        throw new DomainError('REMINDER_TOO_LATE');
      }
      if (existing?.state === 'SCHEDULED') {
        return { kind: 'active', reminder: { ...existing, fireAt, taskVersion: updated.version } };
      }
      return {
        kind: 'active',
        reminder: {
          ...createReminderForTask(updated, now, await this.database.nextId('reminder')),
          title: updated.title
        }
      };
    }
    if (reminderEnabled === false) {
      return existing?.state === 'SCHEDULED'
        ? { kind: 'disabled', reminder: { ...cancelReminder(existing), title: existing.title } }
        : { kind: 'disabled', reminder: null };
    }
    const timeChanged =
      original.dueAt !== updated.dueAt || original.dueHasTime !== updated.dueHasTime;
    if (!timeChanged || existing === undefined) {
      // Benign edit: sync taskVersion so the scheduler does not treat the reminder as stale.
      if (existing?.state === 'SCHEDULED') {
        return { kind: 'active', reminder: { ...existing, taskVersion: updated.version } };
      }
      return { kind: 'unchanged' };
    }
    return existing.state === 'SCHEDULED'
      ? { kind: 'disabled', reminder: { ...cancelReminder(existing), title: existing.title } }
      : { kind: 'disabled', reminder: null };
  }

  private async listTasks(
    user: UserRecord,
    query: HttpRequest['query']
  ): Promise<HttpResult<readonly Task[]>> {
    const dueOnRaw = query?.dueOn;
    const dueOn = typeof dueOnRaw === 'string' && dueOnRaw.length > 0 ? dueOnRaw : undefined;
    if (dueOn !== undefined && !isValidDateKey(dueOn)) {
      return failure(400, 'INVALID_DUE_ON', 'dueOn 必须是 YYYY-MM-DD');
    }
    const dueFromRaw = query?.dueFrom;
    const dueFrom =
      typeof dueFromRaw === 'string' && dueFromRaw.length > 0 ? dueFromRaw : undefined;
    if (dueFrom !== undefined && !isValidDateKey(dueFrom)) {
      return failure(400, 'INVALID_DUE_FROM', 'dueFrom 必须是 YYYY-MM-DD');
    }
    const dueToRaw = query?.dueTo;
    const dueTo = typeof dueToRaw === 'string' && dueToRaw.length > 0 ? dueToRaw : undefined;
    if (dueTo !== undefined && !isValidDateKey(dueTo)) {
      return failure(400, 'INVALID_DUE_TO', 'dueTo 必须是 YYYY-MM-DD');
    }
    if (dueFrom !== undefined && dueTo !== undefined && dueFrom > dueTo) {
      return failure(400, 'INVALID_DUE_RANGE', 'dueFrom 不能晚于 dueTo');
    }
    if ((dueFrom !== undefined || dueTo !== undefined) && dueOn !== undefined) {
      return failure(400, 'INVALID_DUE_QUERY', 'dueOn 不能与 dueFrom/dueTo 同时使用');
    }
    const limit = parseLimit(query?.limit);
    const cursor = decodeCursor(query?.cursor);
    const now = this.now();
    const tasks = sortTasks(
      (await this.database.tasksForUser(user.id)).filter((task) => {
        if (task.status === 'TRASHED') {
          return false;
        }
        if (dueFrom !== undefined && dueTo !== undefined) {
          return taskOverlapsDateRange(task, dueFrom, dueTo, now);
        }
        return dueOn === undefined || taskBelongsToDate(task, dueOn, now);
      })
    );
    const startIndex =
      cursor === undefined
        ? 0
        : tasks.findIndex((task) => compareSortTuples(taskSortTuple(task), cursor) > 0);
    const candidates =
      cursor === undefined ? tasks : startIndex === -1 ? [] : tasks.slice(startIndex);
    const page = candidates.slice(0, limit);
    const hasMore = candidates.length > page.length;
    const lastTask = page[page.length - 1];
    const nextCursor = hasMore && lastTask !== undefined ? encodeCursor(lastTask) : undefined;
    const meta: ApiMeta = nextCursor === undefined ? { hasMore } : { cursor: nextCursor, hasMore };
    return success(200, page, meta);
  }

  private async trashTask(user: UserRecord, taskId: string): Promise<HttpResult<Task>> {
    const task = await this.database.findTask(user.id, taskId);
    if (task === undefined) {
      return failure(404, 'TASK_NOT_FOUND', '待办不存在或已删除');
    }
    const updated = trashTask(task, this.now());
    if (!(await this.database.saveTask(updated, task.version))) {
      return failure(409, 'VERSION_CONFLICT', '任务已被其他操作修改，请刷新后重试');
    }
    for (const reminder of await this.database.findRemindersForTask(user.id, taskId)) {
      if (reminder.state === 'SCHEDULED') {
        await this.database.saveReminder({ ...cancelReminder(reminder), title: reminder.title });
      }
    }
    return success(200, updated);
  }

  private async restoreTask(user: UserRecord, taskId: string): Promise<HttpResult<Task>> {
    const task = await this.database.findTask(user.id, taskId);
    if (task === undefined || task.status !== 'TRASHED') {
      return failure(404, 'TASK_NOT_FOUND', '回收站中不存在该待办');
    }
    const listId =
      (await this.database.findList(user.id, task.listId)) === undefined
        ? INBOX_LIST_ID
        : task.listId;
    const now = this.now();
    const restored = {
      ...restoreTask(task, now),
      listId
    };
    if (!(await this.database.saveTask(restored, task.version))) {
      return failure(409, 'VERSION_CONFLICT', '任务已被其他操作修改，请刷新后重试');
    }
    const reminders = await this.database.findRemindersForTask(user.id, taskId);
    const reminder = reminders.find((candidate) => candidate.state === 'SKIPPED');
    if (reminder !== undefined) {
      try {
        await this.database.saveReminder({
          ...reactivateReminder(reminder, now),
          title: reminder.title,
          taskVersion: restored.version
        });
      } catch (error) {
        if (!(error instanceof DomainError)) {
          throw error;
        }
      }
    }
    return success(200, restored);
  }

  private async createList(user: UserRecord, body: unknown): Promise<HttpResult<TodoList>> {
    const input = z.object({ name: z.string() }).parse(body);
    const validation = validateListName(input.name);
    if (!validation.valid) {
      return failure(400, validation.issues[0]?.code ?? 'LIST_INVALID', '清单名称无效');
    }
    if ((await this.database.listsForUser(user.id)).length >= 50) {
      return failure(409, 'LIST_LIMIT_REACHED', '最多只能创建 50 个清单');
    }
    const now = this.now();
    const list: TodoList = {
      id: await this.database.nextId('list'),
      userId: user.id,
      name: input.name,
      isInbox: false,
      createdAt: now,
      updatedAt: now
    };
    await this.database.saveList(list);
    return success(201, list);
  }

  private async deleteList(user: UserRecord, listId: string): Promise<HttpResult<null>> {
    const list = await this.database.findList(user.id, listId);
    if (list === undefined) {
      return failure(404, 'LIST_NOT_FOUND', '清单不存在');
    }
    if (list.isInbox) {
      return failure(409, 'INBOX_IMMUTABLE', '收件箱不能删除');
    }
    await this.database.deleteList(user.id, listId);
    return success(204, null);
  }

  private async createTag(user: UserRecord, body: unknown): Promise<HttpResult<TodoTag>> {
    const input = z
      .object({
        name: z.string(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/)
      })
      .parse(body);
    const validation = validateTagName(input.name);
    if (!validation.valid) {
      return failure(400, validation.issues[0]?.code ?? 'TAG_INVALID', '标签名称无效');
    }
    if ((await this.database.tagsForUser(user.id)).length >= 100) {
      return failure(409, 'TAG_LIMIT_REACHED', '最多只能创建 100 个标签');
    }
    const now = this.now();
    const tag: TodoTag = {
      id: await this.database.nextId('tag'),
      userId: user.id,
      name: input.name,
      color: input.color,
      createdAt: now,
      updatedAt: now
    };
    await this.database.saveTag(tag);
    return success(201, tag);
  }

  private async deleteTag(user: UserRecord, tagId: string): Promise<HttpResult<null>> {
    if ((await this.database.findTag(user.id, tagId)) === undefined) {
      return failure(404, 'TAG_NOT_FOUND', '标签不存在');
    }
    await this.database.deleteTag(user.id, tagId);
    return success(204, null);
  }

  private async collectDailyFacts(
    user: UserRecord,
    date: string,
    now: number
  ): Promise<DailyReviewFacts> {
    const [tasks, lists] = await Promise.all([
      this.database.tasksForUser(user.id),
      this.database.listsForUser(user.id)
    ]);
    return buildDailyFacts({
      date,
      now,
      tasks,
      listNames: Object.fromEntries(lists.map((list) => [list.id, list.name]))
    });
  }

  private dailyFactsHash(facts: DailyReviewFacts): string {
    return createHash('sha256')
      .update(JSON.stringify({ date: facts.date, stats: facts.stats, tasks: facts.tasks }))
      .digest('hex');
  }

  private async getDailyReview(
    user: UserRecord,
    query: HttpRequest['query']
  ): Promise<HttpResult<DailyReviewView>> {
    const date = query?.date;
    if (date === undefined || !isValidDateKey(date)) {
      return failure(400, 'INVALID_REVIEW_DATE', 'date 必须是 YYYY-MM-DD');
    }
    const now = this.now();
    const today = shanghaiDateKey(now);
    if (date > today) {
      return failure(400, 'DAILY_REVIEW_FUTURE', '不能总结未来日期');
    }
    const facts = await this.collectDailyFacts(user, date, now);
    const factsHash = this.dailyFactsHash(facts);
    const review = (await this.database.findDailyReview(user.id, date)) ?? null;
    return success(200, {
      date,
      isCompleteDay: date < today,
      needsRefresh: review !== null && review.factsHash !== factsHash,
      stats: facts.stats,
      review
    });
  }

  private async generateDailyReview(
    user: UserRecord,
    body: unknown
  ): Promise<HttpResult<DailyReviewRecord>> {
    const input = z.object({ date: z.string(), force: z.boolean().optional() }).parse(body);
    if (!isValidDateKey(input.date)) {
      return failure(400, 'INVALID_REVIEW_DATE', 'date 必须是 YYYY-MM-DD');
    }
    const now = this.now();
    if (input.date > shanghaiDateKey(now)) {
      return failure(400, 'DAILY_REVIEW_FUTURE', '不能总结未来日期');
    }
    const facts = await this.collectDailyFacts(user, input.date, now);
    if (facts.stats.total === 0) {
      return failure(400, 'DAILY_REVIEW_EMPTY', '这一天还没有记录的安排');
    }
    const factsHash = this.dailyFactsHash(facts);
    const existing = await this.database.findDailyReview(user.id, input.date);
    if (existing !== undefined && existing.factsHash === factsHash && input.force !== true) {
      return success(200, existing);
    }
    if (existing !== undefined && existing.generationCount >= MAX_DAILY_GENERATIONS) {
      return failure(429, 'DAILY_REVIEW_RATE_LIMITED', '这一天的总结生成次数已达上限');
    }

    const rules = buildRulesDailyReview(facts);
    const llm = await this.generateDailyReviewWithLlm?.(facts);
    const content = llm ?? rules;
    const review: DailyReviewRecord = {
      id: existing?.id ?? (await this.database.nextId('daily')),
      userId: user.id,
      date: input.date,
      status: 'ready',
      source: llm === null || llm === undefined ? 'rules' : 'model',
      stats: facts.stats,
      summary: content.summary,
      highlights: content.highlights,
      blockers: content.blockers,
      tomorrowSuggestions: content.tomorrowSuggestions,
      factsHash,
      ...(llm === null || llm === undefined ? {} : { model: llm.model }),
      generationCount: (existing?.generationCount ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await this.database.saveDailyReview(review);
    return success(200, review);
  }

  private async getCurrentWeeklyReview(user: UserRecord): Promise<HttpResult<WeeklyReviewView>> {
    const now = this.now();
    const weekStart = defaultWeekStart(now);
    return this.buildWeeklyReviewView(user, weekStart, now);
  }

  private async getWeeklyReview(
    user: UserRecord,
    query: HttpRequest['query']
  ): Promise<HttpResult<WeeklyReviewView>> {
    const weekStart = query?.weekStart;
    if (weekStart === undefined || !isValidWeekStart(weekStart)) {
      return failure(400, 'INVALID_WEEK_START', 'weekStart 必须是周一的 YYYY-MM-DD');
    }
    return this.buildWeeklyReviewView(user, weekStart, this.now());
  }

  private async buildWeeklyReviewView(
    user: UserRecord,
    weekStart: string,
    now: number
  ): Promise<HttpResult<WeeklyReviewView>> {
    const facts = await this.collectWeeklyFacts(user, weekStart, now);
    const review = (await this.database.findWeeklyReview(user.id, weekStart)) ?? null;
    const currentWeek = weekStartForInstant(now);
    return success(200, {
      weekStart,
      weekEnd: weekEndDateKey(weekStart),
      label: weekStart === currentWeek ? 'current' : 'previous',
      aiAllowed: aiAllowed(weekStart, now),
      isCompleteWeek: now >= weekEndExclusiveMs(weekStart),
      stats: facts.stats,
      review
    });
  }

  private async collectWeeklyFacts(
    user: UserRecord,
    weekStart: string,
    now: number
  ): Promise<WeeklyReviewFacts> {
    const [tasks, lists] = await Promise.all([
      this.database.tasksForUser(user.id),
      this.database.listsForUser(user.id)
    ]);
    const listNames: Record<string, string> = {};
    for (const list of lists) {
      listNames[list.id] = list.name;
    }
    return buildWeeklyFacts({ weekStart, now, tasks, listNames });
  }

  private async generateWeeklyReview(
    user: UserRecord,
    body: unknown
  ): Promise<HttpResult<WeeklyReviewRecord>> {
    const input = z.object({ weekStart: z.string() }).parse(body);
    if (!isValidWeekStart(input.weekStart)) {
      return failure(400, 'INVALID_WEEK_START', 'weekStart 必须是周一的 YYYY-MM-DD');
    }
    const now = this.now();
    if (!aiAllowed(input.weekStart, now)) {
      return failure(
        403,
        'WEEKLY_REVIEW_AI_NOT_AVAILABLE',
        '本周周报将在周日 19:00 后生成，已结束的周可随时生成'
      );
    }

    const existing = await this.database.findWeeklyReview(user.id, input.weekStart);
    if (existing !== undefined && existing.generationCount >= MAX_WEEKLY_GENERATIONS) {
      return failure(429, 'WEEKLY_REVIEW_RATE_LIMITED', '本周生成次数已达上限，请下周再试');
    }

    const facts = await this.collectWeeklyFacts(user, input.weekStart, now);
    if (facts.stats.total === 0) {
      return failure(400, 'WEEKLY_REVIEW_EMPTY', '这一周还没有记录的安排');
    }

    let source: WeeklyReviewRecord['source'] = 'rules';
    let model: string | undefined;
    const rules = buildRulesReview(facts);
    let summary = rules.summary;
    let improvements = rules.improvements;
    let highlights = rules.highlights;

    if (this.generateWeeklyReviewWithLlm !== undefined) {
      const llm = await this.generateWeeklyReviewWithLlm(facts);
      if (llm !== null) {
        source = 'model';
        model = llm.model;
        summary = llm.summary;
        improvements = llm.improvements;
        highlights = llm.highlights;
      }
    }

    const review: WeeklyReviewRecord = {
      id: existing?.id ?? (await this.database.nextId('weekly')),
      userId: user.id,
      weekStart: input.weekStart,
      status: 'ready',
      source,
      stats: facts.stats,
      summary,
      improvements,
      highlights,
      ...(model === undefined ? {} : { model }),
      generationCount: (existing?.generationCount ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await this.database.saveWeeklyReview(review);
    return success(200, review);
  }

  private async startAccountDeletion(
    user: UserRecord
  ): Promise<HttpResult<{ readonly purgeAfterAt: number }>> {
    const now = this.now();
    const purgeAfterAt = now + ACCOUNT_PURGE_DELAY_MS;
    await this.database.saveUser({
      ...user,
      status: 'DELETION_PENDING',
      deletionRequestedAt: now,
      purgeAfterAt,
      updatedAt: now
    });
    await this.database.revokeUserSessions(user.id);
    return success(202, { purgeAfterAt });
  }

  private errorResult(error: unknown): HttpResult<ApiData> {
    if (error instanceof ZodError) {
      return asApiData(failure(400, 'INPUT_INVALID', '请求参数不符合要求'));
    }
    if (error instanceof DomainError) {
      if (error.code === 'IDENTITY_CONFLICT') {
        return asApiData(failure(409, error.code, '微信身份与已有账号冲突，请联系支持处理'));
      }
      if (error.code === 'WECHAT_NOT_CONFIGURED' || error.code === 'WECHAT_WEB_NOT_CONFIGURED') {
        return asApiData(failure(503, error.code, '微信登录暂未配置'));
      }
      if (error.code === 'WECHAT_LOGIN_FAILED' || error.code === 'WECHAT_WEB_LOGIN_FAILED') {
        return asApiData(failure(401, error.code, '微信登录失败，请重试'));
      }
      return asApiData(failure(409, error.code, '当前状态不允许执行该操作'));
    }
    return asApiData(failure(500, 'INTERNAL_ERROR', '服务暂时不可用，请稍后重试'));
  }
}
