# Features

The panel has nine top-level tabs. High-frequency ARTEX workflows are native;
the complete ARTEX UI is still available through the Console tab.

## Tabs

| Tab | What it covers |
|---|---|
| **Console** | Sidecar status, start/stop/reconnect, doctor, logs, and the full ARTEX UI in an iframe. |
| **Tasks** | Task list, create with authorization ack + scope, categories, templates, detail view. |
| **Chat** | ARTEX conversations list, thread, send and stop. |
| **Graph** | Native exploration graph (goal → intent → fact/hint → finding) with typed edges and payload details. |
| **Assets** | Task asset table, type filter, paging, coverage summary. |
| **LLM** | Profiles, activate/delete/test/create, failover pool status and circuit-breaker reset. |
| **System** | MCP, custom tools, skills, agents, notifications, logs, workspace, settings. |
| **Traffic** | Captured exchanges, capture toggle, host purge, purge all, bind evidence to a finding. |
| **Approvals** | Pending command approvals, batch allow/deny, always-allow rules, history. |

## Tasks and findings

- **Create task** requires an explicit authorization acknowledgement and at least
  one scope entry. A task template can pre-fill name, description, goal,
  category and task-level intercept/allow rules.
- **Task detail** includes Plan (goals, scope, constraints, credentials,
  intercept rules), recent activity over SSE with an HTTP polling fallback,
  HITL chat, findings and report generation.
- **Findings** show severity, status, verification state, related assets and
  bound traffic. Status/severity are editable, evidence can be expanded, a retest
  can be started, and Markdown export is available.
- **Reports** can be previewed and downloaded from the task detail.

## Templates, skills and agents

- **Task templates**: list/create/edit/delete with name, description, goal,
  category and task-level intercept/allow rules. The create-task form applies a
  template's category and rules to the new task.
- **Skills**: create a skill, edit its files, upload a zip containing `SKILL.md`
  (20 MB limit, optional overwrite), and delete a skill.
- **Agents**: create/rename/delete custom agents; edit the prompt and reset it to
  the built-in default; configure turn/time budgets, web search, interactive
  shell and trigger behavior; bind built-in tools; manage triggers; and control
  which MCP servers and skills the agent can see.
- **Triggers** support interval, new finding, goal met, task timeout, tool call
  and task creation conditions, each with its own message. Built-in agents do not
  support triggers, matching upstream behavior.

## Notifications

- Create and edit channels with delivery mode (`realtime` / `digest`), rate
  limit, and filters (minimum severity, task/asset IDs, vulnclass include/exclude,
  status-change events).
- Send a test message, delete a channel, browse delivery history with
  state/event/channel filters, and retry failed or skipped deliveries.

## Safety controls

- `requireAuthorizationAck` defaults to `true`; task creation must carry an
  explicit acknowledgement.
- `targetGate` defaults to `true`; ARTEX's target approval gate is enabled for new
  tasks unless the task says otherwise.
- DSH-side tool gates can ask before task creation, retests and runtime start.
- The plugin never auto-approves ARTEX command approvals. Pending approvals are
  surfaced in the sidebar and a toast.
- Tool output that contains ARTEX activity, findings or traffic is marked as
  untrusted data so the model does not treat target-controlled text as
  instructions.

## Console fallback

Some low-frequency operations remain Console-only:

- agent prompt versions, preview and variables;
- agent wrap-up prompts;
- advanced MCP environment/secret editing;
- skill metadata, directories and single-file deletion;
- ARTEX pages that were not re-implemented natively.

The Console iframe needs an ARTEX build with the web UI embedded. The managed
Docker compose file builds it; a locally built binary needs `-tags embedui`. See
the README for login details.

## Known limitations

- Native UI strings are Chinese; ARTEX's own Console is Chinese as well. There is
  no half-translated English mode.
- The Console iframe is cross-origin by design; the ARTEX admin password is
  entered once in the iframe.
- ARTEX has no hard stop endpoint; the plugin's cancel action pauses the task and
  cancels active intents.
- The Traffic tab is global, not per-task, because the ARTEX traffic API is not
  task-scoped.
- Windows `runtime=binary` evidence binding requires the patch in `patches/`.
- Docker Compose and macOS/Linux paths are implemented but were not validated on
  the maintainer's Windows-only test host.
