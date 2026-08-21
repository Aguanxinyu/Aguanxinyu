import process from 'node:process';

import pg from 'pg';

import { ApiService } from './api-service.js';
import { startServer } from './http-server.js';
import { PostgresDatabase } from './postgres-database.js';
import { Schedulers } from './schedulers.js';
import { createWechatClient } from './wechat.js';

const { Pool } = pg;

const REMINDER_INTERVAL_MS = 60_000;
const MAINTENANCE_INTERVAL_MS = 60 * 60_000;
const DEFAULT_PORT = 8080;
const DEFAULT_REMINDER_PAGE = 'pages/todos/index';

function env(name: string): string {
  return process.env[name] ?? '';
}

function logError(error: unknown, operation: string): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${operation}] ${message}`);
}

function localDateString(now: number): string {
  const date = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
  const reminderTemplateId = env('WECHAT_REMINDER_TEMPLATE_ID');
  const reminderTemplateFields = parseTemplateFields(env('WECHAT_REMINDER_TEMPLATE_FIELDS'));
  const reminderPage = env('WECHAT_REMINDER_PAGE') || DEFAULT_REMINDER_PAGE;

  const wechat = createWechatClient({
    appId,
    appSecret,
    reminderTemplateId,
    reminderTemplateFields,
    reminderPage,
    database
  });

  const fakeLogin = env('DEV_FAKE_LOGIN') === '1';
  const exchangeLoginCode = fakeLogin
    ? (code: string): Promise<string> => Promise.resolve(`openid:${code}`)
    : (code: string): Promise<string> => wechat.exchangeLoginCode(code);

  const api = new ApiService({ database, now, exchangeLoginCode });
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
    void schedulers.materializeAndClean(localDateString(now())).catch((error: unknown) => {
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
    `[start] reminders: ${reminderTemplateId.length > 0 ? 'configured' : 'NOT CONFIGURED'}`
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
