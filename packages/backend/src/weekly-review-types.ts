import type {
  ImprovementSeverity,
  ImprovementType,
  ListStat,
  WeeklyHighlight,
  WeeklyImprovement,
  WeeklyStats
} from '@today-todo/domain';

export interface WeeklyReviewRecord {
  readonly id: string;
  readonly userId: string;
  readonly weekStart: string;
  readonly status: 'ready' | 'failed';
  readonly source: 'model' | 'rules';
  readonly stats: WeeklyStats;
  readonly summary: string;
  readonly improvements: readonly WeeklyImprovement[];
  readonly highlights: readonly WeeklyHighlight[];
  readonly model?: string;
  readonly errorCode?: string;
  readonly generationCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WeeklyReviewView {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly label: 'current' | 'previous';
  readonly aiAllowed: boolean;
  readonly isCompleteWeek: boolean;
  readonly stats: WeeklyStats;
  readonly review: WeeklyReviewRecord | null;
}

export type {
  ImprovementSeverity,
  ImprovementType,
  ListStat,
  WeeklyHighlight,
  WeeklyImprovement,
  WeeklyStats
};
