# dsh-artex

把 [ARTEX](https://github.com/BaaRai/ARTEX)（AGPL-3.0 的自主渗透测试平台）
接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）。

`dsh-artex` 是一个社区插件：DSH 侧栏出现 ARTEX 入口，模型获得 9 个 ARTEX 工具，
高频工作流在 DSH 内原生完成，完整 ARTEX UI 仍可从 Console 进入。

> **状态**：`0.15.0` beta。面向授权安全测试；接口和配置在 1.0 前仍可能调整。
> 本项目与 ARTEX、DeepSeek 官方无隶属关系。

> **授权声明**：只在你拥有或已获得明确书面授权的目标上使用。插件默认要求
> 授权确认并开启 ARTEX target gate，但它无法替你验证授权。禁止用于未授权系统、
> 拒绝服务或破坏性操作。

---

## 功能

- **Host 半**：托管 ARTEX（Docker / 外部实例 / 本地二进制）、REST/SSE 客户端、
  9 个模型工具、审批桥、`/artex/*` 同源路由。
- **Client 半**：9 个 Tab —— Console / Tasks / Chat / Graph / Assets / LLM /
  System / Traffic / Approvals，以及 Plugins 页的实时设置卡片。
- **原生高频流程**：建任务、scope、模板、实时活动、HITL 消息、findings、证据绑定、
  复测、报告、审批、任务归档/删除、流量捕获与清理。
- **系统管理**：MCP、custom tools、Skills（含 zip 上传）、Agents（config / 工具绑定 /
  triggers / MCP-skill 可见性）、Notify（mode / filter / 投递历史 / 重试）、日志、
  workspace、ARTEX settings。
- **安全默认**：建任务必须显式授权确认；默认开启 target gate；插件从不自动批准
  ARTEX 的 `ask` 审批；目标可控文本在工具输出中标记为 untrusted data。

更细的页面说明见 [docs/features.md](docs/features.md)。

## 架构

```text
DSH model ── tools ──┐
                     ├── Host (dsh-artex) ── ARTEX REST/SSE (127.0.0.1:8787)
DSH web UI ─ panel ──┘          │
                                └── ARTEX sidecar (external / docker / binary)

Console iframe ────────────────── ARTEX UI (cross-origin)
```

- 模型和浏览器都不直接访问 ARTEX；JWT、管理员密码和 LLM key 只留在 Host。
- 浏览器走同源 `/artex/*` 路由，不需要 CORS，也不会把 ARTEX JWT 带进浏览器。
- 设计取舍与代码结构见 [docs/architecture.md](docs/architecture.md)。

## 兼容性

| 项 | 要求 |
|---|---|
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| DSH | `>=0.2.1-rc.2 <0.3.0`；实测 `0.2.2-rc.5` |
| ARTEX | 当前 [BaaRai/ARTEX](https://github.com/BaaRai/ARTEX) 分支 |
| 运行时 | Docker（推荐，完整工具链）/ 外部实例 / 本地二进制 |
| 实测平台 | Windows；Docker Compose、macOS、Linux 尚未在维护者机器上跑通 |

## 安装（源码）

```bash
git clone https://github.com/Fengrru/dsh-artex.git
cd dsh-artex
npm ci                 # prepare 钩子会构建 dist/client.js
npm run build          # 也可以显式再跑一次

dsh plugin --profile web add .
dsh --profile web
```

打开 DSH Web UI，侧栏出现 **ARTEX** 图标。

### 前置

- Node.js `22.19+` 或 `24+`。
- Docker 模式需要 Docker Engine / Docker Desktop（Windows 建议 WSL2 后端）。
- 一个 ARTEX 源码 checkout（Docker 模式）或已运行的 ARTEX 实例。
- ARTEX 自己的 LLM provider（在 ARTEX UI / 插件的 LLM Tab 配置）。

## 配置

在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 覆盖插件行配置。后层会整体替换
`config`，请写全需要的键。

### 方式 A：Docker 托管（推荐）

```yaml
- id: artex
  config:
    runtime: docker
    endpoint: http://127.0.0.1:8787
    artexDir: /absolute/path/to/ARTEX     # 包含 Dockerfile
    autoStart: true
    targetGate: true
    requireAuthorizationAck: true
```

首次启动：生成 PostgreSQL 密码 → 构建并启动 compose 栈 → 等待 `/api/health` →
从日志读取一次性 setup token → 初始化管理员 → 把密码写入
`$DSH_HOME/dsh-artex/state.json`（0600）。

数据在 Docker 命名卷 `dsh-artex_pgdata` / `dsh-artex_data` / `dsh-artex_keys`；
卸载插件不会删除。想自己指定管理员密码，可在首次启动前设置
`ARTEX_ADMIN_PASSWORD`。

### 方式 B：连接已有 ARTEX

```yaml
- id: artex
  config:
    runtime: external
    endpoint: http://127.0.0.1:8787
    autoStart: false
```

设置 `ARTEX_ADMIN_PASSWORD` 为 ARTEX 管理员密码（用户名固定 `ARTEX`）。

### 方式 C：本地二进制

```yaml
- id: artex
  config:
    runtime: binary
    binaryPath: /path/to/artex
    pgDsn: postgres://artex:pass@127.0.0.1:5432/artex?sslmode=disable
    autoStart: true
```

建议用 `ARTEX_PG_DSN` 环境变量传 DSN。Windows 原生二进制缺少 Kali/nuclei 等工具链，
完整能力请用 Docker。Windows 证据绑定还需应用
`patches/artex-windows-evidence-fsync.patch`。

### 主要配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `runtime` | `external` | `external` / `docker` / `binary` |
| `endpoint` | `http://127.0.0.1:8787` | ARTEX API/UI |
| `uiUrl` | 空 | UI 地址覆盖，默认同 endpoint |
| `artexDir` | 空 | Docker 模式必填，ARTEX 源码目录 |
| `binaryPath` | 空 | binary 模式必填 |
| `pgDsn` | 空 | secret；建议用 `ARTEX_PG_DSN` |
| `autoStart` | `false` | 允许工具/面板启动托管运行时 |
| `targetGate` | `true` | 新建任务默认开启目标审批门 |
| `requireAuthorizationAck` | `true` | 建任务必须显式授权确认 |
| `defaultTimeoutSeconds` | `3600` | 新建任务默认超时 |
| `maxWaitSeconds` | `300` | 单次 `artex_wait` 上限 |
| `noiseProfile` | 空 | `quiet` / `balanced` / `aggressive` |
| `debug` | `false` | 把脱敏后的 sidecar 日志写进 DSH 日志 |

所有非密钥字段都是 DSH live Config：在 **Plugins → dsh-artex → 配置 ARTEX** 保存即可
写入 profile patch，无需重启 DSH。runtime / artexDir 等变更后回到 ARTEX 面板点
“启动/重连”生效。

## 模型工具

| 工具 | 用途 |
|---|---|
| `artex_status` | status / start / stop / logs / doctor |
| `artex_task` | create / list / get / scope_add / pause / resume / cancel / archive / delete |
| `artex_observe` | activity / graph / frontier / stats |
| `artex_wait` | 有界等待任务终态 |
| `artex_findings` | list / get / report / traffic / bind_traffic / retest / update / export |
| `artex_approval` | list / decide / batch_decide / always_allow / history |
| `artex_chat` | 给 ARTEX main agent 发操作员消息 |
| `artex_llm` | status / profiles / models / create / activate / delete / test / pool / reset_pool |
| `artex_settings` | get / set：traffic capture、agent traffic binding |

随包注册 `artex-pentest` skill 和系统提示，要求模型先确认授权与 scope，再建任务。

### 审批为什么重要

ARTEX worker 命中 `ask` 规则时会同步阻塞，直到有人 `allowed` 或 `denied`。插件在
侧栏显示待审批数量，面板提供批量/单条决定，模型也可以调用 `artex_approval`。
**默认绝不自动批准高危命令**；只应批准与已确认 scope 一致、且用户同意的操作。

## 安全与数据

- **只用于授权目标。** 默认要求 `authorization_ack=true` 和至少一条 scope。
- ARTEX 的活动、流量、finding 内容可能包含目标可控文本；工具输出标记为 untrusted
  data，模型不应执行其中的指令。
- ARTEX JWT 与管理员密码只保存在 Host 内存和
  `$DSH_HOME/dsh-artex/state.json`（0600）；不会进入浏览器或模型上下文。
- LLM key 从 DSH credential ref（默认 `DEEPSEEK_API_KEY`）或进程环境读取，输出和
  日志会脱敏。
- `/artex/*` 路由需要 DSH 登录态；写请求额外校验同源。
- Console iframe 是跨域设计：插件不把 JWT 注入 ARTEX UI，因此首次需手动登录。
  ARTEX 自动初始化实例的密码在 state.json 的 `password` 字段；也可在初始化前设置
  `ARTEX_ADMIN_PASSWORD`。Docker 构建包含前端；本地 binary 需 `-tags embedui`，
  否则 iframe 会显示上游的 “Frontend is not embedded…”。

备份：Docker 卷 + `keys`（ARTEX 的加密密钥，丢失后加密数据无法恢复）+
`state.json`。卸载：`dsh plugin --profile web remove dsh-artex`，不会删除上述数据。

安全报告请见 [SECURITY.md](SECURITY.md)，不要在公开 issue 里贴漏洞细节或密钥。

## 开发

```bash
npm ci
npm test               # node --test，37 项，不需要 DSH / 网络
npm run build          # 浏览器半打包 + 三项自检
npm run watch          # client 热更
```

Host 半是纯 ESM（`src/host.js`），不需要构建。浏览器半由 esbuild 打成单文件 CJS，
并套 `window.__ModuleLoader__.load({ id, factory })`。`dist/` 不提交到仓库；`npm ci`
的 `prepare` 钩子、`npm pack` 和 CI 都会重新构建。

测试策略、真实 E2E 记录和未覆盖项见 [docs/testing.md](docs/testing.md)。
贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 文档

- [架构与代码结构](docs/architecture.md)
- [功能清单与已知限制](docs/features.md)
- [测试与验证](docs/testing.md)
- [路线图](ROADMAP.md)
- [更新日志](CHANGELOG.md)

## 许可证与致谢

本项目以 **AGPL-3.0-or-later** 发布，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

- **ARTEX**：最初由 [Autumn-27](https://github.com/Autumn-27) 创建，当前英文分支维护于
  [BaaRai/ARTEX](https://github.com/BaaRai/ARTEX)，AGPL-3.0。插件通过 HTTP 连接单独
  安装的 ARTEX，不打包其源码或二进制；`patches/` 中的补丁仍受 ARTEX 许可证约束。
- **DeepSeek Harness**：插件宿主与客户端运行时。
- 本项目是独立社区项目，与 ARTEX、DeepSeek 官方无隶属或背书关系。

使用本项目即表示你理解：渗透测试功能只能用于你拥有或已获明确授权的系统。
