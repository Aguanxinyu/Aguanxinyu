import type { Task } from '@today-todo/contracts';
import type { WeeklyReviewFacts } from '@today-todo/domain';

import { ApiService } from './api-service.js';
import type { BackendDatabase } from './database.js';
import type { LlmWeeklyContent } from './llm-client.js';
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
import type { WeeklyReviewRecord, WeeklyReviewView } from './weekly-review-types.js';
import { createFakeWeChatIdentityResolver } from './wechat.js';

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
                    : R extends {
                          readonly method: 'GET';
                          readonly path: '/v1/weekly-reviews' | '/v1/weekly-reviews/current';
                        }
                      ? WeeklyReviewView
                      : R extends {
                            readonly method: 'POST';
                            readonly path: '/v1/weekly-reviews/generate';
                          }
                        ? WeeklyReviewRecord
                        : null;

export interface TestSystemOptions {
  readonly now: number;
  readonly sendShouldFail?: boolean;
  readonly database?: BackendDatabase;
  readonly generateWeeklyReviewWithLlm?: (
    facts: WeeklyReviewFacts
  ) => Promise<LlmWeeklyContent | null>;
}

export interface LoginResult {
  readonly token: string;
  readonly userId: string;
}

export class TestSystem {
  private readonly api: ApiService;
  private readonly schedulers: Schedulers;
  private readonly storage: BackendDatabase;
  private currentTime: number;
  private messages: readonly SentMessage[] = [];
  private errors: readonly string[] = [];

  public constructor(options: TestSystemOptions) {
    this.currentTime = options.now;
    const database = options.database ?? new MemoryDatabase();
    this.storage = database;
    this.api = new ApiService({
      database,
      now: () => this.currentTime,
      resolveWeChatIdentity: createFakeWeChatIdentityResolver(),
      ...(options.generateWeeklyReviewWithLlm === undefined
        ? {}
        : { generateWeeklyReviewWithLlm: options.generateWeeklyReviewWithLlm })
    });
    this.schedulers = new Schedulers({
      database,
      api: this.api,
      now: () => this.currentTime,
      sendMessage: (message) => {
        if (options.sendShouldFail === true) {
          return Promise.reject(new Error('TEST_SEND_FAILURE'));
        }
        this.messages = [...this.messages, message];
        return Promise.resolve();
      },
      reportError: (error, operation) => {
        const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
        this.errors = [...this.errors, `${operation}:${message}`];
      }
    });
  }

  public get sentMessages(): readonly SentMessage[] {
    return this.messages;
  }

  public get database(): BackendDatabase {
    return this.storage;
  }

  public get schedulerErrors(): readonly string[] {
    return this.errors;
  }

  public setNow(now: number): void {
    this.currentTime = now;
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

  public async runMaintenance(throughDate: string): Promise<void> {
    await this.schedulers.materializeAndClean(throughDate);
  }

  public runReminderTicker(at: number): Promise<void> {
    return this.schedulers.dispatchReminders(at);
  }
}

export function createTestSystem(options: TestSystemOptions): TestSystem {
  return new TestSystem(options);
}
