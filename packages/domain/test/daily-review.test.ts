import { describe, expect, it } from 'vitest';

import { buildDailyFacts, buildRulesDailyReview } from '../src/daily-review.js';
import { createTask } from './fixtures.js';

describe('daily review domain', () => {
  it('collects dated, recurring, spanning, and newly-created undated tasks', () => {
    const date = '2026-09-03';
    const now = Date.parse('2026-09-03T20:00:00+08:00');
    const facts = buildDailyFacts({
      date,
      now,
      listNames: { inbox: '收件箱' },
      tasks: [
        createTask({ id: 'due', dueAt: Date.parse('2026-09-03T18:00:00+08:00') }),
        createTask({ id: 'repeat', occurrenceDate: date, seriesId: 'series-1' }),
        createTask({
          id: 'span',
          startAt: Date.parse('2026-09-02T09:00:00+08:00'),
          dueAt: Date.parse('2026-09-04T18:00:00+08:00')
        }),
        createTask({ id: 'undated', createdAt: now }),
        createTask({ id: 'other', dueAt: Date.parse('2026-09-04T18:00:00+08:00') })
      ]
    });

    expect(facts.tasks.map(({ id }) => id)).toEqual(['due', 'repeat', 'span', 'undated']);
  });

  it('builds deterministic stats and a rules fallback', () => {
    const now = Date.parse('2026-09-03T20:00:00+08:00');
    const facts = buildDailyFacts({
      date: '2026-09-03',
      now,
      listNames: { inbox: '收件箱' },
      tasks: [
        createTask({
          id: 'done',
          title: '完成项',
          status: 'DONE',
          completedAt: now - 60_000,
          dueAt: now - 120_000
        }),
        createTask({
          id: 'open',
          title: '高优未完成',
          priority: 'HIGH',
          dueAt: now - 60_000,
          dueHasTime: true
        })
      ]
    });
    const review = buildRulesDailyReview(facts);

    expect(facts.stats).toMatchObject({
      total: 2,
      completed: 1,
      open: 1,
      overdueOpen: 1,
      highPriorityOpen: 1,
      completionRate: 0.5
    });
    expect(review.summary).toContain('完成率 50%');
    expect(review.highlights[0]?.taskIds).toEqual(['done']);
    expect(review.blockers[0]?.taskIds).toEqual(['open']);
  });
});
