import {
  ApiClientError,
  apiClient,
  type CreateTaskInput,
  type UpdateTaskInput
} from '../services/api.js';
import { taskBelongsToCalendarDay, taskDateSpan } from '../utils/calendar.js';
import {
  acknowledgeMutation,
  appendTasks,
  createTodoState,
  enqueueMutation,
  replaceTasks,
  setTaskStatus,
  type ClientTask,
  type PendingMutation,
  type TodoState
} from './todo-store.js';

const CACHE_KEY = 'today-todo:state';

type Listener = (state: TodoState) => void;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClientTask(value: unknown): value is ClientTask {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    (value.status === 'TODO' || value.status === 'DONE' || value.status === 'TRASHED') &&
    (value.priority === 'HIGH' || value.priority === 'MEDIUM' || value.priority === 'LOW') &&
    typeof value.version === 'number'
  );
}

function isPendingMutation(value: unknown): value is PendingMutation {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.taskId === 'string' &&
    typeof value.createdAt === 'number' &&
    (value.action === 'COMPLETE' ||
      value.action === 'UNCOMPLETE' ||
      value.action === 'TRASH' ||
      value.action === 'RESTORE')
  );
}

function isTodoState(value: unknown): value is TodoState {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Array.isArray(value.tasks) &&
    value.tasks.every(isClientTask) &&
    Array.isArray(value.pendingMutations) &&
    value.pendingMutations.every(isPendingMutation) &&
    (value.nextCursor === undefined ||
      value.nextCursor === null ||
      typeof value.nextCursor === 'string') &&
    (value.hasMore === undefined || typeof value.hasMore === 'boolean')
  );
}

function replaceTask(state: TodoState, task: ClientTask): TodoState {
  return {
    ...state,
    tasks: state.tasks.map((candidate) => (candidate.id === task.id ? task : candidate))
  };
}

function taskOverlapsRange(
  task: ClientTask,
  fromKey: string,
  toKey: string,
  now = Date.now()
): boolean {
  const span = taskDateSpan(task, now);
  if (span === null) {
    return false;
  }
  return span.from <= toKey && span.to >= fromKey;
}

export class TodoController {
  private state: TodoState = createTodoState();
  private listeners: readonly Listener[] = [];

