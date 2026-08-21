import type { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ApiResponse, Task } from '@today-todo/contracts';

import {
  ApiService,
  type AuthData,
  MemoryDatabase,
  startServer
} from '../../packages/backend/src/index.js';

describe('HTTP server adapter', () => {
  const now = Date.UTC(2026, 6, 31, 4);
  const database = new MemoryDatabase();
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const api = new ApiService({
      database,
      now: () => now,
      exchangeLoginCode: (code: string) => Promise.resolve(`openid:${code}`)
    });
    server = startServer({ api, port: 0 });
    await new Promise<void>((resolve) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once('listening', () => {
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('无法获取监听端口');
    }
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  async function login(code: string): Promise<string> {
    const response = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code })
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ApiResponse<AuthData>;
    if (!body.success) {
      throw new Error(`登录失败：${body.error.code}`);
    }
    return body.data.token;
  }

  async function createTask(
    token: string,
    requestId: string,
    title: string
  ): Promise<ApiResponse<Task>> {
    const response = await fetch(`${baseUrl}/v1/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-token': token,
        'x-request-id': requestId
      },
      body: JSON.stringify({ title, priority: 'MEDIUM', dueHasTime: false, tagIds: [] })
    });
    expect(response.status).toBe(201);
    return (await response.json()) as ApiResponse<Task>;
  }

  it('serves the health endpoint without authentication', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body).toEqual({ ok: true });
  });

  it('logs in and creates a task over real HTTP', async () => {
    const token = await login('http-alice');
    const created = await createTask(token, 'http-create-1', 'HTTP 任务');
    if (!created.success) {
      throw new Error(`创建失败：${created.error.code}`);
    }
    expect(created.data.title).toBe('HTTP 任务');
    expect(created.data.listId).toBe('inbox');
  });

  it('applies PATCH through the X-HTTP-Method-Override header', async () => {
    const token = await login('http-patch-user');
    const created = await createTask(token, 'http-patch-create', '待改');
    if (!created.success) {
      throw new Error(`创建失败：${created.error.code}`);
    }
    const patched = await fetch(`${baseUrl}/v1/tasks/${created.data.id}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-token': token,
        'x-request-id': 'http-patch-apply',
        'x-http-method-override': 'PATCH'
      },
      body: JSON.stringify({ version: created.data.version, title: '已改' })
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as ApiResponse<Task>;
    if (!patchedBody.success) {
      throw new Error(`更新失败：${patchedBody.error.code}`);
    }
    expect(patchedBody.data.title).toBe('已改');
    expect(patchedBody.data.version).toBe(created.data.version + 1);
  });

  it('rejects requests without a session token', async () => {
    const response = await fetch(`${baseUrl}/v1/tasks`);
    expect(response.status).toBe(401);
  });

  it('returns 404 for an unknown route', async () => {
    const token = await login('http-404-user');
    const response = await fetch(`${baseUrl}/v1/nope`, {
      headers: { 'x-session-token': token }
    });
    expect(response.status).toBe(404);
  });

  it('returns 400 for a malformed JSON body', async () => {
    const response = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{broken json'
    });
    expect(response.status).toBe(400);
  });

  it('rejects unsupported HTTP methods', async () => {
    const response = await fetch(`${baseUrl}/v1/tasks`, { method: 'PUT' });
    expect(response.status).toBe(405);
  });

  it('rejects oversized request bodies', async () => {
    const response = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(1024 * 1024 + 1)
    });
    expect(response.status).toBe(413);
  });
});
