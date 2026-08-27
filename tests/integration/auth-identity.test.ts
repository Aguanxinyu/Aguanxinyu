import { describe, expect, it } from 'vitest';

import { resolveIdentityMerge } from '../../packages/domain/src/auth-identity.js';

describe('resolveIdentityMerge', () => {
  it('creates a new user when nothing matches', () => {
    expect(
      resolveIdentityMerge({ channel: 'miniprogram', mpOpenId: 'mp-1', unionId: 'u-1' }, {})
    ).toEqual({
      type: 'create',
      mpOpenId: 'mp-1',
      unionId: 'u-1'
    });
  });

  it('uses the channel openid user and patches unionid', () => {
    expect(
      resolveIdentityMerge(
        { channel: 'web', webOpenId: 'web-1', unionId: 'u-1' },
        {
          byWebOpenId: { id: 'user-a', webOpenId: 'web-1' }
        }
      )
    ).toEqual({
      type: 'use',
      userId: 'user-a',
      patch: { unionId: 'u-1' }
    });
  });

  it('binds channel openid onto an existing unionid user', () => {
    expect(
      resolveIdentityMerge(
        { channel: 'web', webOpenId: 'web-1', unionId: 'u-1' },
        {
          byUnionId: { id: 'user-a', mpOpenId: 'mp-1', unionId: 'u-1' }
        }
      )
    ).toEqual({
      type: 'use',
      userId: 'user-a',
      patch: { webOpenId: 'web-1' }
    });
  });

  it('conflicts when unionid and channel openid point at different users', () => {
    expect(
      resolveIdentityMerge(
        { channel: 'miniprogram', mpOpenId: 'mp-1', unionId: 'u-1' },
        {
          byUnionId: { id: 'user-a', unionId: 'u-1' },
          byMpOpenId: { id: 'user-b', mpOpenId: 'mp-1' }
        }
      )
    ).toEqual({ type: 'conflict' });
  });
});
