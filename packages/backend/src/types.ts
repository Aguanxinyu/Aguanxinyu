import type { ApiResponse, RecurrenceRule, Reminder, Task } from '@today-todo/contracts';

export const INBOX_LIST_ID = 'inbox';

export type HttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST';

export interface HttpRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly token?: string;
  readonly requestId?: string;
  readonly body?: unknown;
}

export interface HttpResult<T> {
  readonly status: number;
  readonly body: ApiResponse<T>;
}

export interface AuthData {
  readonly token: string;
  readonly userId: string;
}

export interface TodoList {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly isInbox: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TodoTag {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly color: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface UserRecord {
  readonly id: string;
  readonly openId: string;
  readonly status: 'ACTIVE' | 'DELETION_PENDING' | 'DELETED';
  readonly deletionRequestedAt?: number;
  readonly purgeAfterAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SessionRecord {
  readonly tokenHash: string;
  readonly userId: string;
  readonly expiresAt: number;
  readonly createdAt: number;
}

export interface TaskTemplate {
  readonly title: string;
  readonly notes?: string;
  readonly priority: Task['priority'];
  readonly listId: string;
  readonly tagIds: readonly string[];
  readonly location?: Task['location'];
  readonly dueHasTime: boolean;
}

export interface SeriesRecord {
  readonly id: string;
  readonly userId: string;
  readonly status: 'ACTIVE' | 'ENDED';
  readonly startDate: string;
  readonly rule: RecurrenceRule;
  readonly template: TaskTemplate;
  readonly materializedThrough?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ReminderRecord extends Reminder {
  readonly title: string;
}

export interface ReminderGrant {
  readonly userId: string;
  readonly available: number;
}

export interface AccountDeletionData {
  readonly purgeAfterAt: number;
}

export interface SentMessage {
  readonly userId: string;
  readonly taskId: string;
  readonly title: string;
}

export type ApiData =
  | AccountDeletionData
  | AuthData
  | ReminderGrant
  | Task
  | TodoList
  | TodoTag
  | readonly Task[]
  | readonly TodoList[]
  | readonly TodoTag[]
  | null;
