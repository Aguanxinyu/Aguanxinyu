import type { Series } from '@today-todo/contracts';

import { DomainError } from './errors.js';

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function parseDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new DomainError('RECURRENCE_INVALID_DATE');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new DomainError('RECURRENCE_INVALID_DATE');
  }
  return { year, month, day };
}

function formatDate(date: CalendarDate): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${month}-${day}`;
}

function toTimestamp(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function fromTimestamp(timestamp: number): CalendarDate {
  const date = new Date(timestamp);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function addDay(date: CalendarDate): CalendarDate {
  return fromTimestamp(toTimestamp(date) + 24 * 60 * 60 * 1000);
}

function compareDate(left: CalendarDate, right: CalendarDate): number {
  return toTimestamp(left) - toTimestamp(right);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekday(date: CalendarDate): number {
  const utcDay = new Date(toTimestamp(date)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

function validateRule(series: Series): void {
  if (series.rule.frequency === 'WEEKLY') {
    const weekdays = series.rule.weekdays;
    if (
      weekdays.length === 0 ||
      weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    ) {
      throw new DomainError('RECURRENCE_INVALID_WEEKDAYS');
    }
  }
  if (
    series.rule.frequency === 'MONTHLY' &&
    (!Number.isInteger(series.rule.monthDay) ||
      series.rule.monthDay < 1 ||
      series.rule.monthDay > 31)
  ) {
    throw new DomainError('RECURRENCE_INVALID_MONTH_DAY');
  }
}

function occursOn(series: Series, date: CalendarDate): boolean {
  switch (series.rule.frequency) {
    case 'DAILY':
      return true;
    case 'WEEKLY':
      return new Set(series.rule.weekdays).has(weekday(date));
    case 'MONTHLY': {
      const targetDay = Math.min(series.rule.monthDay, lastDayOfMonth(date.year, date.month));
      return date.day === targetDay;
    }
  }
}

export function expandOccurrences(
  series: Series,
  fromValue: string,
  throughValue: string
): string[] {
  const from = parseDate(fromValue);
  const through = parseDate(throughValue);
  if (compareDate(from, through) > 0) {
    throw new DomainError('RECURRENCE_INVALID_RANGE');
  }
  if (series.status === 'ENDED') {
    return [];
  }

  validateRule(series);
  const start = parseDate(series.startDate);
  const end = series.rule.endDate === undefined ? undefined : parseDate(series.rule.endDate);
  const occurrences: string[] = [];

  for (let current = from; compareDate(current, through) <= 0; current = addDay(current)) {
    if (compareDate(current, start) < 0) {
      continue;
    }
    if (end !== undefined && compareDate(current, end) > 0) {
      break;
    }
    if (occursOn(series, current)) {
      occurrences.push(formatDate(current));
    }
  }

  return occurrences;
}

export function occurrenceKey(seriesId: string, date: string): string {
  parseDate(date);
  return `${seriesId}:${date}`;
}
