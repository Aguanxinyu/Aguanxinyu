# 今日待办

微信原生 TypeScript 待办小程序。当前可部署路径为：自建 Node.js HTTP 服务 +
PostgreSQL + nginx HTTPS，再由微信合法请求域名接入。产品与交互约定见
[`docs/`](./docs/)。

## 当前开发状态

本分支已具备本地验证与自建机部署雏形：

- 任务状态、分组、重复、提醒、回收站和输入校验领域规则。
- 登录、任务、清单、标签、账号注销、重复实例和提醒调度。
- 任务编辑（`PATCH` 乐观锁冲突返回 `409`）、`GET /v1/tasks` 游标分页。
- PostgreSQL 适配器、SQL 迁移、systemd / nginx 部署样例。
- 微信 `code2Session` 与订阅消息发送客户端。
- 微信原生 TypeScript 页面、乐观更新、本地缓存和离线变更回放。

仍建议上线前补齐：

- 限流、结构化日志与告警。
- 生产环境密钥托管与非 root 运行。
- 在配置了 `PG_TEST_DATABASE_URL` 的环境中跑通 Postgres 集成测试。
- 真机验收登录、提醒送达与弱网回放。

`MemoryDatabase` 只用于本地行为验证。生产运行使用 `PostgresDatabase`。

早期文档中的函数计算 / Tablestore 方案已由 ADR 修订替换为当前自建部署路径，
详见 [`docs/TECHNICAL_DESIGN.md`](./docs/TECHNICAL_DESIGN.md)。

## 工程结构

```text
miniprogram/          微信原生小程序
packages/contracts/   跨层数据合约
packages/domain/      纯领域规则
packages/backend/     API、仓储、微信客户端与 HTTP 入口
deploy/               systemd 与 nginx 样例
tests/                客户端、集成与系统级流程测试
docs/                 产品与技术文档
```

## 本地验证

要求 Node.js 20 或更新版本。

```bash
npm install
npm run check
```

`npm run check` 依次执行严格类型检查、lint、格式检查和覆盖率测试。

可选 Postgres 集成测试：

```bash
export PG_TEST_DATABASE_URL=postgres://todo:CHANGE_ME@127.0.0.1:5432/todaytodo_test
npm run db:migrate
npm test -- tests/integration/postgres-database.test.ts
```

本地启动后端：

```bash
cp .env.example .env
# 填写 DATABASE_URL、WECHAT_APP_ID、WECHAT_APP_SECRET、模板配置
npm run db:migrate
npm start
```

健康检查：`GET http://127.0.0.1:8080/healthz`

## 小程序配置

使用微信开发者工具打开 `miniprogram/`。当前 `project.config.json` 使用正式
AppId；后端地址与订阅消息模板 ID 写在 `miniprogram/config.ts`：

```ts
const API_BASE_URL = 'https://todo.guanxinyu.com';
const REMINDER_TEMPLATE_ID = 'your-template-id';
```

`API_BASE_URL` 必须是已备案并配置为微信**合法请求域名**的 HTTPS 地址。
AppSecret 与数据库凭据不得写入小程序或仓库。

## 部署样例

- `deploy/today-todo.service`：systemd 托管 Node 进程。
- `deploy/nginx-today-todo.conf`：TLS 终止并反代到 `127.0.0.1:8080`。

建议以非 root 用户运行服务，并单独管理证书与 `.env`。

## 依赖安全

根工作区通过 `overrides` 固定 `protobufjs` 与 `nanoid` 的已修复版本，并由
`npm audit --audit-level=high` 持续验证。
