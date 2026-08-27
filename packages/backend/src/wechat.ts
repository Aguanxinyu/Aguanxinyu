import type { Task } from '@today-todo/contracts';
import { DomainError, type AuthChannel, type WeChatIdentity } from '@today-todo/domain';

import type { BackendDatabase } from './database.js';
import type { SentMessage } from './types.js';

export interface WechatClientOptions {
  readonly appId: string;
  readonly appSecret: string;
  readonly webAppId?: string;
  readonly webAppSecret?: string;
  readonly reminderTemplateId: string;
  readonly reminderTemplateFields: Readonly<Record<string, 'title' | 'dueAt'>>;
  readonly reminderPage: string;
  readonly database: BackendDatabase;
}

export interface WechatClient {
  exchangeLoginCode(code: string): Promise<string>;
  resolveWeChatIdentity(input: {
    readonly channel: AuthChannel;
    readonly code: string;
  }): Promise<WeChatIdentity>;
  sendMessage(message: SentMessage): Promise<void>;
}

export interface TemplateFieldValue {
  readonly value: string;
}

function formatDueAt(dueAt: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(dueAt));
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${lookup('year')}-${lookup('month')}-${lookup('day')} ${lookup('hour')}:${lookup('minute')}`;
}

export function buildTemplateData(
  fields: Readonly<Record<string, 'title' | 'dueAt'>>,
  task: Task
): Record<string, TemplateFieldValue> {
  const data: Record<string, TemplateFieldValue> = {};
  for (const [key, source] of Object.entries(fields)) {
    const value =
      source === 'title'
        ? task.title.slice(0, 20)
        : task.dueAt === undefined
          ? ''
          : formatDueAt(task.dueAt);
    data[key] = { value };
  }
  return data;
}

export function createFakeWeChatIdentityResolver(): (input: {
  readonly channel: AuthChannel;
  readonly code: string;
}) => Promise<WeChatIdentity> {
  return (input) => {
    if (input.channel === 'web') {
      return Promise.resolve({
        channel: 'web',
        webOpenId: `webopenid:${input.code}`,
        unionId: `union:${input.code}`
      });
    }
    return Promise.resolve({
      channel: 'miniprogram',
      mpOpenId: `openid:${input.code}`
    });
  };
}

export function createWechatClient(options: WechatClientOptions): WechatClient {
  let accessToken: { token: string; expiresAt: number } | undefined;

  const requireMpCredentials = (): void => {
    if (options.appId.length === 0 || options.appSecret.length === 0) {
      throw new DomainError('WECHAT_NOT_CONFIGURED');
    }
  };

  const requireWebCredentials = (): void => {
    if (
      options.webAppId === undefined ||
      options.webAppId.length === 0 ||
      options.webAppSecret === undefined ||
      options.webAppSecret.length === 0
    ) {
      throw new DomainError('WECHAT_WEB_NOT_CONFIGURED');
    }
  };

  const exchangeLoginCode = async (code: string): Promise<string> => {
    const identity = await resolveWeChatIdentity({ channel: 'miniprogram', code });
    if (identity.mpOpenId === undefined) {
      throw new DomainError('WECHAT_LOGIN_FAILED');
    }
    return identity.mpOpenId;
  };

  const exchangeMiniprogram = async (code: string): Promise<WeChatIdentity> => {
    requireMpCredentials();
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', options.appId);
    url.searchParams.set('secret', options.appSecret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    const response = await fetch(url);
    const payload = (await response.json()) as {
      openid?: string;
      unionid?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (typeof payload.openid !== 'string' || payload.openid.length === 0) {
      throw new DomainError('WECHAT_LOGIN_FAILED');
    }
    return {
      channel: 'miniprogram',
      mpOpenId: payload.openid,
      ...(typeof payload.unionid === 'string' && payload.unionid.length > 0
        ? { unionId: payload.unionid }
        : {})
    };
  };

  const exchangeWeb = async (code: string): Promise<WeChatIdentity> => {
    requireWebCredentials();
    const webAppId = options.webAppId ?? '';
    const webAppSecret = options.webAppSecret ?? '';
    const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    url.searchParams.set('appid', webAppId);
    url.searchParams.set('secret', webAppSecret);
    url.searchParams.set('code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    const response = await fetch(url);
    const payload = (await response.json()) as {
      openid?: string;
      unionid?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (typeof payload.openid !== 'string' || payload.openid.length === 0) {
      throw new DomainError('WECHAT_WEB_LOGIN_FAILED');
    }
    return {
      channel: 'web',
      webOpenId: payload.openid,
      ...(typeof payload.unionid === 'string' && payload.unionid.length > 0
        ? { unionId: payload.unionid }
        : {})
    };
  };

  const resolveWeChatIdentity = async (input: {
    readonly channel: AuthChannel;
    readonly code: string;
  }): Promise<WeChatIdentity> => {
    return input.channel === 'web' ? exchangeWeb(input.code) : exchangeMiniprogram(input.code);
  };

  const getAccessToken = async (): Promise<string> => {
    requireMpCredentials();
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
    requireMpCredentials();
    if (options.reminderTemplateId.length === 0) {
      throw new DomainError('WECHAT_NOT_CONFIGURED');
    }
    const user = await options.database.findUserById(message.userId);
    if (user === undefined) {
      throw new Error(`user not found: ${message.userId}`);
    }
    const touser = user.mpOpenId ?? user.openId;
    if (touser === undefined || touser.length === 0) {
      throw new Error(`user has no miniprogram openid: ${message.userId}`);
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
        touser,
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

  return { exchangeLoginCode, resolveWeChatIdentity, sendMessage };
}
