import { ApiClientError, apiClient, type CreateTaskInput } from '../services/api.js';
import {
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

function isTodoState(value: unknown): value is TodoState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  return Array.isArray(candidate.tasks) && Array.isArray(candidate.pendingMutations);
}

function replaceTask(state: TodoState, task: ClientTask): TodoState {
  return {
    ...state,
    tasks: state.tasks.map((candidate) => (candidate.id === task.id ? task : candidate))
  };
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
        syncedAt: typeof cached.syncedAt === 'number' ? cached.syncedAt : null
      });
    }
  }

  public async refresh(): Promise<void> {
    if (apiClient.getStoredToken() === null) {
      await apiClient.login();
    }
    const tasks = await apiClient.listTasks();
    this.publish(replaceTasks(this.state, tasks, Date.now()));
  }

  public async create(input: CreateTaskInput): Promise<ClientTask> {
    const task = await apiClient.createTask(input);
    this.publish({
      ...this.state,
      tasks: [task, ...this.state.tasks]
    });
    return task;
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
        id: `${createdAt}-${Math.random().toString(36).slice(2)}`,
        taskId,
        action,
        createdAt
      })
    );
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
