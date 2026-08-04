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

async function isLoggedIn(page: Page, config: AppConfig): Promise<boolean> {
  if (await page.locator(config.selectors.loggedInMarker).first().isVisible().catch(() => false)) {
    return true;
  }
  // Fallback: login form gone + no top-right bare "登录"
  const loginFormVisible = await page
    .locator(config.selectors.loginForm)
    .first()
    .isVisible()
    .catch(() => false);
  if (loginFormVisible) return false;

  const hasToken = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    return keys.some((k) => /token|user|auth|uid/i.test(k) && !!localStorage.getItem(k));
  });
  return hasToken;
}

async function openLoginForm(page: Page, config: AppConfig): Promise<void> {
  const username = page.locator(config.selectors.usernameInput).first();
  if (await username.isVisible().catch(() => false)) return;

  const trigger = page.locator(config.selectors.openLoginTrigger).first();
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click({ force: true });
    await page.waitForTimeout(800);
  }

  // Last resort: click any visible span/button whose text is exactly 登录
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
    throw new Error("未能勾选《隐私政策》和《服务协议》，请检查页面");
  }
}

/**
 * 讯灵AI（xunlingai.com）账号密码登录。
 * 登录接口：POST /?act=login  body: {username,password,sig}
 */
export async function ensureLoggedIn(
  page: Page,
  config: AppConfig,
  account: Account,
): Promise<void> {
  const tasksUrl = buildAppUrl(config.baseUrl, config.tasksPath);
  await page.goto(tasksUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  if (await isLoggedIn(page, config)) {
    return;
  }

  const loginUrl = buildAppUrl(config.baseUrl, config.loginPath);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
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
    let payload: { error?: number; message?: string } = {};
    try {
      payload = (await loginResponse.json()) as { error?: number; message?: string };
    } catch {
      // ignore non-json
    }
    if (payload.error && payload.error !== 0) {
      throw new Error(`登录失败: ${payload.message || `error=${payload.error}`}`);
    }
  }

  await page.waitForTimeout(2000);

  // Prefer landing on tasks page after login
  await page.goto(tasksUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  if (!(await isLoggedIn(page, config))) {
    const toast = (
      await page.locator(".el-message, .el-message-box__message").allTextContents()
    )
      .map((t) => t.trim())
      .filter(Boolean)
      .join("; ");
    throw new Error(toast ? `登录失败: ${toast}` : "登录后仍未检测到登录态");
  }
}

/**
 * Select up to N visible task checkboxes, go next, then publish.
 * 任务页选择器需按真实「AI授课（发布）」页面再微调。
 */
export async function selectTasksAndPublish(
  page: Page,
  config: AppConfig,
): Promise<WorkflowOutcome> {
  await page.goto(buildAppUrl(config.baseUrl, config.tasksPath), {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1500);
  await humanPause(config);

  const rows = page.locator(config.selectors.taskRow);
  await rows.first().waitFor({ state: "visible", timeout: config.actionTimeoutMs }).catch(() => undefined);

  const checkboxes = page.locator(config.selectors.taskCheckbox);
  const total = await checkboxes.count();
  if (total === 0) {
    return { selectedCount: 0, message: "未找到可勾选任务（请确认 tasksPath / 选择器）" };
  }

  const limit = Math.min(total, config.maxTasksPerAccount);
  let selectedCount = 0;

  for (let i = 0; i < limit; i += 1) {
    const box = checkboxes.nth(i);
    if (!(await box.isVisible().catch(() => false))) continue;

    const alreadyChecked = await box.evaluate((el) => {
      if (el instanceof HTMLInputElement) return el.checked;
      return !!el.closest(".is-checked, .el-checkbox.is-checked");
    }).catch(() => false);
    if (alreadyChecked) continue;

    await box.click({ force: true });
    selectedCount += 1;
    await humanPause(config);
  }

  if (selectedCount === 0) {
    return { selectedCount: 0, message: "没有新的可勾选任务" };
  }

  const nextButton = page.locator(config.selectors.nextButton).first();
  if (await nextButton.isVisible().catch(() => false)) {
    await nextButton.click();
    await humanPause(config);
  }

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
