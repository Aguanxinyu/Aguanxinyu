import { getApiBaseUrl } from '../config.js';
import type { ClientTask } from '../stores/todo-store.js';

const TOKEN_KEY = 'today-todo:session-token';
const USER_ID_KEY = 'today-todo:user-id';
const TODO_STATE_KEY = 'today-todo:state';
const REQUEST_TIMEOUT_MS = 15000;

interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
}

interface ApiMetaShape {
  readonly cursor?: string;
  readonly hasMore?: boolean;
}

interface EnvelopeResult<T> {
  readonly data: T;
  readonly meta: ApiMetaShape;
}

type ApiEnvelope<T> =
  | {
      readonly success: true;
      readonly data: T;
      readonly error: null;
      readonly meta: ApiMetaShape;
    }
  | {
      readonly success: false;
      readonly data: null;
      readonly error: ApiErrorBody;
      readonly meta: ApiMetaShape;
    };

interface LoginData {
  readonly token: string;
  readonly userId: string;
}

let reloginPromise: Promise<LoginData> | null = null;

export interface ClientList {
  readonly id: string;
  readonly name: string;
  readonly isInbox: boolean;
}

export interface CreateTaskInput {
  readonly title: string;
  readonly notes?: string;
  readonly priority: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly dueAt?: number;
  readonly dueHasTime: boolean;
  readonly listId?: string;
  readonly tagIds: readonly string[];
  readonly reminderEnabled?: boolean;
  readonly location?:
    | {
        readonly source: 'MANUAL';
        readonly name: string;
      }
    | {
        readonly source: 'MAP';
        readonly name: string;
        readonly address?: string;
        readonly latitude: number;
        readonly longitude: number;
      };
  readonly recurrence?:
    | {
        readonly frequency: 'DAILY';
        readonly startDate: string;
        readonly endDate?: string;
      }
    | {
        readonly frequency: 'WEEKLY';
        readonly startDate: string;
        readonly weekdays: readonly number[];
        readonly endDate?: string;
      }
    | {
        readonly frequency: 'MONTHLY';
        readonly startDate: string;
        readonly monthDay: number;
        readonly endDate?: string;
      };
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'recurrence' | 'reminderEnabled'>> & {
  readonly reminderEnabled?: boolean;
};

export interface TaskListResult {
  readonly tasks: readonly ClientTask[];
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

export class ApiClientError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
  }
}

function isEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  return typeof candidate.success === 'boolean' && 'data' in candidate && 'error' in candidate;
}

function requestId(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    wx.getRandomValues({
      length: 16,
      success: ({ randomValues }) => {
        const identifier = Array.from(new Uint8Array(randomValues), (value) =>
          value.toString(16).padStart(2, '0')
        ).join('');
        resolve(identifier);
      },
      fail: () => {
        reject(new ApiClientError('RANDOM_ID_FAILED', '无法安全生成请求标识'));
      }
    });
  });
}

export class ApiClient {
  public getStoredToken(): string | null {
    const token = wx.getStorageSync<string>(TOKEN_KEY);
    return typeof token === 'string' && token.length > 0 ? token : null;
  }

  public clearSession(): void {
    wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(USER_ID_KEY);
    wx.removeStorageSync(TODO_STATE_KEY);
  }

  public async login(): Promise<LoginData> {
    const code = await new Promise<string>((resolve, reject) => {
      wx.login({
        success: ({ code: loginCode }) => {
          if (loginCode.length > 0) {
            resolve(loginCode);
          } else {
            reject(new ApiClientError('WECHAT_LOGIN_FAILED', '微信登录失败'));
          }
        },
        fail: () => {
          reject(new ApiClientError('WECHAT_LOGIN_FAILED', '微信登录失败'));
        }
      });
    });
    const result = await this.request<LoginData>('POST', '/v1/auth/login', {
      code
    });
    wx.setStorageSync(TOKEN_KEY, result.token);
    wx.setStorageSync(USER_ID_KEY, result.userId);
    return result;
  }

  public async listTasks(cursor?: string): Promise<TaskListResult> {
    const path =
      cursor === undefined || cursor.length === 0
        ? '/v1/tasks'
        : `/v1/tasks?cursor=${encodeURIComponent(cursor)}`;
    const envelope = await this.requestEnvelope<readonly ClientTask[]>('GET', path);
    return {
      tasks: envelope.data,
      cursor: envelope.meta.cursor ?? null,
      hasMore: envelope.meta.hasMore === true
    };
  }

