import type { Task } from '@today-todo/contracts';

import { ApiService } from './api-service.js';
import { MemoryDatabase } from './memory-database.js';
import { Schedulers } from './schedulers.js';
import type {
  AccountDeletionData,
  AuthData,
  HttpRequest,
  HttpResult,
  ReminderGrant,
  SentMessage,
  TodoList,
  TodoTag
} from './types.js';

type ResponseData<R extends HttpRequest> = R extends {
  readonly method: 'POST';
  readonly path: '/v1/auth/login';
}
  ? AuthData
  : R extends {
        readonly method: 'GET';
        readonly path: '/v1/tasks' | '/v1/trash';
      }
    ? readonly Task[]
    : R extends {
          readonly method: 'POST';
          readonly path: '/v1/tasks';
        }
      ? Task
      : R extends {
            readonly path:
              | `/v1/tasks/${string}`
              | `/v1/tasks/${string}/complete`
              | `/v1/tasks/${string}/uncomplete`
              | `/v1/trash/${string}/restore`;
          }
        ? Task
        : R extends {
              readonly method: 'GET';
              readonly path: '/v1/lists';
            }
          ? readonly TodoList[]
          : R extends {
                readonly method: 'POST';
                readonly path: '/v1/lists';
              }
            ? TodoList
            : R extends {
                  readonly method: 'GET';
                  readonly path: '/v1/tags';
                }
              ? readonly TodoTag[]
              : R extends {
                    readonly method: 'POST';
                    readonly path: '/v1/tags';
                  }
                ? TodoTag
                : R extends {
                      readonly method: 'POST';
                      readonly path: '/v1/reminder-grants';
                    }
                  ? ReminderGrant
                  : R extends {
                        readonly method: 'POST';
                        readonly path: '/v1/account/deletion';
                      }
                    ? AccountDeletionData
                    : null;

export interface TestSystemOptions {
  readonly now: number;
}

export interface LoginResult {
  readonly token: string;
  readonly userId: string;
}

export class TestSystem {
  private readonly api: ApiService;
  private readonly schedulers: Schedulers;
  private messages: readonly SentMessage[] = [];

  public constructor(options: TestSystemOptions) {
    const database = new MemoryDatabase();
    this.api = new ApiService({
      database,
      now: () => options.now,
      exchangeLoginCode: async (code) => `openid:${code}`
    });
    this.schedulers = new Schedulers({
      database,
      api: this.api,
      now: () => options.now,
      sendMessage: async (message) => {
        this.messages = [...this.messages, message];
      }
    });
  }

  public get sentMessages(): readonly SentMessage[] {
    return this.messages;
  }

  public request<const R extends HttpRequest>(request: R): Promise<HttpResult<ResponseData<R>>> {
    return this.api.handle(request) as Promise<HttpResult<ResponseData<R>>>;
  }

  public async login(code: string): Promise<LoginResult> {
    const result = await this.request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { code }
    });
    if (!result.body.success) {
      throw new Error(`TEST_LOGIN_FAILED:${result.body.error.code}`);
    }
    return result.body.data;
  }

  public runMaintenance(throughDate: string): Promise<void> {
    return this.schedulers.materializeAndClean(throughDate);
  }

  public runReminderTicker(at: number): Promise<void> {
    return this.schedulers.dispatchReminders(at);
  }
}

export function createTestSystem(options: TestSystemOptions): TestSystem {
  return new TestSystem(options);
}
