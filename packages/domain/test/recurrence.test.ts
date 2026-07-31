import { describe, expect, it } from 'vitest';

import { expandOccurrences, occurrenceKey } from '../src/recurrence.js';
import { createSeries } from './fixtures.js';

describe('recurrence expansion', () => {
  it('expands daily occurrences across month and year boundaries', () => {
    const series = createSeries({ startDate: '2026-12-30' });

    expect(expandOccurrences(series, '2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02'
    ]);
  });

  it('expands selected weekdays without duplicates', () => {
    const series = createSeries({
      startDate: '2026-07-27',
      rule: {
        frequency: 'WEEKLY',
        weekdays: [1, 3, 5]
      }
    });

    expect(expandOccurrences(series, '2026-07-27', '2026-08-09')).toEqual([
      '2026-07-27',
      '2026-07-29',
      '2026-07-31',
      '2026-08-03',
      '2026-08-05',
      '2026-08-07'
    ]);
  });

  it('uses the last day for monthly day 31', () => {
    const series = createSeries({
      startDate: '2026-01-31',
      rule: {
        frequency: 'MONTHLY',
        monthDay: 31
      }
    });

    expect(expandOccurrences(series, '2026-01-01', '2026-05-01')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30'
    ]);
  });

  it('uses February 29 in a leap year', () => {
    const series = createSeries({
      startDate: '2028-01-29',
      rule: {
        frequency: 'MONTHLY',
        monthDay: 29
      }
    });

    expect(expandOccurrences(series, '2028-02-01', '2028-03-01')).toEqual(['2028-02-29']);
  });

  it('uses February 28 for day 29 in a non-leap year', () => {
    const series = createSeries({
      startDate: '2027-01-29',
      rule: {
        frequency: 'MONTHLY',
        monthDay: 29
      }
    });

    expect(expandOccurrences(series, '2027-02-01', '2027-03-01')).toEqual(['2027-02-28']);
  });

  it('does not generate after the configured end date', () => {
    const series = createSeries({
      startDate: '2026-07-30',
      rule: {
        frequency: 'DAILY',
        endDate: '2026-08-01'
      }
    });

    expect(expandOccurrences(series, '2026-07-30', '2026-08-05')).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01'
    ]);
  });

  it('does not generate for an ended series', () => {
    expect(
      expandOccurrences(createSeries({ status: 'ENDED' }), '2026-01-01', '2026-01-10')
    ).toEqual([]);
  });

  it('rejects invalid rules and date ranges', () => {
    expect(() =>
      expandOccurrences(
        createSeries({ rule: { frequency: 'WEEKLY', weekdays: [] } }),
        '2026-01-01',
        '2026-01-10'
      )
    ).toThrow('RECURRENCE_INVALID_WEEKDAYS');
    expect(() =>
      expandOccurrences(
        createSeries({ rule: { frequency: 'MONTHLY', monthDay: 32 } }),
        '2026-01-01',
        '2026-01-10'
      )
    ).toThrow('RECURRENCE_INVALID_MONTH_DAY');
    expect(() =>
      expandOccurrences(createSeries(), '2026-02-01', '2026-01-01')
    ).toThrow('RECURRENCE_INVALID_RANGE');
  });

  it('creates stable occurrence keys', () => {
    expect(occurrenceKey('series-1', '2026-07-31')).toBe('series-1:2026-07-31');
    expect(occurrenceKey('series-1', '2026-07-31')).toBe(
      occurrenceKey('series-1', '2026-07-31')
    );
  });
});
