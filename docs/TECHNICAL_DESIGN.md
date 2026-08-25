# 今日待办：技术设计

| 项目 | 内容 |
| --- | --- |
| 版本 | 1.2 |
| 状态 | 已确认，含部署路径修订与周报 MVP 草案 |
| 确认日期 | 2026-07-31 |
| 修订日期 | 2026-08-25 |
| 前端 | 微信原生小程序 + TypeScript |
| 后端 | 自建 Node.js HTTP 服务（systemd） |
| 数据库 | PostgreSQL |

周报 AI MVP 的产品门控与验收以 [`WEEKLY_REVIEW_MVP.md`](./WEEKLY_REVIEW_MVP.md) 为准；本章补充数据、接口与适配边界。

## 1. 设计目标

本设计将《今日待办》产品需求转换为可实施的技术约束，重点保证：

- 用户数据隔离。
- 重复任务生成正确且幂等。
- 提醒尽力准时发送且避免重复骚扰。
- 无网络时不产生伪成功修改。
- 注销后立即撤销访问，并在 7 天内删除业务数据。
- 初期云资源保持低固定成本和低运维负担。
- 周报生成以模型 API 为主路径，配置缺失时可降级，且遵守周日 19:00（上海）AI 门控。

## 2. 平台事实与风险

### 2.1 微信登录

小程序调用 `wx.login` 获取一次性临时凭证，服务端调用微信 `code2Session` 换取 `openid` 和 `session_key`。`session_key` 只在服务端使用，不返回客户端。

参考：[微信小程序登录](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)

### 2.2 订阅消息

- `wx.requestSubscribeMessage` 必须由用户点击等主动行为触发。
- 一次调用最多传入 5 个标题不同的模板 ID；本产品只使用一个待办提醒模板。
- 一次性订阅消息不能被当作永久推送能力。
- 用户选择“总是保持以上选择”后，后续调用可能不再弹窗，但产品仍必须在合适的用户动作中调用授权接口。
- 微信侧的有效发送机会是最终事实来源，服务端记录仅用于尽力估算。

参考：

- [订阅消息开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html)
- [`wx.requestSubscribeMessage`](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html)

### 2.3 网络域名

- 小程序只能请求已在后台配置的通信域名。
- 请求域名必须使用 HTTPS，不能使用 IP 地址或 `localhost`。
- 域名必须完成 ICP 备案。
- 生产环境使用已备案 HTTPS 域名，经 nginx 反代到本机 Node 服务。
- 不要将 IP 或 `localhost` 配置为微信合法请求域名。

参考：

- [微信小程序网络](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)

### 2.4 地点接口

`wx.chooseLocation` 需要 `scope.userLocation`，并需要在小程序后台申请接口权限。微信只向与地理位置强相关的场景开放该接口。

产品采用可降级设计：

- 申请通过：提供地图选点和手动地点。
- 申请失败：仅提供手动地点，不阻塞上线。

参考：[`wx.chooseLocation`](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.chooseLocation.html)

### 2.5 定时调度

提醒扫描由后端进程内每分钟定时器执行；维护任务每小时执行一次，并在进程启动时立即跑一轮。业务日历固定为 `Asia/Shanghai`。

## 3. 总体架构

```text
微信原生小程序
       │ HTTPS
       ▼
todo.<已备案域名>
       │
nginx（TLS 终止）
       │
Node.js HTTP 服务（ApiService + Schedulers）
       │
       ├── PostgreSQL：业务数据和调度数据
       └── 微信开放接口（code2Session / 订阅消息）
```

### 3.1 明确采用

| 能力 | 选择 |
| --- | --- |
| API 接入 | 自建 Node.js HTTP + nginx 自定义域名 |
| 服务端语言 | TypeScript |
| 数据存储 | PostgreSQL |
| 提醒调度 | 进程内每分钟扫描 |
| 重复实例 | 滚动物化未来 60 天 |
| 日志 | 先结构化到标准输出，后续可接入集中日志 |
| 密钥 | 服务器环境变量 / 受控密钥文件，不入库不入仓 |
| 会话 | 服务端可撤销会话 |
| 环境 | `dev`、`staging`、`prod` 独立数据库与配置 |

