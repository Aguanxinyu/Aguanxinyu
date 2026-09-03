const TOKEN_KEY = 'today-todo:session-token';
const USER_KEY = 'today-todo:user-id';
const WECHAT_OAUTH_STATE_KEY = 'today-todo:wechat-oauth-state';

export interface ApiErrorBody {
  readonly success: false;
  readonly error: { readonly code: string; readonly message: string };
}

export interface ApiSuccessBody<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: Record<string, unknown>;
}

export type ApiBody<T> = ApiSuccessBody<T> | ApiErrorBody;

export interface AuthData {
  readonly token: string;
  readonly userId: string;
}

export interface Task {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly notes?: string;
  readonly dueAt?: number;
  readonly dueHasTime: boolean;
  readonly priority: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly status: 'TODO' | 'DONE' | 'TRASHED';
  readonly listId: string;
  readonly tagIds: readonly string[];
  readonly location?: { readonly source: string; readonly name: string; readonly address?: string };
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number;
}

export interface TodoList {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly isInbox: boolean;
}

export interface WeeklyReviewView {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly aiAllowed: boolean;
  readonly stats: {
    readonly total: number;
    readonly completed: number;
    readonly open: number;
    readonly overdueOpen: number;
    readonly highPriorityTotal: number;
    readonly highPriorityCompleted: number;
    readonly highPriorityCompletionRate: number;
  };
  readonly review: null | {
    readonly summary: string;
    readonly source: 'model' | 'rules';
    readonly improvements: readonly {
      readonly type: string;
      readonly title: string;
      readonly rationale: string;
      readonly suggestion: string;
      readonly severity: string;
      readonly taskIds: readonly string[];
    }[];
    readonly highlights: readonly {
      readonly title: string;
      readonly taskIds: readonly string[];
    }[];
  };
}

export interface DailyReviewItem {
  readonly title: string;
  readonly detail: string;
  readonly taskIds: readonly string[];
}

export interface DailyReviewRecord {
  readonly summary: string;
  readonly source: 'model' | 'rules';
  readonly model?: string;
  readonly generationCount: number;
  readonly highlights: readonly DailyReviewItem[];
  readonly blockers: readonly DailyReviewItem[];
  readonly tomorrowSuggestions: readonly DailyReviewItem[];
}

export interface DailyReviewView {
  readonly date: string;
  readonly isCompleteDay: boolean;
  readonly needsRefresh: boolean;
  readonly stats: {
    readonly total: number;
    readonly completed: number;
    readonly open: number;
    readonly overdueOpen: number;
    readonly highPriorityOpen: number;
    readonly completionRate: number;
  };
  readonly review: DailyReviewRecord | null;
}

