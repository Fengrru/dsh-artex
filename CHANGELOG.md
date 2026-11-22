# Changelog

## Unreleased

- Open-source repository scaffolding: NOTICE, contribution/security/conduct
  documents, CI matrix, issue/PR templates, Dependabot, `.gitignore`, and a
  README/docs split into architecture, features and testing.
- Package metadata (repository, homepage, bugs, author) and a `prepare` build
  hook so a git checkout produces `dist/client.js` on install.

## 0.15.0

- **Task templates**: native manager (list/new/edit/delete) with name, description, goal, category and task-level intercept/allow rules. The create-task form gained a template picker that pre-fills description/goal/name and carries category + rules into the new task.
- **Skills upload/delete**: upload a zip containing `SKILL.md` (raw `application/zip` forwarded as multipart, 20 MB cap, optional overwrite), plus native skill delete. Verified upload/list/delete through the DSH route.
- **Agents**: custom agent create/rename/delete, runtime config (max turns, run seconds, web search, interactive shell, trigger run/merge/max-parallel), built-in tool bindings, trigger CRUD (interval/finding/goal/timeout/tool-call/task-create + per-condition messages), and MCP/skill visibility. Verified every write against real ARTEX, including binding cleanup after agent deletion.
- **Notify**: channel edit with delivery mode, rate limit and the full filter (min severity, task/asset IDs, vulnclass include/exclude, status-change opt-in); delivery history with state/event/channel filters, paging and retry.
- **Responsive shell**: the tab bar wraps on narrow widths and panel flex children can shrink.
- Client bundle 124.0 KB; tests 37 `node --test` cases.

## 0.14.0

- **Task categories**: Tasks header category manager (list with task counts, create, delete). Verified create/list/delete with a temporary category.
- Client bundle 92.8 KB; tests remain 33 `node --test` cases.

## 0.13.0

- **Task intercept rules**: Plan → Intercept tab lists task-level block/allow rules, adds action + kind + pattern + note, toggles enabled and deletes. Verified add/list/toggle/delete with a temporary rule.
- Client bundle 91.8 KB; tests remain 33 `node --test` cases.

## 0.12.0

- **Task credentials**: Plan → Credentials tab lists task accounts (masked passwords), adds domain/username/password/note, deletes. Verified add/list/mask/delete with a temporary credential.
- Client bundle 89.2 KB; tests remain 33 `node --test` cases.

## 0.11.0

- **Task Plan CRUD**: task detail gained a Plan area with Goals, Scope and Constraints tabs (list/add/delete). Goals/scope/constraints writes use the human CRUD endpoints; goal deletion does not revive the task.
- Verified: goals/scope/constraints reads; constraint add/delete; keyword scope add/delete with cleanup.
- Client bundle 87.2 KB; tests remain 33 `node --test` cases.

## 0.10.0

- **Custom tools page**: list custom tools, create/edit with JSON schema + exec, test exec, delete.
- **Notify editing**: create channel with kind + JSON config, send a test message, delete.
- Verified real writes/cleanup for a temporary command tool.
- Client bundle 82.0 KB; tests remain 33 `node --test` cases.

## 0.9.0

- **System editing**: MCP create (stdio/http/sse) alongside refresh/delete; Skills create + file edit/save; Workspace text file edit/save; Agents prompt view/edit/reset.
- Verified real writes: created/edited/deleted a temp skill; wrote/read/deleted a workspace file; loaded the worker prompt.
- Client bundle 75.3 KB; tests remain 33 `node --test` cases.

## 0.8.0

- **System tab**: native MCP list (refresh/delete), Skills list + file preview, Agents overview, Notify channels, Logs (5s refresh), Workspace browse/read, and a Settings form (noise, workers, concurrency, capture/binding, LLM record, constraint injection, noa, notify).
- Editing MCP/Skills/Agents/Notify/Workspace remains in Console; `Custom tools` page remains in Console.
- Client bundle 69.8 KB; tests remain 33 `node --test` cases.

## 0.7.0

- **Doctor**: `artex_status action=doctor` + `/artex/doctor` + Console diagnostics panel (runtime/health/auth/LLM/approvals/runtime-specific checks).
- **Report**: `/artex/report`, native task report preview/download.
- **Finding lifecycle**: status/severity editing, export (MD), retest start/list/active, traffic evidence viewer and binding UI.
- **Batch approvals**: multi-select allow/deny, always-allow rules, approval history.
- **Assets/Coverage**: native task asset table, type filter, paging, coverage summary.
- **LLM management**: native LLM tab (profiles activate/delete/test/create, failover pool status/reset) plus `artex_llm` actions.
- **Chat**: native conversations list/thread/send/stop.
- **Task ops**: archive/delete from the task detail; traffic purge (host/all) with two-step confirmation.
- **Safety gates**: `tools/pre-execute` asks before `artex_task create` and `artex_findings retest`; pending-approval toast jumps to Approvals.
- Tests: 33 `node --test` cases; client bundle 58.4 KB.

