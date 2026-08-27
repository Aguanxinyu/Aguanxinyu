# 今日待办：Web 客户端 MVP

| 项目 | 内容 |
| --- | --- |
| 版本 | 1.0 |
| 状态 | 已确认；Phase 1 实现已落地 |
| 确认日期 | 2026-08-27 |
| 依赖 | [`PRD.md`](./PRD.md)、[`TECHNICAL_DESIGN.md`](./TECHNICAL_DESIGN.md)、[`UI_SPEC.md`](./UI_SPEC.md) |
| 阶段 | Phase 1（共用后端 + Web 前端）；小程序继续并存 |

本文锁定：**浏览器可直接访问的网页版待办**；用户通过**微信扫码登录**进入，页面与操作为网页实现。后端**不重做**，在现有 Node + PostgreSQL + `ApiService` 上抽象登录通道并复用业务 API。

---

## 1. 背景与目标

当前产品以微信小程序为主客户端，后端已具备用户、会话、待办、清单、周报等能力。用户希望：

1. 打开网站即可访问（如 `https://todo.guanxinyu.com`）。
2. 用**微信扫码登录**（开放平台网站应用），不是「扫码打开小程序」。
3. 登录后在**网页里**完成待办的查看、创建、编辑、完成、按日浏览、周报等操作。

**用户价值**

- 电脑/平板浏览器也能管理同一套待办数据。
- 与小程序共用账号与数据（通过 `unionid` 打通）。
- 研发成本可控：一套 API，两套壳。

**非目标（本 MVP）**

- 不为网页单独再建业务后端或第二套业务库。
- 不做「仅落地页 + 扫码进小程序」替代本方案（可另作营销页，但不替代 Web 客户端）。
- 网页版首版不承诺完整复刻所有小程序能力（见 §4）。
- 不做团队协作、桌面原生 App、独立非微信账号体系。

---

## 2. 已确认产品 / 架构决策

| 项 | 决定 |
| --- | --- |
| 形态 | Web SPA（或等价静态前端）+ 现有 REST API |
| 登录 | 微信开放平台 **网站应用** 扫码登录 |
| 后端 | **共用**现有服务；抽象多登录通道 |
| 账号打通 | 开放平台绑定同一主体；用 **`unionid`** 关联小程序用户与网页用户 |
| 会话 | 继续使用服务端可撤销 session token（与小程序同模型） |
| 部署 | 同域或子路径：nginx 静态站点 + `/v1` 反代现有 Node |
| UI | 延续纸感底色、宋体品牌、青绿强调；布局按桌面/宽屏优化，移动浏览器可用 |

---

## 3. 目标架构

```text
┌──────────────────┐          ┌──────────────────┐
│ 微信原生小程序    │          │ Web（浏览器）      │
│ wx.login 静默登录 │          │ 网站应用扫码登录   │
└────────┬─────────┘          └────────┬─────────┘
         │                             │
         │  POST /v1/auth/*            │
         └──────────────┬──────────────┘
                        ▼
              Auth 通道抽象（miniprogram | web）
                        ▼
                 统一 users + sessions
                        ▼
              现有 ApiService 业务路由
           tasks / lists / trash / weekly-reviews …
                        ▼
                   PostgreSQL
```

**原则**

- 业务规则、校验、周报、调度仍在服务端一处。
- 客户端差异尽量停在：登录 SDK、UI 壳、部分能力降级文案。
- 禁止复制一套「网站专用 TodoService」。

---

## 4. Web MVP 功能范围

### 4.1 包含

- 未登录：品牌页 +「微信扫码登录」。
- 登录成功：进入待办主界面（网页）。
- 待办：列表、按日切换（日历条/月历，对齐小程序口径）、快速创建、完成/撤销完成、编辑、移入回收站。
- 清单：查看、创建、删除（对齐现有 API）。
- 我的：同步、回收站入口、本周回顾入口、注销。
- 本周回顾：复用现有周报 API 与门控（周日 19:00 等）。
- 登出：撤销当前会话。

### 4.2 降级或不做（首版）

| 能力 | Web MVP 处理 |
| --- | --- |
| 微信订阅消息提醒 | 不做网页订阅；设置页提示「请在小程序开启提醒」 |
| 地图选点 | 仅手动地点文本；或隐藏地图选点 |
| 小程序胶囊/Tab 原生体验 | 用网页导航替代 |
| 离线写回队列 | 首版可仅在线；或后续再对齐 |
| 深色模式 | 不做 |

### 4.3 信息架构（网页）

