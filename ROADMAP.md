# dsh-artex 后续路线图（基线 v0.15.0）

> 目标：把 ARTEX 完整变成 DSH 插件，做到“原功能可用、原设计可看、DSH 原生体验、可安装可升级”。

## 0. 当前基线（v0.15.0）

- **原生 UI**：9 个主 Tab；Tasks/Task detail（Plan、模板、SSE、HITL Chat、Findings、报告、探索图）、Chat、Assets/Coverage、LLM、System（MCP/Tools/Skills/Agents/Notify/Logs/Workspace/Settings）、Traffic、Approvals、插件设置。
- **系统管理完整化**：任务模板、Skills zip 上传/删除、Agents config/工具绑定/triggers/visibility、Notify filter/mode/投递历史。
- **模型工具 9 个**：`artex_status`、`artex_llm`、`artex_settings`、`artex_task`、`artex_observe`、`artex_wait`、`artex_findings`、`artex_approval`、`artex_chat`。
- **完整原版 UI**：Console iframe 仍作为长尾入口；已用 `NEXT_EXPORT=1 npm run build` + `go build -tags embedui` 构建本地 ARTEX 并验证嵌入 UI 的登录页。Console 需用 ARTEX 管理员密码手动登录（插件不把 JWT 注入浏览器）。
- **真实 E2E 已验证**：ARTEX 二进制 + PostgreSQL 17 + 真实 DeepSeek 任务 + traffic capture + 证据绑定 + 报告；0.15.0 新页面在真实 DSH + 浏览器中逐页验证。
- **未验证**：Docker Compose 路径（本机无 Docker）、macOS/Linux、DSH 0.2.2-rc.5 以外版本、多用户/多实例。
- 测试 37 项；client bundle 124.0 KB。

## 0.1 0.15.0 后的剩余项

| 项 | 状态 | 说明 |
|---|---|---|
| A3 `/artex/ui` 同源挂载 | 不做（设计取舍） | ARTEX UI 使用绝对 `/api`、`/_next`；同源挂载还会让第三方 UI 获得 DSH 同源权限，比跨域 iframe 更危险。保留 iframe-first。 |
| A9 i18n | 部分 | 已做响应式；文案保持中文，避免与中文 ARTEX Console 混杂出半套英文。 |
| D1 Docker Compose E2E | 环境受限 | 本机无 Docker；compose 文件与启动路径静态检查通过。 |
| D3 跨平台 smoke | 环境受限 | 仅 Windows 实测；代码无 Windows-only 依赖，但未在 macOS/Linux 跑。 |
| Agent prompt 版本/预览/变量、wrapup prompt | 仍走 Console | 低频编辑能力，保留 Console 入口。 |
| MCP env 密钥高级编辑、skill meta/目录/单文件删除 | 仍走 Console | 低频长尾能力。 |
| 多 ARTEX 实例 | 未实现 | 当前一个 DSH profile 一个 endpoint；端口/DSH_HOME 隔离可手工多开。 |

---

## 1. UI / 设计：让“原设计”进入 DSH

| ID | 事项 | 说明 | 工作量 | 优先级 |
|---|---|---|---|---|
| A1 | `?embed=1` 嵌入模式 | ARTEX UI 隐藏自己的侧栏/头部，只保留内容区；去掉双导航 | 1–2 天 | P0 |
| A2 | 主题桥 + 自动登录 | postMessage 同步 DSH 深浅色；插件把已持有 JWT 交给 iframe，避免二次登录 | 1–2 天 | P0 |
| A3 | `/artex/ui` 同源挂载 | ARTEX 构建 `basePath=/artex/ui`、API base `/artex/api`；DSH 伺服静态文件并代理 API/SSE；彻底去跨域、混合内容、主题割裂 | 1–2 周 | P1 |
| A4 | 原生 Chat / Conversations | 完整会话列表、消息历史、附件、@提及、side questions、停止 | 3–5 天 | P1 |
| A5 | 原生 Assets / Coverage | 资产列表/CRUD、公司 scope、覆盖图、未测试资产 | 5–7 天 | P1 |
| A6 | 任务详情剩余 tabs | Overview、Broadcast、Retests、Test assets、Credentials、Coverage、Interception、Report | 3–5 天 | P1 |
| A7 | 系统管理页 | LLM profiles/pool/records、MCP、Skills、Agents、Custom tools、Notify、Intercept rules、Logs、Workspace | 2–3 周 | P2 |
| A8 | 探索图增强 | 缩放/拖拽、过滤、资产 anchor、coverage 叠加、节点跳转 | 3–5 天 | P2 |
| A9 | 响应式 / i18n | 窄面板布局、DSH locale、中文/英文词条 | 3–5 天 | P2 |

