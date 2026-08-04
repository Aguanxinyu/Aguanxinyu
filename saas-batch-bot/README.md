# SaaS 多账号批量发布机器人

给运营人员用的 Playwright 批量工具：读取账号 CSV → 登录 → 勾选任务 → 下一步 → 发布 → 自动切下一个账号，并输出成功/失败结果表。

适合：**无验证码、100+ 账号** 的重复运营操作。

## 目录

```
saas-batch-bot/
├── config/default.json      # 域名、选择器、并发、等待时间
├── data/accounts.example.csv
├── data/accounts.csv        # 你自己创建（已 gitignore）
├── auth/                    # 各账号登录态（自动生成）
├── output/                  # 运行结果 CSV/JSON
└── src/                     # 脚本源码
```

## 一次性准备（研发）

```bash
cd saas-batch-bot
npm install
npx playwright install chromium
```

1. 复制账号表：

```bash
cp data/accounts.example.csv data/accounts.csv
```

2. 已按讯灵真实流程预填（默认域名 `https://v3.xunlingai.com`）：
   - 登录页：`#/sign`（需勾选协议）
   - 任务页：`#/geo/geoList/aifeeds/article`（GEO → AI备课 → 图文）
   - 流程：切换媒体 Tab → 点任务「查看发布」→ 勾选文章 → 点「xxx训练（已选N个）」

3. 常用配置（`config/default.json`）：
   - `mediaTab`：如 `第三方新闻媒体训练` / `第三方商业媒体训练`
   - `maxTasksPerAccount`：每个账号处理几个任务
   - `maxArticlesPerTask`：每个任务勾几篇文章
   - `onlyUnpublishedTasks`：只处理「已发布数量=0」的任务

## 运营日常用法

```bash
cd saas-batch-bot

# 1) 先小批量演练（只登录，不发布）
npm start -- --limit 5 --dry-run

# 2) 小批量正式跑
npm start -- --limit 10

# 3) 全量跑（accounts.csv 里 enabled=true 的账号）
npm start

# 4) 只重跑上次失败账号
npm start -- --only-failed
```

### 账号表格式（`data/accounts.csv`）

| 列 | 说明 |
|----|------|
| id | 账号唯一 ID |
| username | 登录名/邮箱 |
| password | 密码 |
| enabled | `true/false`，false 会跳过 |
| note | 备注（可选） |

### 结果文件

每次运行后看 `output/`：

- `results-latest.csv`：本次全部结果
- `failed-latest.csv`：失败账号，方便排查/重跑
- `results-*.csv`：带时间戳的历史结果

## 推荐节奏（100+ 账号）

1. 先 `--limit 5 --dry-run` 确认能登录到任务页  
2. 再 `--limit 5` 真发布，人工抽查页面结果  
3. 确认无误后全量跑  
4. 失败账号用 `--only-failed` 补跑  

默认 `concurrency=1`（串行最稳）。稳定后可在配置里改成 `2~3`，不建议一上来开很高。

## 常见调整

| 需求 | 改哪里 |
|------|--------|
| 换 SaaS 地址 | `config/default.json` → `baseUrl` |
| 勾选逻辑（按状态/关键词筛） | `src/workflow.ts` → `selectTasksAndPublish` |
| 登录字段变了 | `selectors.usernameInput` 等 |
| 账号间隔太快怕风控 | `delayBetweenAccountsMs` |
| 无头运行 | `"headless": true` 或 `HEADLESS=true` |

## 注意

- 账号密码只放本机 `data/accounts.csv`，不要提交到 Git  
- `auth/` 是登录态缓存，勿分享  
- 本仓库提供的是可改的骨架；上线前必须按真实页面改选择器并小批量验证  
