import type { ApiResponse, RecurrenceRule, Task } from '@today-todo/contracts';
import {
  completeTask,
  createReminderForTask,
  DomainError,
  occurrenceKey,
  restoreTask,
  sortTasks,
  trashTask,
  uncompleteTask,
  validateListName,
  validateTagName,
  validateTaskInput
} from '@today-todo/domain';
import { z, ZodError } from 'zod';

import { MemoryDatabase } from './memory-database.js';
import type {
  ApiData,
  AuthData,
  HttpRequest,
  HttpResult,
  SeriesRecord,
  TaskTemplate,
  TodoList,
  TodoTag,
  UserRecord
} from './types.js';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const ACCOUNT_PURGE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

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
    startDate: z.string(),
    endDate: z.string().optional()
  }),
  z.object({
    frequency: z.literal('WEEKLY'),
    startDate: z.string(),
    endDate: z.string().optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1)
  }),
  z.object({
    frequency: z.literal('MONTHLY'),
    startDate: z.string(),
    endDate: z.string().optional(),
    monthDay: z.number().int().min(1).max(31)
  })
]);

const createTaskSchema = z.object({
  title: z.string(),
  notes: z.string().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  dueAt: z.number().optional(),
  dueHasTime: z.boolean(),
  listId: z.string().optional(),
  tagIds: z.array(z.string()),
  location: locationSchema.optional(),
  reminderEnabled: z.boolean().optional(),
  recurrence: recurrenceSchema.optional()
});

