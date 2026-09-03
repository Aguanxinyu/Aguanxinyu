import type { DailyReviewContent, DailyStats } from '@today-todo/domain';

export interface DailyReviewRecord extends DailyReviewContent {
  readonly id: string;
  readonly userId: string;
  readonly date: string;
  readonly status: 'ready';
  readonly source: 'model' | 'rules';
  readonly stats: DailyStats;
  readonly factsHash: string;
  readonly model?: string;
  readonly generationCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DailyReviewView {
  readonly date: string;
  readonly isCompleteDay: boolean;
  readonly needsRefresh: boolean;
  readonly stats: DailyStats;
  readonly review: DailyReviewRecord | null;
}
