# 今日待办文档

本目录保存微信小程序“今日待办”在实施前确认的产品和技术文档。

## 文档索引

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [`PRD.md`](./PRD.md) | 产品目标、范围、规则和验收标准 | 已确认（1.1 含周报增量） |
| [`WEEKLY_REVIEW_MVP.md`](./WEEKLY_REVIEW_MVP.md) | **本周回顾（周报 AI）MVP 完整口径** | 已确认，待实现 |
| [`TECHNICAL_DESIGN.md`](./TECHNICAL_DESIGN.md) | 自建 Node + PostgreSQL 架构、数据、接口、安全和测试 | 已确认，含周报表/API 草案 |
| [`UI_SPEC.md`](./UI_SPEC.md) | 页面结构、交互、视觉令牌和状态设计 | 已确认（含回顾页） |
| [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) | 实施阶段、依赖、测试和发布门禁 | 进行中（含阶段 13） |

## 固定决策摘要

- 产品为面向个人用户的微信待办小程序。
- 前端使用微信原生框架和 TypeScript。
- 后端当前部署路径为自建 Node.js HTTP 服务、PostgreSQL、nginx HTTPS。
- UI 使用纸感底色、宋体品牌与青绿强调；待办首页含底部日历按日浏览。
- 提醒采用微信订阅消息和进程内每分钟调度。
- 重复任务生成独立实例，旧实例未完成不阻塞新实例。
- 地图选点申请失败时降级为手动地点。
- 离线可排队写操作，网络恢复后回放。
- 注销后立即撤销访问，业务数据在 7 天内删除。
- 早期确认的函数计算 / Tablestore 方案已由 ADR-011 修订。
- **周报 AI（ADR-012）**：上海自然周；周日 19:00 起可对本周调国内 OpenAI 兼容模型；备注送模；无 Key/失败降级为统计+规则；推送 Phase 2。详见 [`WEEKLY_REVIEW_MVP.md`](./WEEKLY_REVIEW_MVP.md)。

## 文档变更规则

- 产品行为变化先更新 `PRD.md`（周报细节优先更新 `WEEKLY_REVIEW_MVP.md`）。
- 架构、数据、接口或安全边界变化先更新 `TECHNICAL_DESIGN.md`。
- 页面与交互变化先更新 `UI_SPEC.md`。
- 实施顺序和门禁变化更新 `IMPLEMENTATION_PLAN.md`。
- 已确认决策若需改变，应记录原因、影响范围和新的验收标准。
- 文档中的外部平台能力仍需以实施时的微信和模型厂商官方文档为准。

## 当前状态

业务代码、小程序页面、PostgreSQL 适配器与自建部署样例已经落地。周报 AI 已完成 MVP 文档定稿，实现尚未开始。正式上线前仍需完成真机验收、限流告警与运维 hardening。
