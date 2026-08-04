# 讯灵多账号批量发布机器人

CSV 驱动的 Playwright 工具：登录 → 按「点击方案」勾选任务/文章 → 发布 → 自动切号，并输出结果表。

**运维请直接看：[运维使用手册.md](./运维使用手册.md)**

## 快速开始

```bash
cd saas-batch-bot
npm install
npx playwright install chromium
cp data/accounts.example.csv data/accounts.csv
# 编辑 accounts.csv 填账号密码

npm start -- --list-schemes
npm start -- --scheme news-unpublished --limit 1 --dry-run
npm start -- --scheme news-unpublished --limit 5
```

## 点击方案（运维可配）

在 `config/default.json` 的 `schemes` 里配置，或用命令覆盖：

```bash
npm start -- --scheme business-unpublished --limit 3
npm start -- --media-tab 第三方商业媒体训练 --tasks 2 --articles 3 --dry-run
```

## 目录

```
saas-batch-bot/
├── 运维使用手册.md          # 运维操作说明（首选）
├── config/default.json      # 点击方案 + 默认参数
├── data/accounts.csv        # 账号表（本地，已 gitignore）
├── output/                  # 运行结果
└── src/                     # 源码
```
