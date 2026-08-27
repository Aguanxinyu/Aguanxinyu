import { describe, expect, it } from 'vitest';

import {
  buildMonthGrid,
  buildWeekStrip,
  dateKeyFromTimestamp,
  dayStartMs,
  formatDayTitle,
  formatDueLabel,
  monthKeyFromDateKey,
  shiftDateKey,
  todayKey
} from '../../miniprogram/utils/calendar.js';

describe('calendar helpers', () => {
  it('builds Shanghai date keys from timestamps', () => {
    // 2026-08-21 00:30 Asia/Shanghai
    expect(dateKeyFromTimestamp(Date.parse('2026-08-20T16:30:00.000Z'))).toBe('2026-08-21');
  });

  it('shifts date keys across month boundaries', () => {
    expect(shiftDateKey('2026-08-01', -1)).toBe('2026-07-31');
    expect(shiftDateKey('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('labels today specially', () => {
    const now = Date.parse('2026-08-21T04:00:00+08:00');
    expect(formatDayTitle(todayKey(now), now)).toBe('今天');
    expect(formatDayTitle('2026-08-20', now)).toBe('8月20日');
  });

  it('builds a Sunday-start week strip around the selected day', () => {
    const week = buildWeekStrip('2026-08-21', Date.parse('2026-08-21T12:00:00+08:00'));
    expect(week).toHaveLength(7);
    expect(week[0]?.key).toBe('2026-08-16');
    expect(week[5]?.key).toBe('2026-08-21');
    expect(week[5]?.isToday).toBe(true);
  });

  it('builds a month grid with leading and trailing days', () => {
    const grid = buildMonthGrid(
      monthKeyFromDateKey('2026-08-21'),
      Date.parse('2026-08-21T12:00:00+08:00')
    );
    expect(grid.length % 7).toBe(0);
    expect(grid.some((cell) => cell.key === '2026-08-01' && cell.inMonth)).toBe(true);
    expect(dayStartMs('2026-08-21')).toBe(Date.parse('2026-08-21T00:00:00+08:00'));
  });

  it('formats due labels without Intl', () => {
    expect(formatDueLabel(Date.parse('2026-08-21T01:05:00.000Z'), false)).toBe('8月21日');
    expect(formatDueLabel(Date.parse('2026-08-21T01:05:00.000Z'), true)).toBe('8月21日 09:05');
  });
});
