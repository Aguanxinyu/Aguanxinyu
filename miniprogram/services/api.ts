import { getApiBaseUrl } from '../config.js';
import type { ClientTask } from '../stores/todo-store.js';

const TOKEN_KEY = 'today-todo:session-token';
const USER_ID_KEY = 'today-todo:user-id';

interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
}

type ApiEnvelope<T> =
  | {
      readonly success: true;
      readonly data: T;
      readonly error: null;
      readonly meta: Readonly<Record<string, unknown>>;
    }
  | {
      readonly success: false;
      readonly data: null;
      readonly error: ApiErrorBody;
      readonly meta: Readonly<Record<string, unknown>>;
    };

interface LoginData {
  readonly token: string;
  readonly userId: string;
}

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

function requestId(): string {
  return `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

export class ApiClient {
  public getStoredToken(): string | null {
    const token = wx.getStorageSync<string>(TOKEN_KEY);
    return typeof token === 'string' && token.length > 0 ? token : null;
  }

  public clearSession(): void {
    wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(USER_ID_KEY);
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

  public listTasks(): Promise<readonly ClientTask[]> {
    return this.request('GET', '/v1/tasks');
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
    isWrite = false
  ): Promise<T> {
    const token = this.getStoredToken();
    return new Promise<T>((resolve, reject) => {
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
        ...(data === undefined ? {} : { data: JSON.stringify(data) }),
        header: {
          'content-type': 'application/json',
          ...(token === null ? {} : { 'x-session-token': token }),
          ...(isWrite ? { 'x-request-id': requestId() } : {})
        },
        success: ({ statusCode, data: responseData }) => {
          if (!isEnvelope<T>(responseData)) {
            reject(new ApiClientError('INVALID_RESPONSE', '服务器返回了无法识别的数据'));
            return;
          }
          if (!responseData.success) {
            if (statusCode === 401) {
              this.clearSession();
            }
            reject(new ApiClientError(responseData.error.code, responseData.error.message));
            return;
          }
          resolve(responseData.data);
        },
        fail: () => {
          reject(new ApiClientError('NETWORK_ERROR', '网络连接失败，请稍后重试'));
        }
      });
    });
  }
}

export const apiClient = new ApiClient();