function success<T>(status: number, data: T): HttpResult<T> {
  return {
    status,
    body: {
      success: true,
      data,
      error: null,
      meta: {}
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

function asApiData(result: HttpResult<unknown>): HttpResult<ApiData> {
  return result as HttpResult<ApiData>;
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
  readonly database: MemoryDatabase;
  readonly now: () => number;
  readonly exchangeLoginCode: (code: string) => Promise<string>;
}

export class ApiService {
  private readonly database: MemoryDatabase;
  private readonly now: () => number;
  private readonly exchangeLoginCode: (code: string) => Promise<string>;

  public constructor(options: ApiServiceOptions) {
    this.database = options.database;
    this.now = options.now;
    this.exchangeLoginCode = options.exchangeLoginCode;
  }

  public async handle(request: HttpRequest): Promise<HttpResult<ApiData>> {
    try {
      if (request.method === 'POST' && request.path === '/v1/auth/login') {
        return asApiData(await this.login(request.body));
      }

      const user = this.authenticate(request.token);
      if (user === undefined) {
        return asApiData(failure(401, 'AUTH_REQUIRED', '登录状态已失效，请重新登录'));
      }

      if (request.method !== 'GET') {
        if (request.requestId === undefined || request.requestId.length === 0) {
          return asApiData(failure(400, 'REQUEST_ID_REQUIRED', '写操作必须提供请求标识'));
        }
        const existing = this.database.findIdempotentResult(user.id, request.requestId);
        if (existing !== undefined) {
          return existing;
        }
      }

      const result = await this.routeAuthenticated(user, request);
      if (request.method !== 'GET' && request.requestId !== undefined) {
        this.database.saveIdempotentResult(user.id, request.requestId, result);
      }
      return result;
    } catch (error) {
      return this.errorResult(error);
    }
  }

  private async login(body: unknown): Promise<HttpResult<AuthData>> {
    const input = z.object({ code: z.string().min(1) }).parse(body);
    const openId = await this.exchangeLoginCode(input.code);
    const now = this.now();
    const existing = this.database.findUserByOpenId(openId);
    const user =
      existing ??
      ({
        id: this.database.nextId('user'),
        openId,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now
      } satisfies UserRecord);

    if (existing === undefined) {
      this.database.saveUser(user);
      this.database.saveList({
        id: 'inbox',
        userId: user.id,
        name: '收件箱',
        isInbox: true,
        createdAt: now,
        updatedAt: now
      });
    }
    if (user.status !== 'ACTIVE') {
      return failure(403, 'ACCOUNT_UNAVAILABLE', '账号正在注销或已被删除');
    }

    const token = this.database.nextId(`session-${user.id}`);
    this.database.saveSession({
      token,
      userId: user.id,
      expiresAt: now + SESSION_LIFETIME_MS,
      createdAt: now
    });
    return success(200, { token, userId: user.id });
  }

  private authenticate(token: string | undefined): UserRecord | undefined {
    if (token === undefined) {
      return undefined;
    }
    const session = this.database.findActiveSession(token, this.now());
    if (session === undefined) {
      return undefined;
    }
    const user = this.database.findUserById(session.userId);
    return user?.status === 'ACTIVE' ? user : undefined;
  }

  private async routeAuthenticated(
    user: UserRecord,
    request: HttpRequest
  ): Promise<HttpResult<ApiData>> {
    if (request.method === 'GET' && request.path === '/v1/tasks') {
      const tasks = this.database
        .tasksForUser(user.id)
        .filter(({ status }) => status !== 'TRASHED');
      return success(200, sortTasks(tasks));
    }
    if (request.method === 'GET' && request.path === '/v1/trash') {
      return success(200, sortTasks(this.database.tasksForUser(user.id, 'TRASHED')));
    }
    if (request.method === 'POST' && request.path === '/v1/tasks') {
      return this.createTask(user, request.body);
    }
    if (request.method === 'GET' && request.path === '/v1/lists') {
      return success(200, this.database.listsForUser(user.id));
    }
    if (request.method === 'POST' && request.path === '/v1/lists') {
      return this.createList(user, request.body);
    }
    if (request.method === 'GET' && request.path === '/v1/tags') {
      return success(200, this.database.tagsForUser(user.id));
    }
    if (request.method === 'POST' && request.path === '/v1/tags') {
      return this.createTag(user, request.body);
    }
    if (request.method === 'POST' && request.path === '/v1/reminder-grants') {
      const input = z.object({ accepted: z.boolean() }).parse(request.body);
      const available = input.accepted
        ? this.database.addReminderGrant(user.id)
        : this.database.reminderGrantFor(user.id);
      return success(200, { userId: user.id, available });
    }
    if (request.method === 'POST' && request.path === '/v1/account/deletion') {
      return this.startAccountDeletion(user);
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
      if (request.method === 'DELETE') {
        return this.trashTask(user, taskMatch[1]);
      }
    }

    return asApiData(failure(404, 'ROUTE_NOT_FOUND', '请求的接口不存在'));
  }

  private createTask(user: UserRecord, body: unknown): HttpResult<Task> {
    const input = createTaskSchema.parse(body);
    const validation = validateTaskInput(input);
    if (!validation.valid) {
      return failure(400, validation.issues[0]?.code ?? 'TASK_INVALID', '待办信息不完整');
    }

    const listId = input.listId ?? 'inbox';
    if (this.database.findList(user.id, listId) === undefined) {
      return failure(400, 'LIST_NOT_FOUND', '所选清单不存在');
    }
    if (input.tagIds.some((tagId) => this.database.findTag(user.id, tagId) === undefined)) {
      return failure(400, 'TAG_NOT_FOUND', '所选标签不存在');
    }

    const now = this.now();
    if (input.recurrence !== undefined) {
      return this.createRecurringTask(user, input, now, listId);
    }

    const task = this.newTask({
      id: this.database.nextId('task'),
      userId: user.id,
      input,
      listId,
      now
    });
    this.database.saveTask(task);
    if (input.reminderEnabled === true) {
      const reminder = createReminderForTask(task, now, this.database.nextId('reminder'));
      this.database.saveReminder({ ...reminder, title: task.title });
    }
    return success(201, task);
  }

  private createRecurringTask(
    user: UserRecord,
    input: z.infer<typeof createTaskSchema>,
    now: number,
    listId: string
  ): HttpResult<Task> {
    const recurrence = input.recurrence;
    if (recurrence === undefined) {
      throw new DomainError('RECURRENCE_INVALID_DATE');
    }
    const seriesId = this.database.nextId('series');
    const template: TaskTemplate = {
      title: input.title,
      priority: input.priority,
      listId,
      tagIds: input.tagIds,
      dueHasTime: input.dueHasTime,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
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
    this.database.saveSeries(series);
    const task = this.taskFromSeries(series, recurrence.startDate, now);
    this.database.saveTask(task);
    this.database.saveSeries({
      ...series,
      materializedThrough: recurrence.startDate
    });
    return success(201, task);
  }

  public taskFromSeries(series: SeriesRecord, occurrenceDate: string, now: number): Task {
    return {
      id: occurrenceKey(series.id, occurrenceDate),
      userId: series.userId,
      title: series.template.title,
      priority: series.template.priority,
      status: 'TODO',
      listId: series.template.listId,
      tagIds: series.template.tagIds,
      dueHasTime: series.template.dueHasTime,
      seriesId: series.id,
      occurrenceDate,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...(series.template.notes === undefined ? {} : { notes: series.template.notes }),
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
      dueHasTime: input.dueHasTime,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
      ...(input.location === undefined ? {} : { location: input.location })
    };
  }

  private getTask(user: UserRecord, taskId: string): HttpResult<Task> {
    const task = this.database.findTask(user.id, taskId);
    return task === undefined
      ? failure(404, 'TASK_NOT_FOUND', '待办不存在或已删除')
      : success(200, task);
  }

  private updateTaskState(
    user: UserRecord,
    taskId: string,
    action: 'complete' | 'uncomplete'
  ): HttpResult<Task> {
    const task = this.database.findTask(user.id, taskId);
    if (task === undefined) {
      return failure(404, 'TASK_NOT_FOUND', '待办不存在或已删除');
    }
    const updated =
      action === 'complete' ? completeTask(task, this.now()) : uncompleteTask(task, this.now());
    this.database.saveTask(updated);
    return success(200, updated);
  }

  private trashTask(user: UserRecord, taskId: string): HttpResult<Task> {
    const task = this.database.findTask(user.id, taskId);
    if (task === undefined) {
      return failure(404, 'TASK_NOT_FOUND', '待办不存在或已删除');
    }
    const updated = trashTask(task, this.now());
    this.database.saveTask(updated);
    return success(200, updated);
  }

  private restoreTask(user: UserRecord, taskId: string): HttpResult<Task> {
    const task = this.database.findTask(user.id, taskId);
    if (task === undefined || task.status !== 'TRASHED') {
      return failure(404, 'TASK_NOT_FOUND', '回收站中不存在该待办');
    }
    const listId =
      this.database.findList(user.id, task.listId) === undefined ? 'inbox' : task.listId;
    const restored = {
      ...restoreTask(task, this.now()),
      listId
    };
    this.database.saveTask(restored);
    return success(200, restored);
  }

  private createList(user: UserRecord, body: unknown): HttpResult<TodoList> {
    const input = z.object({ name: z.string() }).parse(body);
    const validation = validateListName(input.name);
    if (!validation.valid) {
      return failure(400, validation.issues[0]?.code ?? 'LIST_INVALID', '清单名称无效');
    }
    if (this.database.listsForUser(user.id).length >= 50) {
      return failure(409, 'LIST_LIMIT_REACHED', '最多只能创建 50 个清单');
    }
    const now = this.now();
    const list: TodoList = {
      id: this.database.nextId('list'),
      userId: user.id,
      name: input.name,
      isInbox: false,
      createdAt: now,
      updatedAt: now
    };
    this.database.saveList(list);
    return success(201, list);
  }

  private deleteList(user: UserRecord, listId: string): HttpResult<null> {
    const list = this.database.findList(user.id, listId);
    if (list === undefined) {
      return failure(404, 'LIST_NOT_FOUND', '清单不存在');
    }
    if (list.isInbox) {
      return failure(409, 'INBOX_IMMUTABLE', '收件箱不能删除');
    }
    this.database.deleteList(user.id, listId);
    return success(204, null);
  }

  private createTag(user: UserRecord, body: unknown): HttpResult<TodoTag> {
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
    if (this.database.tagsForUser(user.id).length >= 100) {
      return failure(409, 'TAG_LIMIT_REACHED', '最多只能创建 100 个标签');
    }
    const now = this.now();
    const tag: TodoTag = {
      id: this.database.nextId('tag'),
      userId: user.id,
      name: input.name,
      color: input.color,
      createdAt: now,
      updatedAt: now
    };
    this.database.saveTag(tag);
    return success(201, tag);
  }

  private deleteTag(user: UserRecord, tagId: string): HttpResult<null> {
    if (this.database.findTag(user.id, tagId) === undefined) {
      return failure(404, 'TAG_NOT_FOUND', '标签不存在');
    }
    this.database.deleteTag(user.id, tagId);
    return success(204, null);
  }

  private startAccountDeletion(user: UserRecord): HttpResult<{ readonly purgeAfterAt: number }> {
    const now = this.now();
    const purgeAfterAt = now + ACCOUNT_PURGE_DELAY_MS;
    this.database.saveUser({
      ...user,
      status: 'DELETION_PENDING',
      deletionRequestedAt: now,
      purgeAfterAt,
      updatedAt: now
    });
    this.database.revokeUserSessions(user.id);
    return success(202, { purgeAfterAt });
  }

  private errorResult(error: unknown): HttpResult<ApiData> {
    if (error instanceof ZodError) {
      return asApiData(failure(400, 'INPUT_INVALID', '请求参数不符合要求'));
    }
    if (error instanceof DomainError) {
      return asApiData(failure(409, error.code, '当前状态不允许执行该操作'));
    }
    return asApiData(failure(500, 'INTERNAL_ERROR', '服务暂时不可用，请稍后重试'));
  }
}