### 3.2 首版不采用

- 阿里云函数计算 HTTP / 定时触发器。
- Tablestore。
- API 网关。
- Redis。
- 消息队列。
- OSS。
- RDS 之外的第二套业务库。

后续若流量或运维模式变化，可重新评估 Serverless 与托管数据库方案。

## 4. 代码组织

推荐单仓库结构：

```text
miniprogram/
packages/
  contracts/
  domain/
  backend/
deploy/
tests/
docs/
```

模块职责：

- `miniprogram`：页面、组件、客户端状态、请求和缓存（含离线写回）。
- `contracts`：请求、响应、领域类型和错误码的单一事实来源。
- `domain`：状态迁移、重复规则、时间计算和配额规则等纯函数。
- `backend`：HTTP 适配、API 用例、PostgreSQL 仓储、微信客户端和调度器。
- `deploy`：systemd 与 nginx 样例配置。

领域层不得依赖微信或云 SDK。所有更新返回新对象，不原地修改共享状态。

## 5. 数据模型

所有业务时间戳使用 UTC epoch milliseconds 存储；面向用户的日历计算固定使用 `Asia/Shanghai`。

### 5.1 `users`

主键：

- `userId`。

主要字段：

- 加密或受保护的 `openid`。
- `status`：`ACTIVE`、`DELETION_PENDING`、`DELETED`。
- `deletionRequestedAt`。
- `purgeAfterAt`。
- 用户偏好。
- 创建和更新时间。

### 5.2 `sessions`

主键：

- `tokenHash`。

主要字段：

- `userId`。
- `expiresAt`。
- 设备信息摘要。
- 创建时间。
- 最后使用时间。

客户端只保存随机 Token，服务端只保存 Token 哈希。注销时立即删除该用户全部会话。

### 5.3 `tasks`

主键：

- `userId`。
- `taskId`。

主要字段：

- `title`。
- `notes`。
- `dueAt`。
- `dueHasTime`。
- `priority`：`HIGH`、`MEDIUM`、`LOW`。
- `status`：`TODO`、`DONE`、`TRASHED`。
- `listId`。
- `tagIds`。
- `location`。
- `seriesId`。
- `occurrenceDate`。
- `remindAt`。
- `version`。
- 创建、更新、完成、回收站和清理时间。

### 5.4 `series`

主键：

- `userId`。
- `seriesId`。

主要字段：

- `frequency`：`DAILY`、`WEEKLY`、`MONTHLY`。
- `weekdays`。
- `monthDay`。
- `startDate`。
- `endDate`。
- `monthlyFallback`：固定为 `LAST_DAY`。
- `templateFields`。
- `materializedThrough`。
- `status`：`ACTIVE`、`ENDED`。
- `version`。

### 5.5 `lists`

主键：

- `userId`。
- `listId`。

主要字段：

- `name`。
- `isInbox`。
- 创建和更新时间。

### 5.6 `tags`

主键：

- `userId`。
- `tagId`。

主要字段：

- `name`。
- `color`。
- 创建和更新时间。

### 5.7 `reminders`

主键：

- `shard`。
- `fireMinute`。
- `reminderId`。

主要字段：

- `userId`。
- `taskId`。
- `taskVersion`。
- `templateId`。
- `state`。
- `claimToken`。
- `claimedAt`。
- `messageId`。
- `lastErrorCode`。
- 创建和更新时间。

提醒查询必须通过主键时间范围完成，不依赖近实时的搜索索引。

### 5.8 `idempotency`

| 字段 | 说明 |
| --- | --- |
| `user_id` | 用户 |
| `scope` | 方法 + 路径 + requestId |
| `response` | 已成功响应快照 |
| `expire_at` | 过期时间 |

主键亦可理解为 `(userId, requestId)` 作用域。写接口使用客户端生成的请求 ID，防止网络重试导致重复创建。幂等窗口建议 24 小时。