**建议**：先 A1+A2（短平快，立刻改善原设计体验）；A3 作为中期目标；A4–A6 补齐高频业务；A7 保持 Console 兜底即可。

---

## 2. 原生功能 parity

| ID | 事项 | 工作量 | 优先级 |
|---|---|---|---|
| B1 | Finding retest 工作流（复测、fixed/reproducible/cannot confirm） | 3–5 天 | P1 |
| B2 | Finding 状态/严重度/报告编辑、导出 md/zip/csv/json | 3–5 天 | P1 |
| B3 | 任务 categories / templates / archive / delete | 2–3 天 | P1 |
| B4 | Goals / constraints / scope / credentials / task intercept rules CRUD | 4–6 天 | P1 |
| B5 | LLM profiles 完整 CRUD、failover pool、retry policy、records/usage | 5–7 天 | P1 |
| B6 | MCP / Skills / Agents / Custom tools / Notifications | 2–3 周 | P2 |
| B7 | Workspace / ScopeSentry sync / Logs / Token stats | 1–2 周 | P2 |
| B8 | Setup/登录/改密 | 3–5 天 | P1 |
| B9 | Traffic 删除/purge/hosts/body blob/多条件过滤 | 2–3 天 | P2 |
| B10 | 审批批量决定、always-allow、历史/审计 | 2–3 天 | P1 |
| B11 | 报告页预览/下载/evidence 附带 | 2–3 天 | P1 |
| B12 | 浏览器扩展兼容 | 保持 `127.0.0.1:8787` 工作；同源挂载后更新 ingest 地址；文档 + token 自动配置 | 1–2 天 | P1 |
| B13 | 每任务预算 | ARTEX 预算目前是进程级 env；插件只能给默认值；任务级预算需要上游补丁 | 2–3 天 + 上游 | P1 |

---

## 3. DSH 深度集成

| ID | 事项 | 说明 | 工作量 | 优先级 |
|---|---|---|---|---|
| C1 | 审批通知 | pending approval 出现时通过 DSH 通知/事件提醒，支持一键打开审批 Tab；避免任务无声卡死 | 2–4 天 | P0 |
| C2 | 任务后台 job | `artex_wait` 转为 DSH background job，完成/失败/超时主动返回 | 2 天 | P1 |
| C3 | ARTEX SSE → DSH 事件 | 任务进度、finding、approval 进入 DSH session/context，模型可被唤醒 | 3–5 天 | P1 |
| C4 | 工具级审批门 | `artex_task_create/start` 默认走 DSH `tools/pre-execute` 或 `ctx.approval` | 1–2 天 | P0 |
| C5 | LLM 自动继承 | 从 DSH 当前 provider/model/base URL + credential 自动创建/更新 ARTEX profile | 3–4 天 | P1 |
| C6 | 插件 i18n / theme | 原生面板使用 DSH locale/theme tokens | 3–5 天 | P2 |
| C7 | MCP 桥 | 把 DSH 的 MCP server 注册进 ARTEX（双向能力互补） | 3–5 天 | P2 |
| C8 | 多实例 profile | 同时管理多个 ARTEX（不同 DB/端口），任务路由 | 1–2 周 | P2 |
| C9 | 受控 raw API | 允许高级用户调用白名单 API，默认关闭 | 2–3 天 | P2 |

---

## 4. 运行时 / 部署

| ID | 事项 | 工作量 | 优先级 |
|---|---|---|---|
| D1 | Docker Compose 真实 E2E | 2–3 天 | P0 |
| D2 | Doctor / 首次运行向导 | 检测 Docker、ARTEX dir、PG、端口、LLM、setup token，给出可执行修复 | 3–5 天 | P0 |
| D3 | 二进制分发 | 多平台构建、SHA256、SBOM、npm 包体积控制 | 3–5 天 | P1 |
| D4 | PostgreSQL 生命周期 | 内嵌/外部/Docker 三种模式、备份/恢复、迁移 | 3–5 天 | P1 |
| D5 | 升级路径 | ARTEX 版本、DB migrations、插件版本、配置 schema 兼容 | 3–5 天 | P1 |
| D6 | Windows/macOS/Linux | Windows evidence patch、PowerShell/Bash 工具链、CA 信任、路径 | 1 周 | P1 |
| D7 | 数据保留/卸载 | 明确哪些删除、哪些保留、备份说明 | 1–2 天 | P2 |
| D8 | 端口冲突/多实例 | 自动选端口、项目名、卷隔离 | 2–3 天 | P2 |

