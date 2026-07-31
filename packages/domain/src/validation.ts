import type { Priority } from '@today-todo/contracts';

export interface ValidationIssue {
  readonly field: string;
  readonly code: string;
}

export type ValidationResult =
  | {
      readonly valid: true;
      readonly issues: readonly [];
    }
  | {
      readonly valid: false;
      readonly issues: readonly ValidationIssue[];
    };

type UnknownRecord = Readonly<Record<string, unknown>>;

const PRIORITIES: readonly Priority[] = ['HIGH', 'MEDIUM', 'LOW'];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function isPriority(value: unknown): value is Priority {
  return (PRIORITIES as readonly unknown[]).includes(value);
}

function resultFor(issues: readonly ValidationIssue[]): ValidationResult {
  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}

function withIssue(
  issues: readonly ValidationIssue[],
  field: string,
  code: string
): readonly ValidationIssue[] {
  return [...issues, { field, code }];
}

export function validateTaskInput(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return resultFor([{ field: 'input', code: 'INPUT_INVALID' }]);
  }

  let issues: readonly ValidationIssue[] = [];
  const title = input.title;
  if (typeof title !== 'string' || title.trim().length === 0) {
    issues = withIssue(issues, 'title', 'TITLE_REQUIRED');
  } else if (characterLength(title) > 100) {
    issues = withIssue(issues, 'title', 'TITLE_TOO_LONG');
  }

  const notes = input.notes;
  if (notes !== undefined && typeof notes !== 'string') {
    issues = withIssue(issues, 'notes', 'NOTES_INVALID');
  } else if (typeof notes === 'string' && characterLength(notes) > 1000) {
    issues = withIssue(issues, 'notes', 'NOTES_TOO_LONG');
  }

  if (!isPriority(input.priority)) {
    issues = withIssue(issues, 'priority', 'PRIORITY_INVALID');
  }

  const tagIds = input.tagIds;
  if (!Array.isArray(tagIds)) {
    issues = withIssue(issues, 'tagIds', 'TAG_IDS_INVALID');
  } else if (tagIds.length > 5) {
    issues = withIssue(issues, 'tagIds', 'TOO_MANY_TAGS');
  }

  if (input.dueHasTime === true && typeof input.dueAt !== 'number') {
    issues = withIssue(issues, 'dueAt', 'DUE_AT_REQUIRED');
  }

  if (isRecord(input.location) && input.location.source === 'MAP') {
    const latitude = input.location.latitude;
    const longitude = input.location.longitude;
    if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
      issues = withIssue(issues, 'location.latitude', 'LATITUDE_INVALID');
    }
    if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
      issues = withIssue(issues, 'location.longitude', 'LONGITUDE_INVALID');
    }
  }

  return resultFor(issues);
}

function validateName(
  name: unknown,
  maxLength: number,
  requiredCode: string,
  tooLongCode: string
): ValidationResult {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return resultFor([{ field: 'name', code: requiredCode }]);
  }
  if (characterLength(name) > maxLength) {
    return resultFor([{ field: 'name', code: tooLongCode }]);
  }
  return resultFor([]);
}

export function validateListName(name: unknown): ValidationResult {
  return validateName(name, 20, 'LIST_NAME_REQUIRED', 'LIST_NAME_TOO_LONG');
}

export function validateTagName(name: unknown): ValidationResult {
  return validateName(name, 10, 'TAG_NAME_REQUIRED', 'TAG_NAME_TOO_LONG');
}