function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  return configured !== undefined && configured.length > 0 ? configured.replace(/\/$/, '') : '';
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUserId(): string | null {
  return localStorage.getItem(USER_KEY);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function saveSession(auth: AuthData): void {
  localStorage.setItem(TOKEN_KEY, auth.token);
  localStorage.setItem(USER_KEY, auth.userId);
}

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${String(Date.now())}-${Math.random().toString(16).slice(2)}`;
}

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly status: number;

  public constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

async function requestEnvelope<T>(
  method: string,
  path: string,
  options: {
    readonly body?: unknown;
    readonly query?: Record<string, string>;
    readonly write?: boolean;
    readonly methodOverride?: 'PATCH';
  } = {}
): Promise<ApiSuccessBody<T>> {
  const url = new URL(`${apiBase()}${path}`, window.location.origin);
  if (options.query !== undefined) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }
  const token = getToken();
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (token !== null) {
    headers['x-session-token'] = token;
  }
  if (options.write === true) {
    headers['x-request-id'] = requestId();
  }
  if (options.methodOverride !== undefined) {
    headers['x-http-method-override'] = options.methodOverride;
  }
  const response = await fetch(url, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  const payload = (await response.json()) as ApiBody<T>;
  if (!payload.success) {
    if (response.status === 401) {
      clearSession();
    }
    throw new ApiClientError(response.status, payload.error.code, payload.error.message);
  }
  return payload;
}

function request<T>(
  method: string,
  path: string,
  options: {
    readonly body?: unknown;
    readonly query?: Record<string, string>;
    readonly write?: boolean;
    readonly methodOverride?: 'PATCH';
  } = {}
): Promise<T> {
  return requestEnvelope<T>(method, path, options).then(({ data }) => data);
}

export function loginWithCode(
  code: string,
  channel: 'miniprogram' | 'web' = 'web'
): Promise<AuthData> {
  return request<AuthData>('POST', '/v1/auth/login', {
    body: { code, channel }
  });
}

export function logout(): Promise<null> {
  return request<null>('POST', '/v1/auth/logout', { write: true });
}

export async function listTasks(dueOn?: string): Promise<readonly Task[]> {
  const tasks: Task[] = [];
  let cursor: string | undefined;
  do {
    const query = {
      ...(dueOn === undefined ? {} : { dueOn }),
      ...(cursor === undefined ? {} : { cursor })
    };
    const page = await requestEnvelope<readonly Task[]>('GET', '/v1/tasks', {
      ...(Object.keys(query).length === 0 ? {} : { query })
    });
    tasks.push(...page.data);
    const nextCursor = page.meta?.cursor;
    cursor = page.meta?.hasMore === true && typeof nextCursor === 'string' ? nextCursor : undefined;
  } while (cursor !== undefined);
  return tasks;
}

export function createTask(input: {
  readonly title: string;
  readonly notes?: string;
  readonly priority?: Task['priority'];
  readonly dueAt?: number;
  readonly dueHasTime?: boolean;
  readonly listId?: string;
  readonly locationName?: string;
}): Promise<Task> {
  return request<Task>('POST', '/v1/tasks', {
    write: true,
    body: {
      title: input.title,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      priority: input.priority ?? 'MEDIUM',
      dueHasTime: input.dueHasTime ?? false,
      ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
      ...(input.listId === undefined ? {} : { listId: input.listId }),
      tagIds: [],
      ...(input.locationName === undefined || input.locationName.length === 0
        ? {}
        : { location: { source: 'MANUAL', name: input.locationName } })
    }
  });
}

export function completeTask(taskId: string): Promise<Task> {
  return request<Task>('POST', `/v1/tasks/${taskId}/complete`, { write: true });
}

export function uncompleteTask(taskId: string): Promise<Task> {
  return request<Task>('POST', `/v1/tasks/${taskId}/uncomplete`, { write: true });
}

export function trashTask(taskId: string): Promise<Task> {
  return request<Task>('DELETE', `/v1/tasks/${taskId}`, { write: true });
}

export function updateTask(
  taskId: string,
  body: {
    readonly version: number;
    readonly title?: string;
    readonly notes?: string | null;
    readonly priority?: Task['priority'];
    readonly dueAt?: number | null;
    readonly dueHasTime?: boolean;
    readonly location?: { readonly source: 'MANUAL'; readonly name: string } | null;
  }
): Promise<Task> {
  return request<Task>('POST', `/v1/tasks/${taskId}`, {
    write: true,
    methodOverride: 'PATCH',
    body
  });
}

export function listTrash(): Promise<readonly Task[]> {
  return request<readonly Task[]>('GET', '/v1/trash');
}

export function restoreTask(taskId: string): Promise<Task> {
  return request<Task>('POST', `/v1/trash/${taskId}/restore`, { write: true });
}

export function listLists(): Promise<readonly TodoList[]> {
  return request<readonly TodoList[]>('GET', '/v1/lists');
}

export function createList(name: string): Promise<TodoList> {
  return request<TodoList>('POST', '/v1/lists', { write: true, body: { name } });
}

export function deleteList(listId: string): Promise<null> {
  return request<null>('DELETE', `/v1/lists/${listId}`, { write: true });
}

export function getCurrentWeeklyReview(): Promise<WeeklyReviewView> {
  return request<WeeklyReviewView>('GET', '/v1/weekly-reviews/current');
}

export function generateWeeklyReview(weekStart: string): Promise<unknown> {
  return request('POST', '/v1/weekly-reviews/generate', {
    write: true,
    body: { weekStart }
  });
}

export function getDailyReview(date: string): Promise<DailyReviewView> {
  return request('GET', '/v1/daily-reviews', { query: { date } });
}

export function generateDailyReview(date: string, force = false): Promise<DailyReviewRecord> {
  return request('POST', '/v1/daily-reviews/generate', {
    write: true,
    body: { date, force }
  });
}

export function startAccountDeletion(): Promise<{ readonly purgeAfterAt: number }> {
  return request('POST', '/v1/account/deletion', { write: true });
}

export function wechatQrConnectUrl(): string | null {
  const appId = import.meta.env.VITE_WECHAT_WEB_APP_ID;
  const redirect = import.meta.env.VITE_WECHAT_REDIRECT_URI;
  if (appId === undefined || appId.length === 0) {
    return null;
  }
  const redirectUri = encodeURIComponent(
    redirect !== undefined && redirect.length > 0 ? redirect : `${window.location.origin}/#/login`
  );
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const state = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(WECHAT_OAUTH_STATE_KEY, state);
  return `https://open.weixin.qq.com/connect/qrconnect?appid=${encodeURIComponent(appId)}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_login&state=${state}#wechat_redirect`;
}

export function consumeWechatOAuthState(received: string | null): boolean {
  const expected = sessionStorage.getItem(WECHAT_OAUTH_STATE_KEY);
  sessionStorage.removeItem(WECHAT_OAUTH_STATE_KEY);
  return expected !== null && received !== null && received === expected;
}

export function allowDevLogin(): boolean {
  return !import.meta.env.PROD && import.meta.env.VITE_ALLOW_DEV_LOGIN === '1';
}

/** Asia/Shanghai YYYY-MM-DD */
export function shanghaiDateKey(ms: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ms));
}

export function addDays(dateKey: string, days: number): string {
  const parts = dateKey.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const utc = Date.UTC(y, m - 1, d + days, 4);
  return shanghaiDateKey(utc);
}

export function startOfWeekMonday(dateKey: string): string {
  const parts = dateKey.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const date = new Date(Date.UTC(y, m - 1, d, 4));
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short'
  }).format(date);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6
  };
  const offset = map[weekday] ?? 0;
  return addDays(dateKey, -offset);
}