- 顶栏或侧栏：待办 / 清单 / 我的（等价小程序 Tab）。
- 子页：任务编辑、回收站、本周回顾、登录。

视觉令牌与小程序一致方向；具体布局在实现前可补 `UI_SPEC` 网页小节，或实现时以本文 + 现有 `UI_SPEC` 令牌为准。

---

## 5. 微信登录（网站应用）

### 5.1 外部依赖

- 微信开放平台账号，主体与小程序一致或已绑定。
- 创建**网站应用**，获得 `WEB_APP_ID` / `WEB_APP_SECRET`。
- 授权回调域：如 `todo.guanxinyu.com`（以开放平台配置为准）。
- 小程序与网站应用绑定后，同一用户可得稳定 **`unionid`**。

### 5.2 推荐前端流程（MVP）

1. 用户打开 `/login`。
2. 前端展示微信扫码（开放平台 JS / 跳转 `open.weixin.qq.com/connect/qrconnect`，二选一，实现时定一种）。
3. 用户扫码确认后，回调带回 `code`（或前端拿到 `code`）。
4. 前端 `POST /v1/auth/login`（或 `/v1/auth/web-login`），body 带 `channel: "web"` + `code`。
5. 后端换票、落用户、返回与小程序相同形态的 `{ token, userId }`。
6. Web 将 token 存 `localStorage`（或 HttpOnly Cookie；MVP 可用 localStorage + Authorization 头，与现小程序存储策略对齐精神）。

### 5.3 后端换票（概念）

- **miniprogram**：现有 `jscode2session` → `openid`（+ 若有 `unionid`）。
- **web**：网站应用 OAuth `code` → `access_token` + `openid` + **`unionid`**。

统一输出内部身份：

```text
{ channel, mpOpenId?, webOpenId?, unionId? }
```

再进入「找用户 / 建用户 / 发 session」共用逻辑。

---

## 6. 用户模型变更（关键）

现有 `users` 仅有 `open_id`（实为小程序 openid），不足以同时服务网站应用。

### 6.1 建议字段

| 字段 | 说明 |
| --- | --- |
| `id` | 不变 |
| `union_id` | 可空；有则唯一；打通双端的主键纽带 |
| `mp_open_id` | 小程序 openid；可空；唯一（若有） |
| `web_open_id` | 网站应用 openid；可空；唯一（若有） |
| `status` / 注销字段 / 时间戳 | 不变 |

迁移策略：

1. 将现有 `open_id` **重命名或复制为** `mp_open_id`（兼容已有数据）。
2. 新登录写入对应通道 openid；若微信返回 `unionid` 则写入/合并。
3. **合并规则（MVP）**：
   - 若 `union_id` 已存在用户 → 绑定本通道 openid 到该用户。
   - 若仅通道 openid 命中 → 使用该用户；补写 `union_id`（若本次有）。
   - 若皆无 → 新建用户。
   - 若通道 openid 与 `union_id` 指向不同用户 → 返回明确错误，人工/后续再做合并工具（MVP 不自动硬合并冲突）。

### 6.2 会话

`sessions` 表可不变；token 不区分端，或可选增加 `client: web|mp` 便于审计（非必须）。

---

## 7. API 变更草案

### 7.1 登录

**推荐**：扩展现有登录，避免两套会话语义。

`POST /v1/auth/login`

```json
{
  "channel": "miniprogram" | "web",
  "code": "..."
}
```

- 缺省 `channel` 时视为 `miniprogram`（兼容现网小程序）。
- `web` 走网站应用换票；失败返回可理解错误码（如 `WECHAT_WEB_LOGIN_FAILED`）。

响应保持：`{ token, userId }`。

### 7.2 业务 API

`/v1/tasks`、`/v1/lists`、`/v1/trash`、`/v1/weekly-reviews*`、注销等 **保持不变**；Web 直接调用。

### 7.3 跨域与安全

- 若 Web 与 API **同域**（nginx `/` 静态、`/v1` 反代）：可无 CORS。
- 若前后端分离跨域：显式 CORS 白名单 + 禁止 `*` + 凭证策略与 token 存放一致。
- 所有写接口继续要求 `X-Request-Id`；编辑继续带 `version`。

### 7.4 代码抽象（后端）

建议从当前 `exchangeLoginCode: (code) => openId` 升级为：

```text
resolveWeChatIdentity(input: { channel, code })
  → { mpOpenId?, webOpenId?, unionId? }
```