### 5.9 `weekly_reviews`

周报 AI MVP 落库。产品门控见 [`WEEKLY_REVIEW_MVP.md`](./WEEKLY_REVIEW_MVP.md)。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `user_id` | 用户 |
| `week_start` | 该周周一 `YYYY-MM-DD`（上海） |
| `status` | `ready` / `failed` |
| `source` | `model` / `rules` |
| `stats` | JSON：完成/未完成/逾期/高优率/最忙日等 |
| `summary` | 摘要文本 |
| `improvements` | JSON 数组（type、severity、title、rationale、suggestion、taskIds） |
| `highlights` | JSON 数组 |
| `model` | 模型名，可空 |
| `error_code` | 失败时可选 |
| `created_at` / `updated_at` | 时间 |

唯一约束：`(user_id, week_start)`。重新生成覆盖。随账号注销删除。

### 5.10 搜索索引

任务搜索索引用于用户界面查询：

- 用户。
- 状态。
- 截止时间。
- 清单。
- 标签。
- 优先级。
- 更新时间。

搜索索引可能存在短暂同步延迟，因此不能用于提醒调度、幂等判断或权限判断。首版亦可使用 PostgreSQL 应用层过滤，不阻塞周报 MVP。

## 6. 状态机

### 6.1 待办

```text
TODO ⇄ DONE
 │       │
 └──→ TRASHED ──→ 永久删除
```

- `DONE` 恢复到 `TODO`。
- 进入回收站时记录原状态，以便恢复。
- 进入回收站时取消待发送提醒。
- 从回收站恢复后，如提醒时间仍在未来且仍有有效授权，可重建提醒。
- 逾期是 `TODO` 且截止时间早于当前时间的派生状态。

### 6.2 重复系列

```text
ACTIVE ──→ ENDED
```

- 到达结束日期后进入 `ENDED`。
- “仅本次”只修改任务实例。
- “本次及以后”截断旧系列，并创建继承新设置的系列。
- 历史实例不被修改。

### 6.3 提醒

```text
SCHEDULED
  └──→ SENDING
         ├──→ ACCEPTED ──→ DELIVERED
         ├──→ FAILED
         ├──→ SKIPPED
         └──→ UNKNOWN
```

- 发送前使用条件更新从 `SCHEDULED` 认领为 `SENDING`。
- 任务已完成、删除、改期或无授权时进入 `SKIPPED`。
- 微信同步接受后记录消息 ID 和 `ACCEPTED`。
- 微信异步结果事件将其更新为 `DELIVERED` 或 `FAILED`。
- 网络超时等无法判断微信是否接受的情况进入 `UNKNOWN`，不自动重发，避免重复提醒。

### 6.4 用户

```text
ACTIVE ──→ DELETION_PENDING ──→ DELETED
```

- 发起注销后立即撤销全部会话。
- `DELETION_PENDING` 状态不可继续访问业务数据。
- 维护任务在 7 天内物理删除用户业务数据。

## 7. 重复任务生成

### 7.1 物化策略

- 系统至少提前生成未来 60 天实例。
- 每日维护任务继续向前滚动物化。
- 查询发现物化水位不足时，可以触发该系列的幂等补齐。
- 生成逻辑不读取上一实例的完成状态。

### 7.2 确定性幂等键

重复实例 ID 由 `seriesId + occurrenceDate` 确定，或为该组合建立唯一条件写。

同一周期的重复生成请求：

- 第一次成功创建。
- 后续请求检测到实例已存在并视为成功。
- 不生成重复实例。

### 7.3 日期规则

- 每日：按本地日历日递增。
- 每周：按用户选择的星期生成。
- 每月：按用户选择的日期生成。
- 当月不存在指定日期时，使用当月最后一天。
- 日历日期使用 `Asia/Shanghai` 计算。

## 8. 提醒调度

### 8.1 每分钟流程

