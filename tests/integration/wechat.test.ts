import { describe, expect, it } from 'vitest';

import type { Task } from '@today-todo/contracts';

import { buildTemplateData } from '../../packages/backend/src/index.js';

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    userId: 'user-1',
    title: '提交周报',
    dueHasTime: true,
    priority: 'MEDIUM',
    status: 'TODO',
    listId: 'inbox',
    tagIds: [],
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  };
}

describe('buildTemplateData', () => {
  it('truncates the title to 20 characters for thing fields', () => {
    const longTitle = '这是一个非常非常非常非常非常长的待办事项标题，绝对超过二十个字';
    const data = buildTemplateData({ thing1: 'title' }, makeTask({ title: longTitle }));
    expect(data.thing1?.value).toBe(longTitle.slice(0, 20));
  });

  it('formats dueAt as YYYY-MM-DD HH:mm in local time', () => {
    const dueAt = new Date(2026, 6, 31, 9, 5).getTime();
    const data = buildTemplateData({ time2: 'dueAt' }, makeTask({ dueAt }));
    expect(data.time2?.value).toBe('2026-07-31 09:05');
  });

  it('renders an empty value when dueAt is absent', () => {
    const data = buildTemplateData({ time2: 'dueAt' }, makeTask({}));
    expect(data.time2?.value).toBe('');
  });

  it('maps every configured field', () => {
    const dueAt = new Date(2026, 7, 1, 18, 30).getTime();
    const data = buildTemplateData(
      { thing1: 'title', time2: 'dueAt' },
      makeTask({ title: '开会', dueAt })
    );
    expect(data).toEqual({
      thing1: { value: '开会' },
      time2: { value: '2026-08-01 18:30' }
    });
  });
});