---

## 5. 安全 / 合规

| ID | 事项 | 优先级 |
|---|---|---|
| E1 | 密钥轮换/credential 管理 UI（管理员密码、LLM key、pgDsn） | P0 |
| E2 | 授权确认 + target gate + 工具审批默认开启（已部分完成） | P0 |
| E3 | 所有 ARTEX 输出统一 untrusted 包裹/截断（已做，需审计遗漏） | P0 |
| E4 | 代理/路由 token、CSRF、CORS、SSRF 审计 | P1 |
| E5 | 审批审计：谁在 DSH 里批准了什么，双份记录 | P1 |
| E6 | AGPL 合规：不打包 ARTEX 源码、插件许可证、网络使用声明 | P1 |
| E7 | 渗透测试使用条款/授权提示（README + UI） | P0 |
| E8 | Docker socket / 子进程权限最小化 | P2 |
| E9 | ARTEX API token / service account | 上游只有单管理员 JWT；长期应加服务 token/可吊销凭证 | 3–5 天 + 上游 | P1 |

---

## 6. 工程质量 / 发布

| ID | 事项 | 优先级 |
|---|---|---|
| F1 | 单元/集成测试继续覆盖新工具与路由 | P0 |
| F2 | 真实 Docker CI（Linux）+ Windows binary smoke | P1 |
| F3 | DSH 版本矩阵（0.2.x rc 变化）与 `engines.dsh` 策略 | P1 |
| F4 | UI 视觉/交互测试（Playwright/mock ARTEX） | P2 |
| F5 | npm 包、checksums、SBOM、Release tgz | P1 |
| F6 | Quickstart、截图、FAQ、插件市场 metadata | P1 |
| F7 | 诊断包（logs、state、health）与错误码文档 | P2 |

---

## 7. 推荐执行顺序

### Sprint 1（P0，约 1 周）
1. A1 `?embed=1` + A2 主题桥/自动登录
2. C1 审批通知
3. C4 工具级审批门
4. D2 Doctor
5. D1 Docker Compose E2E（需要 Docker 环境）

### Sprint 2（约 2 周）
1. B1 Retest + B2 导出/编辑 + B11 报告
2. A6 任务详情剩余 tabs
3. A5 Assets/Coverage
4. B5 LLM profiles/pool
5. B10 批量审批

### Sprint 3（约 2–3 周）
1. A4 原生 Chat/Conversations
2. A3 `/artex/ui` 同源挂载
3. A7 系统管理页（可先做最高频的 MCP/Skills/Agents）
4. C3 SSE→DSH 事件、C5 LLM 继承
5. A9 i18n/响应式

### Sprint 4（发布硬化）
- D3–D6 跨平台/打包/升级
- F2–F6 CI/矩阵/文档/市场
- E1–E6 安全合规复查

---

## 8. 关键决策点

1. **A3 同源挂载 vs iframe 嵌入**：A3 体验最好但维护一个 ARTEX 补丁构建；A1/A2 成本低但仍是跨域。
2. **原生 parity 的边界**：是否要把 27 个页面全部原生重做，还是保留 Console 作为长尾入口。
3. **ARTEX 上游补丁策略**：Windows evidence fsync、basePath、API token 是否回馈上游/维护 fork。
4. **默认运行时**：Docker（完整工具链）vs binary（轻量但缺 Kali）。
5. **单实例 vs 多实例**：是否支持同一 DSH 里多个 ARTEX（端口/DB/卷隔离）。

---

## 9. “完整插件”的定义（DoD）

- 一条命令安装，Doctor 能自检并修复常见问题。
- Docker 与 binary 两条路径都有真实 E2E。
- 原 ARTEX 27 个页面全部可达；高频页面原生。
- 审批不会让任务无声卡死，有 DSH 通知/审批门。
- 密钥不进入模型/日志/仓库，支持轮换。
- 升级不丢数据，备份/恢复有文档。
- Windows/macOS/Linux 至少各一条 smoke 通过。
- AGPL/使用条款/安全声明完整。

---

## 10. 建议的下一步

优先 **A1 + A2 + C1 + D2**：投入约 3–5 天，能同时解决“原设计割裂”“审批卡死”“首次安装难”三个最影响体验的问题。

如果目标是“设计完全一致”，则直接上 **A3 `/artex/ui` 同源挂载**，但它需要维护 ARTEX 的 basePath 构建补丁，建议单独开一个分支做。
