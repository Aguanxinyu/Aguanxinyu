import { describe, expect, it } from 'vitest';

import { validateListName, validateTagName, validateTaskInput } from '../src/validation.js';

describe('task validation', () => {
  const validInput = {
    title: '测试待办',
    notes: '',
    priority: 'MEDIUM',
    tagIds: [],
    dueHasTime: false
  };

  it('accepts a valid task at its field limits', () => {
    expect(
      validateTaskInput({
        ...validInput,
        title: '待'.repeat(100),
        notes: '注'.repeat(1000),
        tagIds: ['1', '2', '3', '4', '5']
      })
    ).toEqual({ valid: true, issues: [] });
  });

  it.each([
    [{ ...validInput, title: '' }, 'title', 'TITLE_REQUIRED'],
    [{ ...validInput, title: '待'.repeat(101) }, 'title', 'TITLE_TOO_LONG'],
    [{ ...validInput, notes: '注'.repeat(1001) }, 'notes', 'NOTES_TOO_LONG'],
    [{ ...validInput, tagIds: ['1', '2', '3', '4', '5', '6'] }, 'tagIds', 'TOO_MANY_TAGS'],
    [{ ...validInput, priority: 'URGENT' }, 'priority', 'PRIORITY_INVALID']
  ])('rejects invalid task input %#', (input, field, code) => {
    expect(validateTaskInput(input)).toEqual({
      valid: false,
      issues: [{ field, code }]
    });
  });

  it('requires dueAt when a task has an exact due time', () => {
    expect(validateTaskInput({ ...validInput, dueHasTime: true })).toEqual({
      valid: false,
      issues: [{ field: 'dueAt', code: 'DUE_AT_REQUIRED' }]
    });
  });

  it('validates map coordinates', () => {
    expect(
      validateTaskInput({
        ...validInput,
        location: {
          name: '地点',
          source: 'MAP',
          latitude: 91,
          longitude: 181
        }
      })
    ).toEqual({
      valid: false,
      issues: [
        { field: 'location.latitude', code: 'LATITUDE_INVALID' },
        { field: 'location.longitude', code: 'LONGITUDE_INVALID' }
      ]
    });
  });

  it('validates list and tag names', () => {
    expect(validateListName('清单')).toEqual({ valid: true, issues: [] });
    expect(validateListName('列'.repeat(21))).toEqual({
      valid: false,
      issues: [{ field: 'name', code: 'LIST_NAME_TOO_LONG' }]
    });
    expect(validateTagName('标签')).toEqual({ valid: true, issues: [] });
    expect(validateTagName('标'.repeat(11))).toEqual({
      valid: false,
      issues: [{ field: 'name', code: 'TAG_NAME_TOO_LONG' }]
    });
  });

  it('returns field issues instead of throwing for malformed input', () => {
    expect(() => validateTaskInput(null)).not.toThrow();
    expect(validateTaskInput(null)).toEqual({
      valid: false,
      issues: [{ field: 'input', code: 'INPUT_INVALID' }]
    });
  });
});
