import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { chromium } from "playwright";
import type { Account, AppConfig } from "./types.js";
import { sleepRange } from "./delay.js";
import { log } from "./logger.js";

export type WorkflowOutcome = {
  selectedCount: number;
  message: string;
};

/** Support both normal paths and Vue hash routes like `#/sign`. */
export function buildAppUrl(baseUrl: string, routePath: string): string {
  if (/^https?:\/\//i.test(routePath)) return routePath;
  if (routePath.startsWith("#")) {
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return `${base}${routePath}`;
  }
  return new URL(routePath, baseUrl).toString();
}

function storageStatePath(config: AppConfig, account: Account): string {
  const safeId = account.id.replace(/[^\w.-]+/g, "_");
  return path.join(config.paths.authDir, `${safeId}.json`);
}

async function humanPause(config: AppConfig): Promise<void> {
  await sleepRange(config.delayBetweenActionsMs);
}

async function gotoWithRetry(page: Page, url: string, attempts = 3): Promise<void> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      return;
    } catch (error) {
      lastError = error;
      log.warn(`打开页面失败(${i}/${attempts}): ${url}`);
      await page.waitForTimeout(1000 * i);
    }
  }
  throw lastError;
}

async function isLoggedIn(page: Page, config: AppConfig): Promise<boolean> {
  if (await page.locator(config.selectors.loggedInMarker).first().isVisible().catch(() => false)) {
    return true;
  }
  const loginFormVisible = await page
    .locator(config.selectors.loginForm)
    .first()
    .isVisible()
    .catch(() => false);
  return !loginFormVisible && /用户名：/.test(await page.locator("body").innerText().catch(() => ""));
}

async function openLoginForm(page: Page, config: AppConfig): Promise<void> {
  const username = page.locator(config.selectors.usernameInput).first();
  if (await username.isVisible().catch(() => false)) return;

  const trigger = page.locator(config.selectors.openLoginTrigger).first();
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click({ force: true });
    await page.waitForTimeout(800);
  }

  if (!(await username.isVisible().catch(() => false))) {
    await page.evaluate(() => {
      const el = [...document.querySelectorAll("span,button,a")].find(
        (node) => node.textContent?.trim() === "登录" && (node as HTMLElement).offsetParent,
      ) as HTMLElement | undefined;
      el?.click();
    });
    await page.waitForTimeout(800);
  }

  await username.waitFor({ state: "visible", timeout: config.actionTimeoutMs });
}

async function ensureAgreementChecked(page: Page, config: AppConfig): Promise<void> {
  const checked = page.locator(config.selectors.agreeChecked).first();
  if (await checked.isVisible().catch(() => false)) return;
  await page.locator(config.selectors.agreeCheckbox).first().click({ force: true });
  await page.waitForTimeout(200);
  if (!(await checked.isVisible().catch(() => false))) {
    throw new Error("未能勾选《隐私政策》和《服务协议》");
  }
}

export async function ensureLoggedIn(
  page: Page,
  config: AppConfig,
  account: Account,
): Promise<void> {
  const homeUrl = buildAppUrl(config.baseUrl, "#/geo/index");
  await gotoWithRetry(page, homeUrl);
  await page.waitForTimeout(1500);
  if (await isLoggedIn(page, config)) return;

  const loginUrl = buildAppUrl(config.baseUrl, config.loginPath);
  await gotoWithRetry(page, loginUrl);
  await page.waitForTimeout(1500);
  await openLoginForm(page, config);
  await humanPause(config);

  await page.locator(config.selectors.usernameInput).first().fill(account.username);
  await humanPause(config);
  await page.locator(config.selectors.passwordInput).first().fill(account.password);
  await humanPause(config);
  await ensureAgreementChecked(page, config);

  const loginResponsePromise = page
    .waitForResponse(
      (res) => res.url().includes("act=login") && res.request().method() === "POST",
      { timeout: config.actionTimeoutMs },
    )
    .catch(() => null);

  await page.locator(config.selectors.loginButton).first().click();
  const loginResponse = await loginResponsePromise;
  if (loginResponse) {
    let payload: { error?: number; message?: string; user?: unknown } = {};
    try {
      payload = (await loginResponse.json()) as typeof payload;
    } catch {
      // ignore
    }
    if (payload.error && payload.error !== 0) {
      throw new Error(`登录失败: ${payload.message || `error=${payload.error}`}`);
    }
    if (!payload.user && payload.message) {
      throw new Error(`登录失败: ${payload.message}`);
    }
  }

  await page.waitForTimeout(2500);
  if (!(await isLoggedIn(page, config))) {
    throw new Error("登录后仍未检测到登录态");
  }
}