## 0.6.0

- **Native exploration graph**: a new Graph tab reads `/artex/graph?task=` and renders a deterministic layered SVG (goal → intent → fact/hint → finding) with typed nodes, labelled edges (spawns/derived_from/yields/proves/covers), and a click-through payload panel. Verified on the real task: 7 nodes / 8 edges, finding 17 detail with 2 related edges.
- Client bundle 36.2 KB; tests 29 `node --test` cases.

## 0.5.0

- **Visual evidence loop**: the finding card expands its bound traffic (role/method/status/URL/note), and the Traffic detail panel binds the current exchange to a finding by id + role + note.
- Verified on the real lab task: finding 2 (SQLi) carries `proof` (`id=1'` → 500) and `verification` (`id=1 AND 1=2` → 200), `traffic_count=2`.
- Client bundle 31.4 KB; tests remain 28 `node --test` cases.

## 0.4.0

- **Evidence workflow**: `artex_settings` (get/set traffic capture + agent traffic binding), `artex_findings action=traffic|bind_traffic`, `/artex/settings` and `/artex/finding/{traffic,bind}` routes, and a capture toggle in the Traffic tab.
- **Windows evidence fix**: exported `patches/artex-windows-evidence-fsync.patch` for ARTEX's directory fsync failure when binding traffic evidence on Windows. Verified by binding real XSS/SQLi exchanges to findings 1 and 2 (`traffic_count` 1 each).
- Tests: 28 `node --test` cases; client bundle 28.9 KB.

## 0.3.0

- **Real E2E hardening** (ARTEX binary + embedded PostgreSQL 17):
  - binary mode now reads the setup token from raw child output (display logs stay redacted);
  - a failed post-start auth no longer spawns a second child on the same port;
  - activity records keyed by ARTEX's `seq` as well as the mock/legacy `id` (fixes an empty real activity feed).
- **JWT persistence**: the 7-day token is stored in `$DSH_HOME/dsh-artex/state.json` (0600) and reused across DSH restarts; only a missing/expired token or an endpoint change triggers login. 429 is surfaced as `ARTEX_RATE_LIMITED` with the 15-minute lock explanation.
- **`artex_llm` tool**: `status` / `profiles` / `models` / `create` / `activate`. Reads the key from a DSH credential reference (default `DEEPSEEK_API_KEY`) or the process environment, never from tool arguments; tool output never echoes the key.
- **HITL chat composer** in the task detail: sends an operator message to the ARTEX main agent; rule-mode replies are shown inline, LLM replies arrive in the live activity stream.
- **Settings page** (`plugins.row.config`, key `dsh-artex#artex`): all non-secret Config fields are `.volatile()` and editable live; saves flow through DSH's `configForms` into the profile patch.
- **SSE live activity**: `/artex/activity/stream` proxies ARTEX SSE and forwards `Last-Event-ID`; the panel uses EventSource with a 10s polling fallback and id/seq dedupe.
- **Findings view** in the task detail (severity/status/verification/traffic/assets).
- **Traffic view**: global capture table with host/keyword filters, pagination, and raw request/response detail.
- **Real DeepSeek completion E2E**: with a user-supplied key, a local `127.0.0.1:8080` lab task finished `done` with 2/2 goals, one high SQLi and one medium XSS finding, and a generated Markdown report (233,385 input / 8,572 output tokens). The key was stored only in ARTEX's encrypted `llm_profiles` and never entered the plugin tree.
- Tests: 26 `node --test` cases; client bundle 28.5 KB (three build checks).

## 0.2.0

- Settings card via `plugins.row.config` + volatile Config.
- SSE live activity proxy and client EventSource/fallback.
- Native Findings and Traffic views.
- Version 0.2.0 docs and tests.

## 0.1.0

- Initial DSH bundle: managed ARTEX sidecar (external/docker/binary), REST client, 7 `artex_*` tools, approval bridge, `/artex/*` routes.
- Client panel: Console iframe, Tasks, Approvals, sidebar entry, pending badge.
- Bundled `artex-pentest` skill and system-prompt safety contract.
- Docker compose template, setup-token bootstrap, admin password persistence.
