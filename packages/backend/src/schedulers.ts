import { expandOccurrences, isTrashExpired } from '@today-todo/domain';

import type { ApiService } from './api-service.js';
import type { BackendDatabase } from './database.js';
import type { SentMessage } from './types.js';

export interface SchedulerOptions {
  readonly database: BackendDatabase;
  readonly api: ApiService;
  readonly now: () => number;
  readonly sendMessage: (message: SentMessage) => Promise<void>;
  readonly reportError: (error: unknown, operation: string) => void;
}

export class Schedulers {
  private readonly database: BackendDatabase;
  private readonly api: ApiService;
  private readonly now: () => number;
  private readonly sendMessage: (message: SentMessage) => Promise<void>;
  private readonly reportError: (error: unknown, operation: string) => void;

  public constructor(options: SchedulerOptions) {
    this.database = options.database;
    this.api = options.api;
    this.now = options.now;
    this.sendMessage = options.sendMessage;
    this.reportError = options.reportError;
  }

  public materializeAndClean(throughDate: string): void {
    const now = this.now();
    for (const series of this.database.seriesForUser()) {
      try {
        if (series.status !== 'ACTIVE' || series.startDate > throughDate) {
          continue;
        }
        const dates = expandOccurrences(series, series.startDate, throughDate);
        for (const date of dates) {
          const task = this.api.taskFromSeries(series, date, now);
          if (this.database.findTask(series.userId, task.id) === undefined) {
            this.database.saveTask(task);
          }
        }
        this.database.saveSeries({
          ...series,
          materializedThrough: throughDate,
          updatedAt: now
        });
      } catch (error) {
        this.reportError(error, `materialize-series:${series.id}`);
      }
    }

    this.database.purgeExpiredSessions(now);
    this.database.purgeExpiredIdempotencyResults(now);
    for (const user of this.database.usersPendingPurge(now)) {
      this.database.purgeUser(user.id);
    }
    for (const task of this.database.allTasks()) {
      if (task.status === 'TRASHED' && isTrashExpired(task, now)) {
        this.database.deleteTask(task.userId, task.id);
      }
    }
  }

  public async dispatchReminders(at: number): Promise<void> {
    for (const reminder of this.database.remindersDueAtOrBefore(at)) {
      const task = this.database.findTask(reminder.userId, reminder.taskId);
      if (
        task === undefined ||
        task.status !== 'TODO' ||
        task.version !== reminder.taskVersion ||
        this.database.reminderGrantFor(reminder.userId) < 1
      ) {
        this.database.saveReminder({
          ...reminder,
          state: 'SKIPPED'
        });
        continue;
      }

      this.database.saveReminder({
        ...reminder,
        state: 'SENDING'
      });
      try {
        await this.sendMessage({
          userId: reminder.userId,
          taskId: reminder.taskId,
          title: reminder.title
        });
        this.database.consumeReminderGrant(reminder.userId);
        this.database.saveReminder({
          ...reminder,
          state: 'DELIVERED'
        });
      } catch (error) {
        this.database.saveReminder({
          ...reminder,
          state: 'FAILED'
        });
        this.reportError(error, `send-reminder:${reminder.id}`);
      }
    }
  }
}
