import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import type { Account, AppConfig } from "./types.js";
import { sleepRange } from "./delay.js";
import { log } from "./logger.js";

export type WorkflowOutcome = {
  selectedCount: number;
  message: string;
};

function joinUrl(baseUrl: string, pathname: string): string {
  return new URL(pathname, baseUrl).toString();
}

function storageStatePath(config: AppConfig, account: Account): string {
  const safeId = account.id.replace(/[^\w.-]+/g, "_");
  return path.join(config.paths.authDir, `${safeId}.json`);
}

async function humanPause(config: AppConfig): Promise<void> {
  await sleepRange(config.delayBetweenActionsMs);
}

async function firstVisible(page: Page, selector: string) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: 8000 });
  return locator;
}

/**
 * Adapt these steps to your real SaaS DOM.
 * Prefer stable selectors (data-testid / role / exact text) over brittle CSS.
 */
export async function ensureLoggedIn(
  page: Page,
  config: AppConfig,
  account: Account,
): Promise<void> {
  const tasksUrl = joinUrl(config.baseUrl, config.tasksPath);
  await page.goto(tasksUrl, { waitUntil: "domcontentloaded" });

  // Already in app?
  const taskProbe = page.locator(config.selectors.taskRow).first();
  if (await taskProbe.isVisible().catch(() => false)) {
    return;
  }

  const loginUrl = joinUrl(config.baseUrl, config.loginPath);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await humanPause(config);

  const username = await firstVisible(page, config.selectors.usernameInput);
  await username.fill(account.username);
  await humanPause(config);

  const password = await firstVisible(page, config.selectors.passwordInput);
  await password.fill(account.password);
  await humanPause(config);

  const loginButton = await firstVisible(page, config.selectors.loginButton);
  await loginButton.click();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await humanPause(config);

  await page.goto(tasksUrl, { waitUntil: "domcontentloaded" });
  await page.locator(config.selectors.taskRow).first().waitFor({
    state: "visible",
    timeout: config.actionTimeoutMs,
  });
}

/**
 * Select up to N visible task checkboxes, go next, then publish.
 * Customize selection rules here (by status, keyword, date, etc.).
 */
export async function selectTasksAndPublish(
  page: Page,
  config: AppConfig,
): Promise<WorkflowOutcome> {
  await page.goto(joinUrl(config.baseUrl, config.tasksPath), {
    waitUntil: "domcontentloaded",
  });
  await humanPause(config);

  const checkboxes = page.locator(config.selectors.taskCheckbox);
  const total = await checkboxes.count();
  if (total === 0) {
    return { selectedCount: 0, message: "未找到可勾选任务" };
  }

  const limit = Math.min(total, config.maxTasksPerAccount);
  let selectedCount = 0;

  for (let i = 0; i < limit; i += 1) {
    const box = checkboxes.nth(i);
    if (!(await box.isVisible().catch(() => false))) continue;
    if (await box.isChecked().catch(() => false)) continue;
    await box.check({ force: true }).catch(async () => {
      await box.click({ force: true });
    });
    selectedCount += 1;
    await humanPause(config);
  }

  if (selectedCount === 0) {
    return { selectedCount: 0, message: "没有新的可勾选任务" };
  }

  const nextButton = page.locator(config.selectors.nextButton).first();
  await nextButton.waitFor({ state: "visible", timeout: config.actionTimeoutMs });
  await nextButton.click();
  await humanPause(config);

  const publishButton = page.locator(config.selectors.publishButton).first();
  await publishButton.waitFor({ state: "visible", timeout: config.actionTimeoutMs });
  await publishButton.click();
  await humanPause(config);

  const success = page.locator(config.selectors.successToast).first();
  const ok = await success
    .waitFor({ state: "visible", timeout: config.actionTimeoutMs })
    .then(() => true)
    .catch(() => false);

  if (!ok) {
    // Some SaaS apps only redirect / disable the button on success.
    // Treat "publish button gone or disabled" as soft success.
    const stillEnabled = await publishButton.isEnabled().catch(() => false);
    const stillVisible = await publishButton.isVisible().catch(() => false);
    if (stillEnabled && stillVisible) {
      throw new Error("点击发布后未检测到成功状态，请检查选择器或页面流程");
    }
  }

  return {
    selectedCount,
    message: `已勾选 ${selectedCount} 个任务并发布`,
  };
}

export async function openAccountContext(
  browser: Browser,
  config: AppConfig,
  account: Account,
): Promise<BrowserContext> {
  mkdirSync(config.paths.authDir, { recursive: true });
  const statePath = storageStatePath(config, account);
  const hasState = config.reuseStorageState && existsSync(statePath);

  const context = await browser.newContext({
    storageState: hasState ? statePath : undefined,
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
  });
  context.setDefaultTimeout(config.actionTimeoutMs);
  context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  return context;
}

export async function persistAccountState(
  context: BrowserContext,
  config: AppConfig,
  account: Account,
): Promise<void> {
  if (!config.reuseStorageState) return;
  mkdirSync(config.paths.authDir, { recursive: true });
  await context.storageState({ path: storageStatePath(config, account) });
}

export async function launchBrowser(config: AppConfig): Promise<Browser> {
  log.info(`启动浏览器 headless=${config.headless}`);
  return chromium.launch({
    headless: config.headless,
    slowMo: config.slowMoMs,
  });
}

export async function runAccountWorkflow(
  browser: Browser,
  config: AppConfig,
  account: Account,
  dryRun: boolean,
): Promise<WorkflowOutcome> {
  const context = await openAccountContext(browser, config, account);
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, config, account);
    await persistAccountState(context, config, account);

    if (dryRun) {
      return {
        selectedCount: 0,
        message: "dry-run：已登录并到达任务页，跳过勾选/发布",
      };
    }

    const outcome = await selectTasksAndPublish(page, config);
    await persistAccountState(context, config, account);
    return outcome;
  } finally {
    await context.close();
  }
}