  public getTask(taskId: string): Promise<ClientTask> {
    return this.request('GET', `/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  public updateTask(taskId: string, input: UpdateTaskInput, version: number): Promise<ClientTask> {
    return this.request(
      'POST',
      `/v1/tasks/${encodeURIComponent(taskId)}`,
      { ...input, version },
      true,
      { 'x-http-method-override': 'PATCH' }
    );
  }

  public listLists(): Promise<readonly ClientList[]> {
    return this.request('GET', '/v1/lists');
  }

  public createList(name: string): Promise<ClientList> {
    return this.request('POST', '/v1/lists', { name }, true);
  }

  public deleteList(listId: string): Promise<null> {
    return this.request('DELETE', `/v1/lists/${encodeURIComponent(listId)}`, undefined, true);
  }

  public createTask(input: CreateTaskInput): Promise<ClientTask> {
    return this.request('POST', '/v1/tasks', input, true);
  }

  public completeTask(taskId: string): Promise<ClientTask> {
    return this.request(
      'POST',
      `/v1/tasks/${encodeURIComponent(taskId)}/complete`,
      undefined,
      true
    );
  }

  public uncompleteTask(taskId: string): Promise<ClientTask> {
    return this.request(
      'POST',
      `/v1/tasks/${encodeURIComponent(taskId)}/uncomplete`,
      undefined,
      true
    );
  }

  public trashTask(taskId: string): Promise<ClientTask> {
    return this.request('DELETE', `/v1/tasks/${encodeURIComponent(taskId)}`, undefined, true);
  }

  public listTrash(): Promise<readonly ClientTask[]> {
    return this.request('GET', '/v1/trash');
  }

  public restoreTask(taskId: string): Promise<ClientTask> {
    return this.request('POST', `/v1/trash/${encodeURIComponent(taskId)}/restore`, undefined, true);
  }

  public grantReminder(accepted: boolean): Promise<{ readonly available: number }> {
    return this.request('POST', '/v1/reminder-grants', { accepted }, true);
  }

  public startAccountDeletion(): Promise<{ readonly purgeAfterAt: number }> {
    return this.request('POST', '/v1/account/deletion', undefined, true);
  }

  private request<T>(
    method: 'DELETE' | 'GET' | 'POST',
    path: string,
    data?: unknown,
    isWrite = false,
    extraHeaders?: Readonly<Record<string, string>>
  ): Promise<T> {
    return this.requestEnvelope<T>(method, path, data, isWrite, extraHeaders).then(
      (envelope) => envelope.data
    );
  }

  private async requestEnvelope<T>(
    method: 'DELETE' | 'GET' | 'POST',
    path: string,
    data?: unknown,
    isWrite = false,
    extraHeaders?: Readonly<Record<string, string>>
  ): Promise<EnvelopeResult<T>> {
    const first = await this.sendRequest<T>(method, path, data, isWrite, extraHeaders);
    if (first.envelope.success) {
      return { data: first.envelope.data, meta: first.envelope.meta };
    }
    if (first.status === 401 && path !== '/v1/auth/login') {
      this.clearSession();
      reloginPromise = reloginPromise ?? this.login();
      try {
        await reloginPromise;
      } finally {
        reloginPromise = null;
      }
      const retried = await this.sendRequest<T>(method, path, data, isWrite, extraHeaders);
      if (retried.envelope.success) {
        return { data: retried.envelope.data, meta: retried.envelope.meta };
      }
      throw new ApiClientError(
        retried.status === 401 ? 'AUTH_REQUIRED' : retried.envelope.error.code,
        retried.envelope.error.message
      );
    }
    throw new ApiClientError(first.envelope.error.code, first.envelope.error.message);
  }

  private sendRequest<T>(
    method: 'DELETE' | 'GET' | 'POST',
    path: string,
    data: unknown,
    isWrite: boolean,
    extraHeaders?: Readonly<Record<string, string>>
  ): Promise<{ readonly status: number; readonly envelope: ApiEnvelope<T> }> {
    const token = this.getStoredToken();
    const requestIdForWrite = isWrite ? requestId() : Promise.resolve(null);
    return requestIdForWrite.then((writeRequestId) => {
      return new Promise<{ readonly status: number; readonly envelope: ApiEnvelope<T> }>(
        (resolve, reject) => {
          let baseUrl: string;
          try {
            baseUrl = getApiBaseUrl();
          } catch {
            reject(new ApiClientError('API_NOT_CONFIGURED', '请先配置后端服务地址'));
            return;
          }

          wx.request({
            url: `${baseUrl}${path}`,
            method,
            timeout: REQUEST_TIMEOUT_MS,
            ...(data === undefined ? {} : { data: JSON.stringify(data) }),
            header: {
              'content-type': 'application/json',
              ...(extraHeaders === undefined ? {} : extraHeaders),
              ...(token === null ? {} : { 'x-session-token': token }),
              ...(writeRequestId === null ? {} : { 'x-request-id': writeRequestId })
            },
            success: ({ statusCode, data: responseData }) => {
              if (!isEnvelope<T>(responseData)) {
                reject(new ApiClientError('INVALID_RESPONSE', '服务器返回了无法识别的数据'));
                return;
              }
              resolve({ status: statusCode, envelope: responseData });
            },
            fail: () => {
              reject(new ApiClientError('NETWORK_ERROR', '网络连接失败，请稍后重试'));
            }
          });
        }
      );
    });
  }
}

export const apiClient = new ApiClient();
