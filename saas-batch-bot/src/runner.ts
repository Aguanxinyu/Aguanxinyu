import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Account, AccountResult, AppConfig, RunStatus } from "./types.js";
import { sleepRange } from "./delay.js";
import { log } from "./logger.js";
import { launchBrowser, runAccountWorkflow } from "./workflow.js";

export type RunnerOptions = {
  dryRun: boolean;
  onlyFailed: boolean;
  limit?: number;
  accountIds?: string[];
};

function loadPreviousFailedIds(outputDir: string): Set<string> {
  const failedPath = path.join(outputDir, "results-latest.json");
  if (!existsSync(failedPath)) return new Set();

  try {
    const previous = JSON.parse(readFileSync(failedPath, "utf8")) as AccountResult[];
    return new Set(
      previous.filter((r) => r.status === "failed").map((r) => r.accountId),
    );
  } catch {
    return new Set();
  }
}

function filterAccounts(
  accounts: Account[],
  config: AppConfig,
  options: RunnerOptions,
): Account[] {
  let list = accounts.filter((a) => a.enabled);

  if (options.accountIds?.length) {
    const wanted = new Set(options.accountIds);
    list = list.filter((a) => wanted.has(a.id) || wanted.has(a.username));
  }

  if (options.onlyFailed) {
    const failedIds = loadPreviousFailedIds(config.paths.outputDir);
    list = list.filter((a) => failedIds.has(a.id));
  }

  if (options.limit && options.limit > 0) {
    list = list.slice(0, options.limit);
  }

  return list;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runOne(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    runOne(),
  );
  await Promise.all(workers);
  return results;
}

export async function runBatch(
  config: AppConfig,
  accounts: Account[],
  options: RunnerOptions,
): Promise<AccountResult[]> {
  const selected = filterAccounts(accounts, config, options);
  if (selected.length === 0) {
    log.warn("没有可执行的账号（检查 enabled / --only-failed / --limit）");
    return [];
  }

  log.info(
    `准备执行 ${selected.length} 个账号，concurrency=${config.concurrency}, dryRun=${options.dryRun}`,
  );

  const browser = await launchBrowser(config);
  const results: AccountResult[] = [];

  try {
    await mapPool(selected, config.concurrency, async (account, index) => {
      const startedAt = new Date();
      log.info(`[${index + 1}/${selected.length}] 开始账号 ${account.id} (${account.username})`);

      let status: RunStatus = "failed";
      let selectedCount = 0;
      let message = "";

      try {
        const outcome = await runAccountWorkflow(
          browser,
          config,
          account,
          options.dryRun,
        );
        selectedCount = outcome.selectedCount;
        message = outcome.message;
        status = options.dryRun ? "dry-run" : "success";
        log.info(`[${account.id}] ${status}: ${message}`);
      } catch (error) {
        status = "failed";
        message = error instanceof Error ? error.message : String(error);
        log.error(`[${account.id}] 失败: ${message}`);
      }

      const finishedAt = new Date();
      const result: AccountResult = {
        accountId: account.id,
        username: account.username,
        status,
        selectedCount,
        message,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      };
      results.push(result);

      if (index < selected.length - 1) {
        const waited = await sleepRange(config.delayBetweenAccountsMs);
        log.debug(`账号间隔等待 ${waited}ms`);
      }

      return result;
    });
  } finally {
    await browser.close();
  }

  // Keep output stable by account order in this run
  results.sort((a, b) => a.accountId.localeCompare(b.accountId));
  return results;
}
