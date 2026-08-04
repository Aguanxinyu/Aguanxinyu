import { existsSync } from "node:fs";
import path from "node:path";
import { getRootDir, listSchemes, loadConfig } from "./config.js";
import type { SelectMode } from "./types.js";
import { loadAccounts } from "./csv.js";
import { log } from "./logger.js";
import { writeResults } from "./results.js";
import { runBatch } from "./runner.js";

function printHelp(): void {
  console.log(`
讯灵多账号批量发布机器人（运维版）

用法:
  npm start -- [选项]

常用选项:
  --scheme <name>       使用点击方案（见 config/default.json → schemes）
  --list-schemes        列出所有可点击方案
  --dry-run             演练：登录并勾选，但不点最终发布
  --only-failed         只重跑上次失败账号
  --limit <n>           本次最多跑 n 个账号
  --account <id>        只跑指定账号，可重复
  --accounts <path>     指定账号 CSV
  --config <path>       指定配置文件

临时覆盖方案参数（不改配置文件）:
  --media-tab <name>    覆盖媒体 Tab，如 第三方商业媒体训练
  --tasks <n>           每账号处理几个任务
  --articles <n>        每任务勾几篇文章
  --all-articles        勾选弹窗内全部可见文章
  --include-published   不限制“仅未发布任务”

示例:
  npm start -- --list-schemes
  npm start -- --scheme news-unpublished --limit 1 --dry-run
  npm start -- --scheme business-unpublished --limit 5
  npm start -- --scheme news-batch-3
  npm start -- --media-tab 第三方商业媒体训练 --tasks 2 --articles 3 --dry-run
`);
}

function parseArgs(argv: string[]) {
  const options = {
    dryRun: false,
    onlyFailed: false,
    limit: undefined as number | undefined,
    accountIds: [] as string[],
    accountsPath: undefined as string | undefined,
    configPath: undefined as string | undefined,
    schemeName: undefined as string | undefined,
    mediaTab: undefined as string | undefined,
    maxTasksPerAccount: undefined as number | undefined,
    maxArticlesPerTask: undefined as number | undefined,
    onlyUnpublishedTasks: undefined as boolean | undefined,
    selectMode: undefined as SelectMode | undefined,
    listSchemes: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--only-failed":
        options.onlyFailed = true;
        break;
      case "--limit":
        options.limit = Number(argv[++i]);
        break;
      case "--account":
        options.accountIds.push(argv[++i]);
        break;
      case "--accounts":
        options.accountsPath = argv[++i];
        break;
      case "--config":
        options.configPath = argv[++i];
        break;
      case "--scheme":
        options.schemeName = argv[++i];
        break;
      case "--media-tab":
        options.mediaTab = argv[++i];
        break;
      case "--tasks":
        options.maxTasksPerAccount = Number(argv[++i]);
        break;
      case "--articles":
        options.maxArticlesPerTask = Number(argv[++i]);
        break;
      case "--all-articles":
        options.selectMode = "all-visible";
        break;
      case "--include-published":
        options.onlyUnpublishedTasks = false;
        break;
      case "--list-schemes":
        options.listSchemes = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }

  const configPath = cli.configPath
    ? path.resolve(cli.configPath)
    : path.join(getRootDir(), "config/default.json");

  if (cli.listSchemes) {
    const schemes = listSchemes(configPath);
    console.log("可用点击方案:\n");
    for (const { name, scheme } of schemes) {
      console.log(`- ${name}`);
      console.log(`  名称: ${scheme.label}`);
      console.log(`  Tab : ${scheme.mediaTab}`);
      console.log(
        `  规则: 每号${scheme.maxTasksPerAccount}任务 / 每任务${scheme.maxArticlesPerTask}篇 / 仅未发布=${scheme.onlyUnpublishedTasks} / 勾选=${scheme.selectMode}`,
      );
      if (scheme.description) console.log(`  说明: ${scheme.description}`);
      console.log("");
    }
    return;
  }

  const config = loadConfig(configPath, {
    schemeName: cli.schemeName,
    mediaTab: cli.mediaTab,
    maxTasksPerAccount: cli.maxTasksPerAccount,
    maxArticlesPerTask: cli.maxArticlesPerTask,
    onlyUnpublishedTasks: cli.onlyUnpublishedTasks,
    selectMode: cli.selectMode,
  });

  const accountsPath = cli.accountsPath
    ? path.resolve(cli.accountsPath)
    : config.paths.accountsCsv;

  if (!existsSync(accountsPath)) {
    const example = path.join(getRootDir(), "data/accounts.example.csv");
    throw new Error(
      `找不到账号文件: ${accountsPath}\n请复制 ${example} 为 data/accounts.csv 并填入真实账号`,
    );
  }

  log.info(`当前点击方案: ${config.activeScheme}（${config.scheme.label}）`);
  log.info(
    `媒体Tab=${config.scheme.mediaTab}; 每号任务=${config.scheme.maxTasksPerAccount}; 每任务文章=${config.scheme.maxArticlesPerTask}; 仅未发布=${config.scheme.onlyUnpublishedTasks}`,
  );

  const accounts = await loadAccounts(accountsPath);
  log.info(`已加载账号 ${accounts.length} 个（含未启用）`);

  const results = await runBatch(config, accounts, {
    dryRun: cli.dryRun,
    onlyFailed: cli.onlyFailed,
    limit: cli.limit,
    accountIds: cli.accountIds.length ? cli.accountIds : undefined,
  });

  if (results.length === 0) {
    return;
  }

  const out = writeResults(config.paths.outputDir, results);
  const ok = results.filter((r) => r.status === "success" || r.status === "dry-run").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  log.info(`完成：成功/演练 ${ok}，失败 ${failed}，跳过 ${skipped}`);
  log.info(`结果文件: ${out}`);
  log.info(`失败清单: ${path.join(config.paths.outputDir, "failed-latest.csv")}`);
}

main().catch((error) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
