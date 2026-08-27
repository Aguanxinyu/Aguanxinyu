import { describe, expect, it } from 'vitest';

import type { WeChatIdentity } from '@today-todo/domain';

import {
  createFakeWeChatIdentityResolver,
  createTestSystem,
  type AuthData,
  type HttpResult
} from '../../packages/backend/src/index.js';
import { ApiService } from '../../packages/backend/src/api-service.js';
import { MemoryDatabase } from '../../packages/backend/src/memory-database.js';

function authData(result: HttpResult<unknown>): AuthData {
  if (!result.body.success || result.body.data === null || typeof result.body.data !== 'object') {
    throw new Error('expected auth data');
  }
  const data = result.body.data as AuthData;
  if (typeof data.token !== 'string' || typeof data.userId !== 'string') {
    throw new Error('expected auth data fields');
  }
  return data;
}

describe('multi-channel WeChat login', () => {
  const now = Date.UTC(2026, 7, 27, 4);

  it('keeps miniprogram login compatible when channel is omitted', async () => {
    const system = createTestSystem({ now });
    const first = await system.login('alice');
    const second = await system.request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { code: 'alice' }
    });
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    if (second.body.success) {
      expect(second.body.data.userId).toBe(first.userId);
    }
  });

  it('creates a web user via channel=web', async () => {
    const system = createTestSystem({ now });
    const response = await system.request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { channel: 'web', code: 'bob' }
    });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    if (!response.body.success) {
      return;
    }
    const user = await system.database.findUserById(response.body.data.userId);
    expect(user?.webOpenId).toBe('webopenid:bob');
    expect(user?.unionId).toBe('union:bob');
    expect(user?.mpOpenId).toBeUndefined();
  });

  it('links web login onto an existing miniprogram user with the same unionid', async () => {
    const database = new MemoryDatabase();
    const resolve = (input: {
      readonly channel: 'miniprogram' | 'web';
      readonly code: string;
    }): Promise<WeChatIdentity> => {
      if (input.channel === 'miniprogram') {
        return Promise.resolve({
          channel: 'miniprogram',
          mpOpenId: `openid:${input.code}`,
          unionId: 'union-shared'
        });
      }
      return Promise.resolve({
        channel: 'web',
        webOpenId: `webopenid:${input.code}`,
        unionId: 'union-shared'
      });
    };
    const api = new ApiService({
      database,
      now: () => now,
      resolveWeChatIdentity: resolve
    });

    const mpLogin = await api.handle({
      method: 'POST',
      path: '/v1/auth/login',
      body: { code: 'shared' }
    });
    const mpAuth = authData(mpLogin);
    const webLogin = await api.handle({
      method: 'POST',
      path: '/v1/auth/login',
      body: { channel: 'web', code: 'shared-web' }
    });
    const webAuth = authData(webLogin);
    expect(webAuth.userId).toBe(mpAuth.userId);
    const user = await database.findUserById(mpAuth.userId);
    expect(user?.mpOpenId).toBe('openid:shared');
    expect(user?.webOpenId).toBe('webopenid:shared-web');
    expect(user?.unionId).toBe('union-shared');
  });

  it('rejects identity conflicts', async () => {
    const database = new MemoryDatabase();
    await database.saveUser({
      id: 'user-a',
      unionId: 'union-1',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now
    });
    await database.saveUser({
      id: 'user-b',
      mpOpenId: 'mp-clash',
      openId: 'mp-clash',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now
    });
    const api = new ApiService({
      database,
      now: () => now,
      resolveWeChatIdentity: () =>
        Promise.resolve({
          channel: 'miniprogram',
          mpOpenId: 'mp-clash',
          unionId: 'union-1'
        })
    });
    const result = await api.handle({
      method: 'POST',
      path: '/v1/auth/login',
      body: { code: 'x' }
    });
    expect(result.status).toBe(409);
    expect(result.body.success).toBe(false);
    if (!result.body.success) {
      expect(result.body.error.code).toBe('IDENTITY_CONFLICT');
    }
  });

  it('revokes the current session on logout', async () => {
    const system = createTestSystem({ now });
    const login = await system.login('logout-user');
    const logout = await system.request({
      method: 'POST',
      path: '/v1/auth/logout',
      token: login.token,
      requestId: 'logout-1'
    });
    expect(logout.status).toBe(200);
    const tasks = await system.request({
      method: 'GET',
      path: '/v1/tasks',
      token: login.token
    });
    expect(tasks.status).toBe(401);
  });

  it('returns 503 when web credentials are missing', async () => {
    const failing = new ApiService({
      database: new MemoryDatabase(),
      now: () => now,
      exchangeLoginCode: (code) => Promise.resolve(`openid:${code}`)
    });
    const result = await failing.handle({
      method: 'POST',
      path: '/v1/auth/login',
      body: { channel: 'web', code: 'x' }
    });
    expect(result.status).toBe(503);
    expect(result.body.success).toBe(false);
    if (!result.body.success) {
      expect(result.body.error.code).toBe('WECHAT_WEB_NOT_CONFIGURED');
    }
    expect(createFakeWeChatIdentityResolver()).toBeTypeOf('function');
  });
});
