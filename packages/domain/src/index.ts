export {
  resolveIdentityMerge,
  type AuthChannel,
  type IdentityLookup,
  type IdentityMergeDecision,
  type UserIdentitySnapshot,
  type WeChatIdentity
} from './auth-identity.js';
export { DomainError, type DomainErrorCode } from './errors.js';
export {
  buildDailyFacts,
  buildRulesDailyReview,
  type BuildDailyFactsOptions,
  type DailyReviewContent,
  type DailyReviewFacts,
  type DailyReviewItem,
  type DailyStats,
  type DailyTaskFact
} from './daily-review.js';
export {
  compareSortTuples,
  getTaskGroup,
  shanghaiDateKey,
  sortTasks,
  taskBelongsToDate,
  taskDateSpan,
  taskOverlapsDateRange,
  taskSortTuple,
  type TaskGroup,
  type TaskSortTuple
} from './grouping.js';
export { expandOccurrences, occurrenceKey } from './recurrence.js';
export {
  cancelReminder,
  createReminderForTask,
  reactivateReminder,
  reminderTimeFor
} from './reminder.js';
export { completeTask, restoreTask, trashTask, uncompleteTask } from './task-state.js';
export { isTrashExpired, purgeAtFor } from './trash.js';
export {
  validateListName,
  validateTagName,
  validateTaskInput,
  type ValidationIssue,
  type ValidationResult
} from './validation.js';
export {
  aiAllowed,
  buildRulesReview,
  buildWeeklyFacts,
  defaultWeekStart,
  isValidWeekStart,
  previousWeekStart,
  sanitizeImprovements,
  taskBelongsToWeek,
  weekEndDateKey,
  weekEndExclusiveMs,
  weekStartForInstant,
  weekStartMs,
  type ImprovementSeverity,
  type ImprovementType,
  type ListStat,
  type WeeklyHighlight,
  type WeeklyImprovement,
  type WeeklyReviewFacts,
  type WeeklyStats,
  type WeeklyTaskFact
} from './weekly-review.js';
