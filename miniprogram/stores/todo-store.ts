export type ClientTaskStatus = 'TODO' | 'DONE' | 'TRASHED';
export type ClientPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type MutationAction = 'COMPLETE' | 'RESTORE' | 'TRASH' | 'UNCOMPLETE';

export interface ClientTask {
  readonly id: string;
  readonly title: string;
  readonly notes?: string;
  readonly priority: ClientPriority;
  readonly status: ClientTaskStatus;
  readonly dueAt?: number;
  readonly dueHasTime: boolean;
  readonly listId: string;
  readonly tagIds: readonly string[];
  readonly location?:
    | {
        readonly name: string;
        readonly address?: string;
        readonly latitude: number;
        readonly longitude: number;
        readonly source: 'MAP';
      }
    | {
        readonly name: string;
        readonly address?: string;
        readonly source: 'MANUAL';
      };
  readonly seriesId?: string;
  readonly occurrenceDate?: string;
  readonly remindAt?: number;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PendingMutation {
  readonly id: string;
  readonly taskId: string;
  readonly action: MutationAction;
  readonly createdAt: number;
}

export interface TodoState {
  readonly tasks: readonly ClientTask[];
  readonly pendingMutations: readonly PendingMutation[];
  readonly syncedAt: number | null;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export function createTodoState(): TodoState {
  return {
    tasks: [],
    pendingMutations: [],
    syncedAt: null,
    nextCursor: null,
    hasMore: false
  };
}

export function replaceTasks(
  state: TodoState,
  tasks: readonly ClientTask[],
  syncedAt: number,
  nextCursor: string | null,
  hasMore: boolean
): TodoState {
  return {
    ...state,
    tasks: [...tasks],
    syncedAt,
    nextCursor,
    hasMore
  };
}

export function appendTasks(
  state: TodoState,
  tasks: readonly ClientTask[],
  nextCursor: string | null,
  hasMore: boolean
): TodoState {
  return {
    ...state,
    tasks: [...state.tasks, ...tasks],
    nextCursor,
    hasMore
  };
}

export function setTaskStatus(
  state: TodoState,
  taskId: string,
  status: ClientTaskStatus,
  updatedAt: number
): TodoState {
  const task = state.tasks.find(({ id }) => id === taskId);
  if (task === undefined) {
    return state;
  }

  return {
    ...state,
    tasks: state.tasks.map((candidate) =>
      candidate.id === taskId
        ? {
            ...candidate,
            status,
            updatedAt,
            version: candidate.version + 1
          }
        : candidate
    )
  };
}

export function enqueueMutation(state: TodoState, mutation: PendingMutation): TodoState {
  return {
    ...state,
    pendingMutations: [...state.pendingMutations, mutation]
  };
}

export function acknowledgeMutation(state: TodoState, mutationId: string): TodoState {
  if (!state.pendingMutations.some(({ id }) => id === mutationId)) {
    return state;
  }
  return {
    ...state,
    pendingMutations: state.pendingMutations.filter(({ id }) => id !== mutationId)
  };
}
