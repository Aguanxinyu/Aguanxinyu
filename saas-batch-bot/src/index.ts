import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig, getRootDir } from "./config.js";
import { loadAccounts } from "./csv.js";
import { log } from "./logger.js";
import { writeResults } from "./results.js";
import { runBatch } from "./runner.js";

function printHelp(): void {
  console.log(`
SaaS 多账号批量发布机器人

用法:
  npm start -- [选项]

选项:
  --dry-run          只登录并打开任务页，不勾选/发布
  --only-failed      仅重跑上次失败的账号
  --limit <n>        本次最多跑 n 个账号（建议先 5~10）
  --account <id>     只跑指定账号，可重复传入
  --accounts <path>  指定账号 CSV 路径
  --config <path>    指定配置文件路径
  --help             显示帮助

示例:
  npm start -- --limit 5 --dry-run
  npm start -- --limit 10
  npm start -- --only-failed
  npm start -- --account acc001 --account acc002
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

  const config = loadConfig(
    cli.configPath
      ? path.resolve(cli.configPath)
      : path.join(getRootDir(), "config/default.json"),
  );

  const accountsPath = cli.accountsPath
    ? path.resolve(cli.accountsPath)
    : config.paths.accountsCsv;

  if (!existsSync(accountsPath)) {
    const example = path.join(getRootDir(), "data/accounts.example.csv");
    throw new Error(
      `找不到账号文件: ${accountsPath}\n请复制 ${example} 为 data/accounts.csv 并填入真实账号`,
    );
  }

  if (config.baseUrl.includes("your-saas.example.com")) {
    log.warn(
      "当前仍是示例域名。请先修改 config/default.json 的 baseUrl 与 selectors，再正式跑号。",
    );
  }

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

  log.info(`完成：成功/演练 ${ok}，失败 ${failed}`);
  log.info(`结果文件: ${out}`);
  log.info(`失败清单: ${path.join(config.paths.outputDir, "failed-latest.csv")}`);
}

main().catch((error) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
