#!/usr/bin/env node
/**
 * 零基础运维菜单：问答式选择方案并启动。
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const schemes = [
  {
    key: "1",
    name: "news-unpublished",
    title: "第三方新闻媒体（只发未发布）",
  },
  {
    key: "2",
    name: "business-unpublished",
    title: "第三方商业媒体（只发未发布）",
  },
  {
    key: "3",
    name: "news-batch-3",
    title: "第三方新闻媒体（每号最多3个任务）",
  },
  {
    key: "4",
    name: "selfmedia-unpublished",
    title: "自媒体训练（只发未发布）",
  },
  {
    key: "5",
    name: "web-unpublished",
    title: "智能体官网训练（只发未发布）",
  },
];

function runNpm(args) {
  return new Promise((resolve) => {
    const child = spawn("npm", ["start", "--", ...args], {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function ask(rl, question, fallback = "") {
  const answer = (await rl.question(question)).trim();
  return answer || fallback;
}

async function pickScheme(rl) {
  console.log("\n请选择点击方案：");
  for (const s of schemes) {
    console.log(`  ${s.key}. ${s.title}`);
  }
  const choice = await ask(rl, "输入数字（默认 1）：", "1");
  const selected = schemes.find((s) => s.key === choice) || schemes[0];
  console.log(`已选择：${selected.title}\n`);
  return selected.name;
}

async function main() {
  const rl = createInterface({ input, output });
  console.log("=================================");
  console.log("  讯灵批量发布机器人 - 运维菜单");
  console.log("=================================\n");
  console.log("请选择操作：");
  console.log("  1. 演练（最安全，不会真的发布）");
  console.log("  2. 正式发布（会真的点发布）");
  console.log("  3. 只补跑失败账号");
  console.log("  4. 查看有哪些点击方案");
  console.log("  5. 退出");

  const action = await ask(rl, "\n输入数字：", "5");

  if (action === "5" || action === "") {
    console.log("已退出。");
    rl.close();
    return;
  }

  if (action === "4") {
    rl.close();
    process.exitCode = await runNpm(["--list-schemes"]);
    return;
  }

  if (action === "3") {
    const scheme = await pickScheme(rl);
    rl.close();
    console.log("开始补跑失败账号...\n");
    process.exitCode = await runNpm(["--scheme", scheme, "--only-failed"]);
    return;
  }

  if (action !== "1" && action !== "2") {
    console.log("无效选项，已退出。");
    rl.close();
    return;
  }

  const scheme = await pickScheme(rl);
  const limitRaw = await ask(rl, "本次跑几个账号？（建议先填 1，默认 1）：", "1");
  const limit = Math.max(1, Number(limitRaw) || 1);
  const tasksRaw = await ask(rl, "每个账号处理几个任务？（直接回车用方案默认）：", "");
  const articlesRaw = await ask(
    rl,
    "每个任务勾几篇文章？（直接回车用方案默认）：",
    "",
  );

  const args = ["--scheme", scheme, "--limit", String(limit)];
  if (action === "1") args.push("--dry-run");
  if (tasksRaw) args.push("--tasks", String(Math.max(1, Number(tasksRaw) || 1)));
  if (articlesRaw) {
    args.push("--articles", String(Math.max(1, Number(articlesRaw) || 1)));
  }

  console.log("\n即将执行：");
  console.log(`  模式：${action === "1" ? "演练" : "正式发布"}`);
  console.log(`  方案：${scheme}`);
  console.log(`  账号数：${limit}`);
  if (tasksRaw) console.log(`  每号任务数：${tasksRaw}`);
  if (articlesRaw) console.log(`  每任务文章数：${articlesRaw}`);
  console.log("\n开始运行，请不要手动乱点浏览器...\n");

  rl.close();
  process.exitCode = await runNpm(args);
}

main().catch((error) => {
  console.error("菜单运行失败：", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
