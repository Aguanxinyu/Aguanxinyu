import type { Task } from '@today-todo/contracts';
import { DomainError } from '@today-todo/domain';

import type { BackendDatabase } from './database.js';
import type { SentMessage } from './types.js';

export interface WechatClientOptions {
  readonly appId: string;
  readonly appSecret: string;
  readonly reminderTemplateId: string;
  readonly reminderTemplateFields: Readonly<Record<string, 'title' | 'dueAt'>>;
  readonly reminderPage: string;
  readonly database: BackendDatabase;
}

export interface WechatClient {
  exchangeLoginCode(code: string): Promise<string>;
  sendMessage(message: SentMessage): Promise<void>;
}

export interface TemplateFieldValue {
  readonly value: string;
}

function formatDueAt(dueAt: number): string {
  const date = new Date(dueAt);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function buildTemplateData(
  fields: Readonly<Record<string, 'title' | 'dueAt'>>,
  task: Task
): Record<string, TemplateFieldValue> {
  const data: Record<string, TemplateFieldValue> = {};
  for (const [field, source] of Object.entries(fields)) {
    const value =
      source === 'title'
        ? task.title.slice(0, 20)
        : task.dueAt === undefined
          ? ''
          : formatDueAt(task.dueAt);
    data[field] = { value };
  }
  return data;
}

export function createWechatClient(options: WechatClientOptions): WechatClient {
  let accessToken: { token: string; expiresAt: number } | undefined;

  const requireCredentials = (): void => {
    if (options.appId.length === 0 || options.appSecret.length === 0) {
      throw new DomainError('WECHAT_NOT_CONFIGURED');
    }
  };

  const exchangeLoginCode = async (code: string): Promise<string> => {
    requireCredentials();
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', options.appId);
    url.searchParams.set('secret', options.appSecret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    const response = await fetch(url);
    const payload = (await response.json()) as {
      openid?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (typeof payload.openid !== 'string' || payload.openid.length === 0) {
      throw new DomainError('WECHAT_LOGIN_FAILED');
    }
    return payload.openid;
  };

  const getAccessToken = async (): Promise<string> => {
    requireCredentials();
    if (accessToken !== undefined && accessToken.expiresAt > Date.now() + 60_000) {
      return accessToken.token;
    }
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', options.appId);
    url.searchParams.set('secret', options.appSecret);
    const response = await fetch(url);
    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
    };
    if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
      throw new DomainError('WECHAT_LOGIN_FAILED');
    }
    accessToken = {
      token: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 7200) * 1000
    };
    return accessToken.token;
  };

  const sendMessage = async (message: SentMessage): Promise<void> => {
    requireCredentials();
    if (options.reminderTemplateId.length === 0) {
      throw new DomainError('WECHAT_NOT_CONFIGURED');
    }
    const user = await options.database.findUserById(message.userId);
    if (user === undefined) {
      throw new Error(`user not found: ${message.userId}`);
    }
    const task = await options.database.findTask(message.userId, message.taskId);
    if (task === undefined) {
      throw new Error(`task not found: ${message.taskId}`);
    }
    const token = await getAccessToken();
    const url = new URL('https://api.weixin.qq.com/cgi-bin/message/subscribe/send');
    url.searchParams.set('access_token', token);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        touser: user.openId,
        template_id: options.reminderTemplateId,
        page: options.reminderPage,
        miniprogram_state: 'formal',
        lang: 'zh_CN',
        data: buildTemplateData(options.reminderTemplateFields, task)
      })
    });
    const payload = (await response.json()) as { errcode?: number; errmsg?: string };
    if (payload.errcode !== 0) {
      throw new Error(
        `subscribe send failed: ${String(payload.errcode ?? 'no errcode')} ${payload.errmsg ?? ''}`.trim()
      );
    }
  };

  return { exchangeLoginCode, sendMessage };
}