async function clickMediaTab(page: Page, tabName: string): Promise<void> {
  const tab = page.locator("button.el-button").filter({ hasText: new RegExp(`^${tabName}$`) }).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click({ force: true });
    return;
  }
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll("button.el-button")].find(
      (node) => node.textContent?.trim() === name && (node as HTMLElement).offsetParent,
    ) as HTMLElement | undefined;
    el?.click();
  }, tabName);
}

async function waitForTaskRows(page: Page, config: AppConfig): Promise<boolean> {
  try {
    await page.locator(config.selectors.taskRow).first().waitFor({
      state: "visible",
      timeout: 8000,
    });
    return (await page.locator(config.selectors.taskRow).count()) > 0;
  } catch {
    return false;
  }
}

async function openTasksPage(page: Page, config: AppConfig): Promise<void> {
  const tasksUrl = buildAppUrl(config.baseUrl, config.tasksPath);
  await gotoWithRetry(page, tasksUrl);
  await page.waitForTimeout(3000);

  // Wait until media tab buttons are ready.
  await page
    .locator("button.el-button")
    .filter({ hasText: /媒体训练|自媒体训练|官网训练/ })
    .first()
    .waitFor({ state: "visible", timeout: config.actionTimeoutMs });

  const tabName = config.scheme.mediaTab;
  const altTab =
    tabName === "第三方商业媒体训练" ? "第三方新闻媒体训练" : "第三方商业媒体训练";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    log.info(`加载任务列表 attempt=${attempt}, mediaTab=${tabName}`);

    // Already-selected tab often won't refetch. Switch away, then back.
    await clickMediaTab(page, altTab);
    await page.waitForTimeout(1000);

    const listPromise = page
      .waitForResponse(
        (res) => res.url().includes("generate-task/list") && res.status() === 200,
        { timeout: config.actionTimeoutMs },
      )
      .catch(() => null);

    await clickMediaTab(page, tabName);
    await listPromise;
    await page.waitForTimeout(1200);

    if (await waitForTaskRows(page, config)) return;
  }

  throw new Error(`任务列表加载失败（mediaTab=${tabName}）`);
}

function parsePublishedCount(rowText: string): number | null {
  const nums = [...rowText.matchAll(/(\d+)篇/g)].map((m) => Number(m[1]));
  if (nums.length >= 2) return nums[1];
  return null;
}

async function findTaskRows(page: Page, config: AppConfig): Promise<Locator[]> {
  const rows = page.locator(config.selectors.taskRow);
  const count = await rows.count();
  const matched: Locator[] = [];

  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const text = (await row.innerText().catch(() => "")).replace(/\s+/g, " ");
    if (!text || !text.includes("已生成")) continue;
    if (config.scheme.onlyUnpublishedTasks) {
      const published = parsePublishedCount(text);
      if (published === null || published > 0) continue;
    }
    const publishBtn = row.locator(config.selectors.taskPublishButton);
    if ((await publishBtn.count()) === 0) continue;
    matched.push(row);
    if (matched.length >= config.scheme.maxTasksPerAccount) break;
  }

  return matched;
}