1. 读取上次成功扫描水位。
2. 扫描当前分钟及最多前 5 分钟的未处理提醒。
3. 对候选提醒进行条件认领。
4. 回查任务当前状态和版本。
5. 检查服务端记录的订阅机会。
6. 调用微信订阅消息发送接口。
7. 记录同步返回结果。
8. 通过微信事件回调更新最终发送结果。
9. 更新扫描水位。

每次扫描使用多个固定分片，避免所有提醒写入同一热点分区。

### 8.2 提醒时间

- `remindAt = dueAt - 10 分钟`。
- 定时触发器每分钟执行，实际允许在截止前约 9～10 分钟发送。
- 距离截止不足 10 分钟时不创建提醒。

### 8.3 授权记录

客户端只有在用户主动点击保存或补充提醒授权时调用微信订阅接口。

服务端记录：

- 模板 ID。
- 用户接受事件。
- 已消耗次数。
- 微信发送错误。

本地记录不是微信真实额度的权威来源。微信返回无有效订阅等错误时，服务端必须停止继续尝试，并引导用户重新授权。

### 8.4 `access_token`

- 函数实例内短期缓存微信 `access_token`。
- 多进程部署时，可接受短暂重复刷新；后续如有需要再引入共享缓存。
- 提前于过期时间刷新。

## 9. API 契约

统一前缀：`/v1`。

统一响应：

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {}
}
```

失败响应：

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "待办不存在或已删除"
  },
  "meta": {}
}
```

### 9.1 认证

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/v1/auth/login` | 微信静默登录 |
| `POST` | `/v1/auth/refresh` | 轮换会话凭证 |
| `POST` | `/v1/auth/logout` | 撤销当前会话 |

### 9.2 待办

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/v1/tasks` | 分页查询和筛选 |
| `POST` | `/v1/tasks` | 创建单次或重复待办 |
| `GET` | `/v1/tasks/{taskId}` | 查看详情 |
| `PATCH` | `/v1/tasks/{taskId}` | 编辑待办 |
| `POST` | `/v1/tasks/{taskId}/complete` | 完成 |
| `POST` | `/v1/tasks/{taskId}/uncomplete` | 撤销完成 |
| `DELETE` | `/v1/tasks/{taskId}` | 移入回收站 |

`GET /v1/tasks` 使用游标分页：`query.limit` 默认 50、上限 100；响应 `meta.cursor` 为下一页游标（keyset，排序键为 `dueAt → 优先级 → createdAt → id`），`meta.hasMore` 表示是否还有更多，末页不返回 `cursor`。可选 `query.dueOn=YYYY-MM-DD`（Asia/Shanghai）只返回该日安排：匹配 `occurrenceDate` 或 `dueAt` 落在该日的任务；无日期任务仅在 `dueOn` 等于当天时返回。按日查询包含已完成项，仍排除回收站。

微信 `wx.request` 不支持 `PATCH` 方法，编辑请求由前端以 `POST` + `X-HTTP-Method-Override: PATCH` 头发送；后端在 HTTP 边界还原为 PATCH 语义，路由和幂等键均按 PATCH 处理。

### 9.3 回收站

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/v1/trash` | 查询回收站 |
| `POST` | `/v1/trash/{taskId}/restore` | 恢复 |
| `DELETE` | `/v1/trash/{taskId}` | 永久删除 |
| `DELETE` | `/v1/trash` | 清空回收站 |

### 9.4 重复系列

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/v1/series/{seriesId}` | 查询系列 |
| `PATCH` | `/v1/series/{seriesId}` | 编辑本次或本次及以后 |
| `DELETE` | `/v1/series/{seriesId}` | 删除本次或本次及以后 |

### 9.5 清单和标签

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET/POST/PATCH/DELETE` | `/v1/lists` | 清单管理 |
| `GET/POST/PATCH/DELETE` | `/v1/tags` | 标签管理 |

### 9.6 同步、提醒和账号

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/v1/sync` | 增量同步 |
| `POST` | `/v1/reminder-grants` | 记录订阅授权结果 |
| `GET` | `/v1/reminder-status` | 查询提醒可用状态 |
| `POST` | `/v1/account/deletion` | 发起注销 |
| `POST` | `/v1/wechat/events` | 接收微信事件 |
| `GET` | `/v1/health` | 存活检查 |

