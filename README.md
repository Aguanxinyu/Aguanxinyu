# 今日待办

微信原生 TypeScript 待办小程序，后端目标环境为阿里云函数计算与
Tablestore。产品、技术和交互约定见 [`docs/`](./docs/)。

## 当前开发状态

本分支完成首个可本地验证的开发切片：

- 任务状态、分组、重复、提醒、回收站和输入校验领域规则。
- 登录、任务、清单、标签、账号注销、重复实例和提醒调度的内存集成环境。
- 任务编辑（`PATCH` 乐观锁冲突返回 `409`）、`GET /v1/tasks` 游标分页、回收站即时取消待发提醒并支持恢复重建。
- 微信原生 TypeScript 页面、乐观更新、本地缓存和离线变更回放。
- 严格类型检查、ESLint、Prettier、Vitest 与覆盖率门禁。

以下内容尚未实现，因此当前代码**不能直接部署到生产环境**：

- 阿里云函数计算 HTTP/定时触发器入口。
- Tablestore 持久化、条件写、TTL 与真实并发验证。
- 微信 `code2Session`、订阅消息发送和 KMS 密钥读取。
- SLS 结构化日志、限流、告警和正式域名配置。

测试中的 `MemoryDatabase` 只用于本地行为验证，不是生产数据库。

## 工程结构

```text
miniprogram/          微信原生小程序
packages/contracts/   跨层数据合约
packages/domain/      纯领域规则
packages/backend/     API、内存仓储和调度应用层
tests/                客户端、集成与系统级流程测试
docs/                 已确认产品与技术文档
```

## 本地验证

要求 Node.js 20 或更新版本。

```bash
npm install
npm run check
```

`npm run check` 依次执行严格类型检查、lint、格式检查和覆盖率测试。

## 小程序配置

使用微信开发者工具打开 `miniprogram/`。开发工具项目当前使用
`touristappid`，接入真实账号时应改为正式 AppId。

后端地址与订阅消息模板 ID 写在 `miniprogram/config.ts`（普通小程序无
extConfig 后台入口，`wx.getExtConfigSync()` 在真机返回空，只能编译进代码）：

```ts
const API_BASE_URL = 'https://todo.guanxinyu.com';
const REMINDER_TEMPLATE_ID = 'your-template-id';
```

`apiBaseUrl` 必须使用已备案并配置为微信**合法请求域名**的 HTTPS 地址
（公众平台后台：开发 → 开发设置 → 服务器域名 → request 合法域名）。
AppSecret、阿里云访问凭据和会话签名材料不得写入小程序或仓库。

## 依赖安全

阿里云 `tablestore` SDK 当前仍声明旧版 `protobufjs`。根工作区通过
`overrides` 固定到已修复版本，并由 `npm audit --audit-level=high`
持续验证。真实 Tablestore 适配器接入时必须补充 SDK 编解码兼容测试。
