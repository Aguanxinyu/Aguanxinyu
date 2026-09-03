import process from 'node:process';

import { shanghaiDateKey } from '@today-todo/domain';
import pg from 'pg';

import { ApiService } from './api-service.js';
import { startServer } from './http-server.js';
import {
  createOpenAiCompatibleDailyReviewClient,
  createOpenAiCompatibleLlmClient
} from './llm-client.js';
import { PostgresDatabase } from './postgres-database.js';
import { Schedulers } from './schedulers.js';
import { createFakeWeChatIdentityResolver, createWechatClient } from './wechat.js';

const { Pool } = pg;

const REMINDER_INTERVAL_MS = 60_000;
const MAINTENANCE_INTERVAL_MS = 60 * 60_000;
const DEFAULT_PORT = 8080;
const DEFAULT_REMINDER_PAGE = 'pages/todos/index';
const RECURRENCE_HORIZON_MS = 60 * 24 * 60 * 60 * 1000;

function env(name: string): string {
  return process.env[name] ?? '';
}

function logError(error: unknown, operation: string): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${operation}] ${message}`);
}

function parseTemplateFields(raw: string): Record<string, 'title' | 'dueAt'> {
  if (raw.length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[config] WECHAT_REMINDER_TEMPLATE_FIELDS 不是合法 JSON，已忽略：${raw}`);
    return {};
  }
  if (parsed === null || typeof parsed !== 'object') {
    console.warn('[config] WECHAT_REMINDER_TEMPLATE_FIELDS 必须是 JSON 对象，已忽略');
    return {};
  }
  const fields: Record<string, 'title' | 'dueAt'> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && (value === 'title' || value === 'dueAt')) {
      fields[key] = value;
    }
  }
  return fields;
}

function main(): void {
  const databaseUrl = env('DATABASE_URL');
  if (databaseUrl.length === 0) {
    console.error('DATABASE_URL 未设置，服务无法启动');
    process.exit(1);
  }
  const parsedPort = Number(env('PORT') || String(DEFAULT_PORT));
  const port = Number.isInteger(parsedPort) ? parsedPort : DEFAULT_PORT;

  const pool = new Pool({ connectionString: databaseUrl });
  const database = new PostgresDatabase(pool);
  const now = (): number => Date.now();

  const appId = env('WECHAT_APP_ID');
  const appSecret = env('WECHAT_APP_SECRET');
  const webAppId = env('WECHAT_WEB_APP_ID');
  const webAppSecret = env('WECHAT_WEB_APP_SECRET');
  const reminderTemplateId = env('WECHAT_REMINDER_TEMPLATE_ID');
  const reminderTemplateFields = parseTemplateFields(env('WECHAT_REMINDER_TEMPLATE_FIELDS'));
  const reminderPage = env('WECHAT_REMINDER_PAGE') || DEFAULT_REMINDER_PAGE;

  const wechat = createWechatClient({
    appId,
    appSecret,
    ...(webAppId.length > 0 ? { webAppId } : {}),
    ...(webAppSecret.length > 0 ? { webAppSecret } : {}),
    reminderTemplateId,
    reminderTemplateFields,
    reminderPage,
    database
  });

  const fakeLoginRequested = env('DEV_FAKE_LOGIN') === '1';
  if (fakeLoginRequested && env('NODE_ENV') === 'production') {
    throw new Error('DEV_FAKE_LOGIN cannot be enabled when NODE_ENV=production');
  }
  const fakeLogin = fakeLoginRequested;
  const resolveWeChatIdentity = fakeLogin
    ? createFakeWeChatIdentityResolver()
    : (input: { readonly channel: 'miniprogram' | 'web'; readonly code: string }) =>
        wechat.resolveWeChatIdentity(input);

  const llmApiKey = env('LLM_API_KEY');
  const llmBaseUrl = env('LLM_API_BASE_URL');
  const llmModel = env('LLM_MODEL') || 'deepseek-chat';
  const generateWeeklyReviewWithLlm =
    llmApiKey.length > 0 && llmBaseUrl.length > 0
      ? createOpenAiCompatibleLlmClient({
          baseUrl: llmBaseUrl,
          apiKey: llmApiKey,
          model: llmModel
        })
      : undefined;
  const generateDailyReviewWithLlm =
    llmApiKey.length > 0 && llmBaseUrl.length > 0
      ? createOpenAiCompatibleDailyReviewClient({
          baseUrl: llmBaseUrl,
          apiKey: llmApiKey,
          model: llmModel
        })
      : undefined;

  const api = new ApiService({
    database,
    now,
    resolveWeChatIdentity,
    ...(generateWeeklyReviewWithLlm === undefined ? {} : { generateWeeklyReviewWithLlm }),
    ...(generateDailyReviewWithLlm === undefined ? {} : { generateDailyReviewWithLlm })
  });
  const schedulers = new Schedulers({
    database,
    api,
    now,
    sendMessage: (message) => wechat.sendMessage(message),
    reportError: logError
  });

  const server = startServer({
    api,
    port,
    logger: (message: string) => {
      console.log(message);
    }
  });

  const dispatchReminders = (): void => {
    void schedulers.dispatchReminders(now()).catch((error: unknown) => {
      logError(error, 'dispatchReminders');
    });
  };
  const runMaintenance = (): void => {
    const throughDate = shanghaiDateKey(now() + RECURRENCE_HORIZON_MS);
    void schedulers.materializeAndClean(throughDate).catch((error: unknown) => {
      logError(error, 'materializeAndClean');
    });
  };

  const reminderTimer = setInterval(dispatchReminders, REMINDER_INTERVAL_MS);
  const maintenanceTimer = setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log('[shutdown] 收到退出信号，正在关闭…');
    clearInterval(reminderTimer);
    clearInterval(maintenanceTimer);
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });

  console.log(`[start] listening on http://127.0.0.1:${String(port)}`);
  console.log(
    `[start] wechat login: ${fakeLogin ? 'FAKE' : appId.length > 0 && appSecret.length > 0 ? 'configured' : 'NOT CONFIGURED'}`
  );
  console.log(
    `[start] wechat web login: ${fakeLogin ? 'FAKE' : webAppId.length > 0 && webAppSecret.length > 0 ? 'configured' : 'NOT CONFIGURED'}`
  );
  console.log(
    `[start] reminders: ${reminderTemplateId.length > 0 ? 'configured' : 'NOT CONFIGURED'}`
  );
  console.log(
    `[start] weekly review LLM: ${generateWeeklyReviewWithLlm !== undefined ? 'configured' : 'rules-only fallback'}`
  );
  console.log('[start] maintenance: 每小时 + 启动时');

  runMaintenance();
  dispatchReminders();
}

try {
  main();
} catch (error: unknown) {
  logError(error, 'startup');
  process.exit(1);
}