### 9.7 本周回顾（周报 AI）

完整门控与字段口径见 [`WEEKLY_REVIEW_MVP.md`](./WEEKLY_REVIEW_MVP.md)。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/v1/weekly-reviews/current` | 按默认落点返回周标识、`aiAllowed`、统计；若已有 review 一并返回 |
| `GET` | `/v1/weekly-reviews` | `weekStart=YYYY-MM-DD` 查询指定周 |
| `POST` | `/v1/weekly-reviews/generate` | body `{ weekStart }`；仅 `aiAllowed` 时允许；主路径调 LLM，否则规则降级 |

业务错误码示例：`WEEKLY_REVIEW_AI_NOT_AVAILABLE`、`WEEKLY_REVIEW_RATE_LIMITED`、`WEEKLY_REVIEW_EMPTY`。

LLM 适配：HTTP 客户端面向 OpenAI 兼容 `chat/completions`；配置 `LLM_API_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`。无 Key 时不发起外呼。响应须 JSON Schema 校验；`taskIds` 必须属于该周事实集。日志记录用量与结果，不落完整备注明文。

所有资源接口必须从已验证会话获取 `userId`，不能信任请求体或查询参数中的用户 ID。

所有写接口接受 `X-Request-Id`。编辑接口携带 `version`，版本冲突返回 `409`。

## 10. 客户端架构

### 10.1 请求层

- 统一封装 `wx.request`。
- 默认超时短于微信 60 秒默认值。
- 明确判断 HTTP 状态码；不能把进入 `success` 回调视为业务成功。
- 401 时只允许一次并发共享的重新登录。
- 自动附加会话 Token、请求 ID 和客户端版本。
- 只对安全的读取请求自动重试。

### 10.2 状态管理

使用轻量不可变 Store，不在首版引入大型状态管理依赖。

Store 分为：

- 会话。
- 待办。
- 清单和标签。
- 网络状态。
- 同步状态。

### 10.3 离线缓存与写回

- 缓存任务、清单和标签的最近同步结果。
- 缓存键按用户隔离。
- 缓存包含 schema 版本。
- schema 不兼容时清空并重新同步。
- 离线时设置 `isStale`，写操作进入待同步队列并显示待同步数量，网络恢复后回放。
- 注销时清空该用户全部本地缓存和凭证。

## 11. 安全与隐私

### 11.1 数据隔离

- 仓储接口的第一个参数必须是 `userId`。
- 所有业务表以 `user_id` 作为必要查询条件或复合主键组成部分。
- 每个资源接口都必须有跨用户访问测试。

### 11.2 输入校验

在 HTTP 边界使用 schema 验证：

- 字符串长度。
- 清单、标签数量。
- 日期和时间格式。
- 经纬度范围。
- 分页上限。
- 枚举值。
- 资源归属关系。

校验失败返回字段级用户提示，不返回内部异常栈。

### 11.3 密钥

- 微信 AppSecret 存放在服务器受控环境变量或密钥文件中。
- 仓库和客户端中不得出现 AppSecret、数据库口令或会话明文。
- 日志不得输出 Token、`openid`、`session_key` 或密钥。

### 11.4 日志脱敏

允许记录：

- 请求 ID。
- 路由。
- 耗时。
- 错误码。
- 哈希后的用户标识。
- 字段是否存在及长度。

禁止记录：

- 标题。
- 备注。
- 地点名称和地址。
- 标签、清单名称。
- 微信原始用户标识。

### 11.5 限流

- 登录接口按来源和设备摘要限流。
- 写接口按用户限流。
- 超出限制返回 `429` 和用户友好的提示。
- 发现持续滥用后再评估网关或 WAF，不在首版提前引入。

## 12. 可观测性

结构化日志字段：

- 时间。
- 级别。
- 请求 ID。
- 跟踪 ID。
- 哈希用户 ID。
- 路由或任务名。
- 耗时。
- 结果码。

核心指标：

- API P50、P95、P99 延迟。
- 4xx 和 5xx 比例。
- PostgreSQL 错误和连接池耗尽。
- 提醒调度延迟。
- 提醒接受、送达、失败和跳过数量。
- 重复实例生成数量和失败数量。
- 回收站清理数量。
- 注销清理数量。

必要告警：

- 提醒扫描水位连续停滞。
- 5xx 比例异常。
- 提醒调度延迟异常。
- 微信 `access_token` 获取失败。
- 每日维护任务未完成。
- PostgreSQL 连接或磁盘异常。

## 13. 环境与部署

环境：

- `dev`：开发和自动化集成测试。
- `staging`：体验版和真机验收。
- `prod`：正式版。

每个环境使用独立的：

- 服务器或进程配置。
- PostgreSQL 数据库。
- 环境变量与微信凭据。
- 域名或路由。

部署要求：

- 使用 `deploy/today-todo.service` 与 `deploy/nginx-today-todo.conf` 作为基线。
- 禁止把生产密钥提交到仓库。
- 服务应可快速回滚到上一构建产物。
- 小程序体验版通过开发者工具或 `miniprogram-ci` 上传。

## 14. 测试策略

### 14.1 单元测试

重点纯函数：

- 重复日期展开。
- 月末和闰年。
- 状态迁移。
- 排序。
- 提醒时间。
- 回收站到期。

目标：

- 整体覆盖率不低于 80%。
- 重复和提醒模块分支覆盖率不低于 90%。

### 14.2 集成测试

- 登录和会话轮换。
- PostgreSQL 仓储。
- 写接口幂等。
- 乐观锁冲突。
- 所有资源的跨用户越权。
- 提醒认领和状态迁移。
- 重复实例补齐。
- 回收站和注销清理。

### 14.3 小程序端测试

- 页面加载、空、错误和离线状态。
- 创建、编辑、完成和删除。
- 清单、标签和筛选。
- 重复规则表单。
- 本地缓存 schema 升级。

### 14.4 真机测试

- 微信登录。
- 订阅授权接受和拒绝。
- 实际提醒送达。
- 地点权限接受和拒绝。
- 地点接口申请失败后的手动降级。
- 弱网和断网。
- 系统字体放大。
- 注销后的本地和云端数据状态。

## 15. 上线门禁

- 域名备案完成。
- HTTPS 证书有效。
- 域名已配置为微信合法请求域名。
- 小程序服务类目确认。
- 订阅消息模板审核通过。
- 地点接口申请有结论，并完成对应分支验收。
- 隐私保护指引与实际采集行为一致。
- 用户协议和隐私政策可访问。
- 所有测试和覆盖率门槛通过。
- 安全审查无 CRITICAL 或 HIGH 问题。
- 生产告警经过触发演练。
- 数据清理任务先以安全模式验证。
- 服务端和小程序均有回滚路径。

## 16. 固定架构决策

| 编号 | 决策 |
| --- | --- |
| ADR-001 | 使用微信原生小程序和 TypeScript |
| ADR-002 | 使用函数计算 HTTP 触发器和自定义域名（已被 ADR-011 取代） |
| ADR-003 | 使用 Tablestore，不使用关系型数据库（已被 ADR-011 取代） |
| ADR-004 | 使用可撤销的服务端会话 |
| ADR-005 | 重复实例滚动物化未来 60 天 |
| ADR-006 | 提醒采用每分钟扫描，接受约 9～10 分钟精度 |
| ADR-007 | 提醒优先避免重复发送，未知结果不自动重发 |
| ADR-008 | 地图选点可降级为手动地点 |
| ADR-009 | 离线可读取缓存，写操作排队并在网络恢复后回放 |
| ADR-010 | 业务时区固定为 `Asia/Shanghai` |
| ADR-011 | 部署路径修订为自建 Node.js + PostgreSQL + nginx HTTPS |
| ADR-012 | 周报 AI：自然周；周日 19:00 起可对本周调模型；主路径 OpenAI 兼容 API；无 Key/失败降级规则；备注送模；推送 Phase 2 |
