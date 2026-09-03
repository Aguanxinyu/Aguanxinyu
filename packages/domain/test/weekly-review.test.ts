import { describe, expect, it } from 'vitest';

import {
  aiAllowed,
  buildRulesReview,
  buildWeeklyFacts,
  defaultWeekStart,
  isValidWeekStart,
  previousWeekStart,
  weekStartForInstant
} from '../src/weekly-review.js';
import { createTask } from './fixtures.js';

describe('weekly review domain', () => {
  it('resolves Monday week starts in Asia/Shanghai', () => {
    // Friday 2026-08-21 Shanghai
    expect(weekStartForInstant(Date.parse('2026-08-21T12:00:00+08:00'))).toBe('2026-08-17');
    expect(isValidWeekStart('2026-08-17')).toBe(true);
    expect(isValidWeekStart('2026-08-18')).toBe(false);
    expect(previousWeekStart('2026-08-17')).toBe('2026-08-10');
  });

  it('allows AI only after Sunday 19:00 or when the week has ended', () => {
    const weekStart = '2026-08-17';
    expect(aiAllowed(weekStart, Date.parse('2026-08-23T18:59:59+08:00'))).toBe(false);
    expect(aiAllowed(weekStart, Date.parse('2026-08-23T19:00:00+08:00'))).toBe(true);
    expect(aiAllowed(weekStart, Date.parse('2026-08-24T00:00:00+08:00'))).toBe(true);
    expect(aiAllowed(weekStart, Date.parse('2026-08-21T12:00:00+08:00'))).toBe(false);
  });

  it('defaults to previous week from Saturday until Sunday 19:00', () => {
    expect(defaultWeekStart(Date.parse('2026-08-21T10:00:00+08:00'))).toBe('2026-08-17');
    expect(defaultWeekStart(Date.parse('2026-08-22T10:00:00+08:00'))).toBe('2026-08-10');
    expect(defaultWeekStart(Date.parse('2026-08-23T18:00:00+08:00'))).toBe('2026-08-10');
    expect(defaultWeekStart(Date.parse('2026-08-23T19:30:00+08:00'))).toBe('2026-08-17');
  });

  it('builds stats and rules improvements from week tasks', () => {
    const weekStart = '2026-08-17';
    const now = Date.parse('2026-08-23T20:00:00+08:00');
    const tasks = [
      createTask({
        id: 'a',
        title: '高优未做',
        priority: 'HIGH',
        dueAt: Date.parse('2026-08-18T10:00:00+08:00'),
        dueHasTime: true
      }),
      createTask({
        id: 'b',
        title: '已完成',
        priority: 'MEDIUM',
        status: 'DONE',
        completedAt: Date.parse('2026-08-19T12:00:00+08:00'),
        dueAt: Date.parse('2026-08-19T18:00:00+08:00'),
        dueHasTime: true
      }),
      createTask({
        id: 'c',
        title: '逾期1',
        dueAt: Date.parse('2026-08-17T09:00:00+08:00'),
        dueHasTime: true
      }),
      createTask({
        id: 'd',
        title: '逾期2',
        dueAt: Date.parse('2026-08-17T11:00:00+08:00'),
        dueHasTime: true
      }),
      createTask({
        id: 'e',
        title: '逾期3',
        dueAt: Date.parse('2026-08-18T11:00:00+08:00'),
        dueHasTime: true
      })
    ];
    const facts = buildWeeklyFacts({
      weekStart,
      now,
      tasks,
      listNames: { inbox: '收件箱' }
    });
    expect(facts.stats.total).toBe(5);
    expect(facts.stats.completed).toBe(1);
    const rules = buildRulesReview(facts);
    expect(rules.improvements.some((item) => item.type === 'HIGH_PRIORITY_OPEN')).toBe(true);
    expect(rules.improvements.some((item) => item.type === 'OVERDUE_PILEUP')).toBe(true);
    expect(rules.summary.length).toBeGreaterThan(10);
  });

  it('does not count future tasks in the current week as overdue', () => {
    const facts = buildWeeklyFacts({
      weekStart: '2026-08-17',
      now: Date.parse('2026-08-19T12:00:00+08:00'),
      tasks: [
        createTask({
          id: 'future',
          dueAt: Date.parse('2026-08-21T10:00:00+08:00'),
          dueHasTime: true
        })
      ],
      listNames: { inbox: '收件箱' }
    });

    expect(facts.stats.overdueOpen).toBe(0);
  });

  it('flags day overload, undated pileup, repeat miss and reminder misses', () => {
    const weekStart = '2026-08-17';
    const now = Date.parse('2026-08-23T20:00:00+08:00');
    const overloaded = Array.from({ length: 8 }, (_, index) =>
      createTask({
        id: `load-${String(index)}`,
        title: `过载${String(index)}`,
        dueAt: Date.parse('2026-08-20T10:00:00+08:00'),
        dueHasTime: true
      })
    );
    const undated = Array.from({ length: 5 }, (_, index) =>
      createTask({
        id: `u-${String(index)}`,
        title: `无日期${String(index)}`,
        createdAt: Date.parse('2026-08-18T10:00:00+08:00')
      })
    );
    const repeats = [
      createTask({
        id: 'r1',
        title: '重复1',
        seriesId: 'series-x',
        dueAt: Date.parse('2026-08-18T08:00:00+08:00'),
        dueHasTime: true
      }),
      createTask({
        id: 'r2',
        title: '重复2',
        seriesId: 'series-x',
        dueAt: Date.parse('2026-08-19T08:00:00+08:00'),
        dueHasTime: true
      })
    ];
    const reminded = createTask({
      id: 'rem',
      title: '提醒未完成',
      dueAt: Date.parse('2026-08-21T09:00:00+08:00'),
      dueHasTime: true,
      remindAt: Date.parse('2026-08-21T08:50:00+08:00')
    });
    const facts = buildWeeklyFacts({
      weekStart,
      now,
      tasks: [...overloaded, ...undated, ...repeats, reminded],
      listNames: { inbox: '收件箱' }
    });
    const rules = buildRulesReview(facts);
    expect(rules.improvements.map((item) => item.type)).toEqual(
      expect.arrayContaining([
        'DAY_OVERLOAD',
        'UNDATED_PILEUP',
        'REPEAT_MISS',
        'REMINDER_INEFFECTIVE'
      ])
    );
  });

  it('includes undated tasks created in the week and empty summary', () => {
    const weekStart = '2026-08-17';
    const empty = buildWeeklyFacts({
      weekStart,
      now: Date.parse('2026-08-23T20:00:00+08:00'),
      tasks: [],
      listNames: {}
    });
    expect(buildRulesReview(empty).summary).toContain('几乎没有记录');
  });
});