async function publishFromTask(
  page: Page,
  config: AppConfig,
  row: Locator,
  dryRun: boolean,
): Promise<number> {
  await row.locator(config.selectors.taskPublishButton).first().click({ force: true });
  const dialog = page.locator(config.selectors.articleDialog).first();
  await dialog.waitFor({ state: "visible", timeout: config.actionTimeoutMs });
  await humanPause(config);

  const checks = dialog.locator(config.selectors.articleCheckbox);
  await checks.first().waitFor({ state: "visible", timeout: config.actionTimeoutMs });
  const total = await checks.count();
  const limit =
    config.scheme.selectMode === "all-visible"
      ? total
      : Math.min(total, config.scheme.maxArticlesPerTask);

  let selected = 0;
  for (let i = 0; i < limit; i += 1) {
    await checks.nth(i).click({ force: true });
    selected += 1;
    await page.waitForTimeout(150);
  }

  if (selected === 0) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return 0;
  }

  const actionBtn = dialog
    .locator("button")
    .filter({ hasText: /已选\s*[1-9]/ })
    .filter({ hasText: /训练|发布/ })
    .last();
  await actionBtn.waitFor({ state: "visible", timeout: config.actionTimeoutMs });

  if (dryRun) {
    log.info(`dry-run：已勾选 ${selected} 篇文章，跳过点击发布`);
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(500);
    return selected;
  }

  const toastPromise = page
    .locator(config.selectors.successToast)
    .first()
    .waitFor({ state: "visible", timeout: config.actionTimeoutMs })
    .then(() => true)
    .catch(() => false);

  await actionBtn.click();
  const ok = await toastPromise;
  await page.waitForTimeout(1500);

  // Close dialog if still open
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => undefined);
  }

  if (!ok) {
    const msg = (
      await page.locator(".el-message, .el-notification, .el-message-box__message").allTextContents()
    )
      .map((t) => t.trim())
      .filter(Boolean)
      .join("; ");
    if (msg && /失败|错误|不足/.test(msg)) {
      throw new Error(`发布失败: ${msg}`);
    }
    // Some flows succeed without a toast; accept selected count.
    log.warn(`未捕获到成功提示，已点击发布按钮（已选 ${selected}）`);
  }

  return selected;
}

/**
 * 讯灵 GEO：AI备课（图文）→ 点任务「发布」→ 勾选文章 → 点击「xxx训练（已选N个）」
 */
export async function selectTasksAndPublish(
  page: Page,
  config: AppConfig,
  dryRun = false,
): Promise<WorkflowOutcome> {
  await openTasksPage(page, config);
  await humanPause(config);

  const tasks = await findTaskRows(page, config);
  if (tasks.length === 0) {
    return {
      selectedCount: 0,
      message: `未找到可发布任务（方案=${config.activeScheme}, mediaTab=${config.scheme.mediaTab}, onlyUnpublished=${config.scheme.onlyUnpublishedTasks}）`,
    };
  }

  let selectedCount = 0;
  const notes: string[] = [];

  for (const [index, row] of tasks.entries()) {
    const raw = (await row.innerText()).replace(/\s+/g, " ").trim();
    const name =
      raw.match(/\d+\s+(.+?)\s+(搜索词场景|品牌场景|意图场景|问答词场景)/)?.[1] ||
      raw.slice(0, 40) ||
      `task-${index + 1}`;
    log.info(`处理任务: ${name}`);
    const count = await publishFromTask(page, config, row, dryRun);
    selectedCount += count;
    notes.push(`${name}: ${count}篇`);
    await humanPause(config);
  }

  return {
    selectedCount,
    message: `${dryRun ? "dry-run " : ""}处理 ${tasks.length} 个任务；${notes.join("；")}`,
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
    viewport: { width: 1600, height: 1000 },
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
    const outcome = await selectTasksAndPublish(page, config, dryRun);
    await persistAccountState(context, config, account);
    return outcome;
  } finally {
    await context.close();
  }
}
