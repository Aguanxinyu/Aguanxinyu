import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Task } from '@today-todo/contracts';
import { DomainError } from '@today-todo/domain';

import {
  buildTemplateData,
  createWechatClient,
  MemoryDatabase
} from '../../packages/backend/src/index.js';

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    userId: 'user-1',
    title: '提交周报',
    dueHasTime: true,
    startHasTime: false,
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

  it('formats dueAt as YYYY-MM-DD HH:mm in Asia/Shanghai', () => {
    const dueAt = Date.UTC(2026, 6, 31, 1, 5);
    const data = buildTemplateData({ time2: 'dueAt' }, makeTask({ dueAt }));
    expect(data.time2?.value).toBe('2026-07-31 09:05');
  });

  it('renders an empty value when dueAt is absent', () => {
    const data = buildTemplateData({ time2: 'dueAt' }, makeTask({}));
    expect(data.time2?.value).toBe('');
  });

  it('maps every configured field', () => {
    const dueAt = Date.UTC(2026, 7, 1, 10, 30);
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

describe('createWechatClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects login when credentials are missing', async () => {
    const database = new MemoryDatabase();
    const client = createWechatClient({
      appId: '',
      appSecret: '',
      reminderTemplateId: 'tmpl',
      reminderTemplateFields: {},
      reminderPage: 'pages/todos/index',
      database
    });
    await expect(client.exchangeLoginCode('code')).rejects.toBeInstanceOf(DomainError);
  });

  it('exchanges a login code for an openId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ openid: 'openid-alice' })
    });
    vi.stubGlobal('fetch', fetchMock);
    const database = new MemoryDatabase();
    const client = createWechatClient({
      appId: 'wx-app',
      appSecret: 'secret',
      reminderTemplateId: 'tmpl',
      reminderTemplateFields: { thing1: 'title' },
      reminderPage: 'pages/todos/index',
      database
    });

    await expect(client.exchangeLoginCode('login-code')).resolves.toBe('openid-alice');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('jscode2session');
  });

  it('sends a subscription message after caching the access token', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const database = new MemoryDatabase();
    await database.saveUser({
      id: 'user-1',
      openId: 'openid-alice',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now
    });
    await database.saveTask(
      makeTask({
        id: 'task-1',
        userId: 'user-1',
        title: '准时提醒',
        dueAt: now + 15 * 60 * 1000
      })
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ access_token: 'token-1', expires_in: 7200 })
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ errcode: 0, errmsg: 'ok' })
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = createWechatClient({
      appId: 'wx-app',
      appSecret: 'secret',
      reminderTemplateId: 'tmpl-1',
      reminderTemplateFields: { thing1: 'title', time2: 'dueAt' },
      reminderPage: 'pages/todos/index',
      database
    });

    await client.sendMessage({
      userId: 'user-1',
      taskId: 'task-1',
      title: '准时提醒'
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sendCall = fetchMock.mock.calls[1];
    expect(String(sendCall?.[0])).toContain('subscribe/send');
    const sendInit = sendCall?.[1] as RequestInit | undefined;
    const rawBody = sendInit?.body;
    expect(typeof rawBody).toBe('string');
    const body = JSON.parse(rawBody as string) as {
      touser: string;
      page: string;
      data: Record<string, { value: string }>;
    };
    expect(body.touser).toBe('openid-alice');
    expect(body.page).toBe('pages/todos/index');
    expect(body.data.thing1?.value).toBe('准时提醒');
  });

  it('surfaces WeChat send failures', async () => {
    const now = Date.UTC(2026, 6, 31, 4);
    const database = new MemoryDatabase();
    await database.saveUser({
      id: 'user-1',
      openId: 'openid-alice',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now
    });
    await database.saveTask(makeTask({ id: 'task-1', userId: 'user-1' }));

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ access_token: 'token-1', expires_in: 7200 })
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ errcode: 43101, errmsg: 'user refuse' })
        })
    );

    const client = createWechatClient({
      appId: 'wx-app',
      appSecret: 'secret',
      reminderTemplateId: 'tmpl-1',
      reminderTemplateFields: { thing1: 'title' },
      reminderPage: 'pages/todos/index',
      database
    });

    await expect(
      client.sendMessage({
        userId: 'user-1',
        taskId: 'task-1',
        title: '准时提醒'
      })
    ).rejects.toThrow(/43101/);
  });
});
