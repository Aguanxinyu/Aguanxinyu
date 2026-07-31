import { describe, expect, it } from 'vitest';

import { isTrashExpired, purgeAtFor } from '../src/trash.js';
import { createTask } from './fixtures.js';

describe('trash retention', () => {
  const trashedAt = Date.UTC(2026, 6, 31, 4);
  const retention = 30 * 24 * 60 * 60 * 1000;

  it('calculates a thirty day purge timestamp', () => {
    expect(purgeAtFor(trashedAt)).toBe(trashedAt + retention);
  });

  it('expires at the purge timestamp', () => {
    const task = createTask({
      status: 'TRASHED',
      trashedAt,
      purgeAfterAt: trashedAt + retention
    });

    expect(isTrashExpired(task, trashedAt + retention - 1)).toBe(false);
    expect(isTrashExpired(task, trashedAt + retention)).toBe(true);
  });

  it('rejects checking an active task', () => {
    expect(() => isTrashExpired(createTask(), trashedAt)).toThrow('TASK_NOT_TRASHED');
  });

  it('rejects a trashed task without a purge timestamp', () => {
    expect(() => isTrashExpired(createTask({ status: 'TRASHED' }), trashedAt)).toThrow(
      'TASK_MISSING_PURGE_TIME'
    );
  });
});