  public getState(): TodoState {
    return this.state;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners = [...this.listeners, listener];
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter((candidate) => candidate !== listener);
    };
  }

  public hydrate(): void {
    const cached = wx.getStorageSync<unknown>(CACHE_KEY);
    if (isTodoState(cached)) {
      this.publish({
        tasks: [...cached.tasks],
        pendingMutations: [...cached.pendingMutations],
        syncedAt: typeof cached.syncedAt === 'number' ? cached.syncedAt : null,
        nextCursor: typeof cached.nextCursor === 'string' ? cached.nextCursor : null,
        hasMore: (cached.hasMore as boolean | undefined) === true
      });
    }
  }

  public async refresh(): Promise<void> {
    try {
      if (apiClient.getStoredToken() === null) {
        await apiClient.login();
      }
      await this.flushPendingMutations();
      const page = await apiClient.listTasks();
      this.publish(replaceTasks(this.state, page.tasks, Date.now(), page.cursor, page.hasMore));
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'AUTH_REQUIRED') {
        this.publish({
          ...createTodoState(),
          pendingMutations: this.state.pendingMutations
        });
      }
      throw error;
    }
  }

  /** Fetch one Shanghai calendar day and merge into the local cache. */
  public async refreshDay(dueOn: string): Promise<void> {
    if (apiClient.getStoredToken() === null) {
      await apiClient.login();
    }
    const page = await apiClient.listTasks({ dueOn });
    const now = Date.now();
    const kept = this.state.tasks.filter((task) => !taskBelongsToCalendarDay(task, dueOn, now));
    const byId = new Map(kept.map((task) => [task.id, task] as const));
    for (const task of page.tasks) {
      byId.set(task.id, task);
    }
    this.publish({
      ...this.state,
      tasks: [...byId.values()],
      syncedAt: now
    });
  }

  public async create(input: CreateTaskInput): Promise<ClientTask> {
    const task = await apiClient.createTask(input);
    this.publish({
      ...this.state,
      tasks: [task, ...this.state.tasks]
    });
    return task;
  }

  /** Fetch tasks overlapping a Shanghai date range and merge into the local cache. */
  public async refreshRange(dueFrom: string, dueTo: string): Promise<readonly ClientTask[]> {
    if (apiClient.getStoredToken() === null) {
      await apiClient.login();
    }
    const page = await apiClient.listTasks({ dueFrom, dueTo });
    const now = Date.now();
    const kept = this.state.tasks.filter((task) => !taskOverlapsRange(task, dueFrom, dueTo, now));
    const byId = new Map(kept.map((task) => [task.id, task] as const));
    for (const task of page.tasks) {
      byId.set(task.id, task);
    }
    const tasks = [...byId.values()];
    this.publish({
      ...this.state,
      tasks,
      syncedAt: now
    });
    return page.tasks;
  }

  public async loadMore(): Promise<void> {
    if (!this.state.hasMore || this.state.nextCursor === null) {
      return;
    }
    const page = await apiClient.listTasks({ cursor: this.state.nextCursor });
    this.publish(appendTasks(this.state, page.tasks, page.cursor, page.hasMore));
  }

  public async update(
    taskId: string,
    input: UpdateTaskInput,
    version: number
  ): Promise<ClientTask> {
    const updated = await apiClient.updateTask(taskId, input, version);
    this.publish(replaceTask(this.state, updated));
    return updated;
  }

  public async toggleTask(taskId: string): Promise<void> {
    const task = this.state.tasks.find(({ id }) => id === taskId);
    if (task === undefined) {
      return;
    }
    const previous = this.state;
    const targetStatus = task.status === 'DONE' ? 'TODO' : 'DONE';
    this.publish(setTaskStatus(this.state, taskId, targetStatus, Date.now()));

    try {
      const updated =
        targetStatus === 'DONE'
          ? await apiClient.completeTask(taskId)
          : await apiClient.uncompleteTask(taskId);
      this.publish(replaceTask(this.state, updated));
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'NETWORK_ERROR') {
        this.queueOffline(taskId, targetStatus === 'DONE' ? 'COMPLETE' : 'UNCOMPLETE');
        return;
      }
      this.publish(previous);
      throw error;
    }
  }

  public async trashTask(taskId: string): Promise<void> {
    const previous = this.state;
    this.publish({
      ...this.state,
      tasks: this.state.tasks.filter(({ id }) => id !== taskId)
    });
    try {
      await apiClient.trashTask(taskId);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'NETWORK_ERROR') {
        this.queueOffline(taskId, 'TRASH');
        return;
      }
      this.publish(previous);
      throw error;
    }
  }

  private queueOffline(taskId: string, action: PendingMutation['action']): void {
    const createdAt = Date.now();
    this.publish(
      enqueueMutation(this.state, {
        id: `${String(createdAt)}-${Math.random().toString(36).slice(2)}`,
        taskId,
        action,
        createdAt
      })
    );
  }

  private async flushPendingMutations(): Promise<void> {
    for (const mutation of [...this.state.pendingMutations]) {
      try {
        switch (mutation.action) {
          case 'COMPLETE':
            await apiClient.completeTask(mutation.taskId);
            break;
          case 'UNCOMPLETE':
            await apiClient.uncompleteTask(mutation.taskId);
            break;
          case 'TRASH':
            await apiClient.trashTask(mutation.taskId);
            break;
          case 'RESTORE':
            await apiClient.restoreTask(mutation.taskId);
            break;
        }
        this.publish(acknowledgeMutation(this.state, mutation.id));
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          (error.code === 'NETWORK_ERROR' ||
            error.code === 'INTERNAL_ERROR' ||
            error.code === 'AUTH_REQUIRED')
        ) {
          return;
        }
        this.publish(acknowledgeMutation(this.state, mutation.id));
        void wx.showToast({
          title: '一项离线操作未能同步',
          icon: 'none'
        });
      }
    }
  }

  private publish(next: TodoState): void {
    this.state = next;
    wx.setStorageSync(CACHE_KEY, next);
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}

export const todoController = new TodoController();