`ApiService.login` 只依赖该抽象；`wechat.ts` 内部分 `miniprogramExchange` / `webExchange`。测试可用 fake provider。

---

## 8. Web 前端工程建议

| 项 | MVP 建议 |
| --- | --- |
| 位置 | 单仓新增 `web/`（或 `apps/web`） |
| 技术 | TypeScript + 现代 SPA（实现时选定；优先团队熟悉栈） |
| API 客户端 | 对齐小程序 `services/api.ts` 的路径与错误码，可抽 `packages/api-client`（可第二步再抽） |
| 路由 | `/login`、`/` 待办、`/lists`、`/me`、编辑/回收站/周报子路由 |
| 构建产物 | 静态文件，由 nginx `root` 托管 |

不强制与小程序共一份 WXML；**共的是 API 与设计令牌**，不是视图层。

---

## 9. nginx 部署草案

```text
https://todo.guanxinyu.com/
  location /v1/     → Node :8080
  location /health  → Node（若需要）
  location /        → web 静态资源（SPA try_files）
```

TLS、域名保持现有证书策略。环境变量新增：`WECHAT_WEB_APP_ID`、`WECHAT_WEB_APP_SECRET`（名称实现时可微调）。

---

## 10. 与小程序并存策略

- 小程序继续为移动端主入口；提醒能力仍以小程序为准。
- 网页为桌面/浏览器入口；数据通过 `unionid` 打通后应看到同一待办。
- 验收必须包含：**先小程序产生数据 → 网页扫码登录可见；反之亦然**（在 unionid 可用的前提下）。

若开放平台尚未绑定、暂无 `unionid`：MVP 可先上线网页独立用户，但文档与产品需明确「暂不与小程序互通」，并尽快完成绑定。默认目标是 **互通**。

---

## 11. Phase 划分

### Phase 1（本文 MVP）

- 本文定稿。
- 用户表迁移（`union_id` / 双 openid）+ 登录通道抽象 + web 登录 API。
- Web：登录页 + 待办核心 + 清单 + 我的 + 回收站 + 周报只读/生成（对齐现 API）。
- nginx 静态托管 + 同域 API。
- 自动化测试：web 登录通道、用户合并规则、CORS/同域冒烟。

### Phase 2

- 抽共享 `api-client`。
- 网页体验细化（响应式、键盘快捷创建等）。
- 与小程序提醒设置的引导打通。
- 登录态 Cookie 化 / CSRF 若改为 Cookie。

### 明确不做进 MVP

- 网站扫码仅打开小程序的替代方案当作本需求交付。
- 第二套业务后端。
- 非微信账号（手机号/密码）。

---

## 12. 验收标准（MVP）

1. 浏览器打开站点出现登录页；微信扫码后进入网页待办首页。
2. 网页可完成：创建、完成、编辑、按日查看、进回收站恢复（或等价现有能力子集）。
3. 同一 `unionid` 用户：小程序与网页看到同一任务数据。
4. 未配置网站应用密钥时，web 登录失败有明确提示；小程序登录不受影响。
5. 注销后网页与小程序会话均不可再访问该用户业务数据（与现注销语义一致）。
6. 无第二套 Todo 业务服务进程；仅现有 Node + 静态 Web。

---

## 13. 测试要点

- 单元：身份合并（仅 mp / 仅 web / 双侧 + unionid / 冲突）。
- 集成：`channel=web` 登录成功发 token；`channel=miniprogram` 回归。
- 契约：旧小程序只传 `code` 仍可登录。
- 端到端（可人工）：扫码 → 列表 → 创建 → 小程序端可见。

---

## 14. 开放实现细节（不阻塞定稿）

- 扫码 UI：内嵌微信 JS 还是跳转二维码页。
- SPA 框架选型（React / Vue / 其他）。
- token 存 localStorage 还是 Cookie（MVP 默认可 localStorage + Bearer）。
- `open_id` 列是 rename 还是双写过渡期。

---

## 15. 文档关系

| 文档 | 本特性相关更新 |
| --- | --- |
| 本文 | Web 客户端 MVP 唯一完整口径 |
| `PRD.md` | 范围增加网页端；「不做 PC」修订为「不做独立桌面 App，提供 Web」 |
| `TECHNICAL_DESIGN.md` | 架构图、用户表、登录 ADR、nginx |
| `UI_SPEC.md` | 后续补网页布局专章（可与实现并行） |
| `IMPLEMENTATION_PLAN.md` | 新增 Web 客户端阶段与门禁 |
| `README.md` | 索引与决策摘要 |
