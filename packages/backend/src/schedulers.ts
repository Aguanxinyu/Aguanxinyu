import { expandOccurrences, isTrashExpired } from '@today-todo/domain';

import type { ApiService } from './api-service.js';
import type { BackendDatabase } from './database.js';
import type { SentMessage } from './types.js';

const STALE_REMINDER_CLAIM_MS = 5 * 60 * 1000;

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

  public async materializeAndClean(throughDate: string): Promise<void> {
    const now = this.now();
    for (const series of await this.database.seriesForUser()) {
      try {
        if (
          series.status !== 'ACTIVE' ||
          series.startDate > throughDate ||
          (series.materializedThrough !== undefined &&
            series.materializedThrough >= throughDate)
        ) {
          continue;
        }
        const dates = expandOccurrences(
          series,
          series.materializedThrough ?? series.startDate,
          throughDate
        );
        for (const date of dates) {
          const task = this.api.taskFromSeries(series, date, now);
          if ((await this.database.findTask(series.userId, task.id)) === undefined) {
            await this.database.saveTask(task);
          }
        }
        await this.database.saveSeries({
          ...series,
          materializedThrough: throughDate,
          updatedAt: now
        });
      } catch (error) {
        this.reportError(error, `materialize-series:${series.id}`);
      }
    }

    await this.database.purgeExpiredSessions(now);
    await this.database.purgeExpiredIdempotencyResults(now);
    await this.database.markStaleReminderClaimsUnknown(now - STALE_REMINDER_CLAIM_MS);
    for (const user of await this.database.usersPendingPurge(now)) {
      await this.database.purgeUser(user.id);
    }
    for (const task of await this.database.allTasks()) {
      if (task.status === 'TRASHED' && isTrashExpired(task, now)) {
        await this.database.deleteTask(task.userId, task.id);
      }
    }
  }

  public async dispatchReminders(at: number): Promise<void> {
    for (const reminder of await this.database.claimRemindersDueAtOrBefore(at)) {
      const task = await this.database.findTask(reminder.userId, reminder.taskId);
      if (
        task === undefined ||
        task.status !== 'TODO' ||
        task.version !== reminder.taskVersion ||
        (await this.database.reminderGrantFor(reminder.userId)) < 1
      ) {
        await this.database.saveReminder({
          ...reminder,
          state: 'SKIPPED'
        });
        continue;
      }

      try {
        await this.sendMessage({
          userId: reminder.userId,
          taskId: reminder.taskId,
          title: reminder.title
        });
        await this.database.consumeReminderGrant(reminder.userId);
        await this.database.saveReminder({
          ...reminder,
          state: 'DELIVERED'
        });
      } catch (error) {
        await this.database.saveReminder({
          ...reminder,
          state: 'FAILED'
        });
        this.reportError(error, `send-reminder:${reminder.id}`);
      }
    }
  }
}
