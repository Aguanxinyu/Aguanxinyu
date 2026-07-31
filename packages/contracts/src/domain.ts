export type TaskStatus = 'TODO' | 'DONE' | 'TRASHED';
export type ActiveTaskStatus = Exclude<TaskStatus, 'TRASHED'>;
export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type SeriesStatus = 'ACTIVE' | 'ENDED';
export type ReminderState =
  'SCHEDULED' | 'SENDING' | 'ACCEPTED' | 'DELIVERED' | 'FAILED' | 'SKIPPED' | 'UNKNOWN';

export type Location =
  | {
      readonly name: string;
      readonly address?: string | undefined;
      readonly latitude: number;
      readonly longitude: number;
      readonly source: 'MAP';
    }
  | {
      readonly name: string;
      readonly address?: string | undefined;
      readonly source: 'MANUAL';
    };

export interface Task {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly notes?: string;
  readonly dueAt?: number;
  readonly dueHasTime: boolean;
  readonly priority: Priority;
  readonly status: TaskStatus;
  readonly originalStatus?: ActiveTaskStatus | undefined;
  readonly listId: string;
  readonly tagIds: readonly string[];
  readonly location?: Location;
  readonly seriesId?: string;
  readonly occurrenceDate?: string;
  readonly remindAt?: number;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number | undefined;
  readonly trashedAt?: number | undefined;
  readonly purgeAfterAt?: number | undefined;
}

export type RecurrenceRule =
  | {
      readonly frequency: 'DAILY';
      readonly endDate?: string;
    }
  | {
      readonly frequency: 'WEEKLY';
      readonly weekdays: readonly number[];
      readonly endDate?: string;
    }
  | {
      readonly frequency: 'MONTHLY';
      readonly monthDay: number;
      readonly endDate?: string;
    };

export interface Series {
  readonly id: string;
  readonly userId: string;
  readonly status: SeriesStatus;
  readonly startDate: string;
  readonly rule: RecurrenceRule;
  readonly materializedThrough?: string;
}

export interface Reminder {
  readonly id: string;
  readonly userId: string;
  readonly taskId: string;
  readonly taskVersion: number;
  readonly fireAt: number;
  readonly state: ReminderState;
}
