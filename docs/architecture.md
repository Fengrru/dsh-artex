# Architecture

`dsh-artex` wraps a separately installed
[ARTEX](https://github.com/BaaRai/ARTEX) instance and exposes it to DeepSeek
Harness (DSH) in two halves.

```
┌──────────────────────── DSH process ────────────────────────┐
│                                                             │
│  model / tools ──► src/lib/tools.js ──► ArtexClient ──┐      │
│                                                       │      │
│  DSH web UI ──► src/client.js ──► /artex/* routes ────┤      │
│                                 │                     │      │
│                                 └──► ArtexSidecar ────┼──► ARTEX API
│                                                       │    (127.0.0.1:8787)
│  Console iframe ──────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
                                      ARTEX UI (embedded in ARTEX)
```

The model and the browser never talk to ARTEX directly. Both go through the
Host half, which owns authentication, error mapping and the approval bridge.

## Host half

`src/host.js` is the DSH plugin entry. It is plain ESM and needs no build step.

- **Config** is a Schemastery schema. Non-secret fields are `.volatile()` so the
  Plugins settings card can edit them live and persist them into the profile
  patch. `pgDsn` is a secret role and stays in YAML or `ARTEX_PG_DSN`.
- **Lifecycle** restores the persisted JWT/password, creates one `ArtexClient`
  and one `ArtexSidecar`, registers tools and routes in `ctx.effect`, and stops a
  plugin-owned runtime on unload when configured.
- **Tools** are registered with raw JSON Schemas and hand-written argument
  checks. Their output is `{ schema, render }`; ARTEX activity, finding and
  traffic text is marked as untrusted data.
- **Approval gate** listens on `tools/pre-execute` and can ask the DSH approval
  UI before task creation, retests, or runtime start. ARTEX's own command
  approvals remain the primary gate; the plugin only adds DSH-side checks.
- **Browser routes** under `/artex/*` require the DSH session and check
  same-origin Fetch metadata for writes. Raw binary uploads use `readBinary`;
  everything else uses `readJson`.
- **Secrets**: the ARTEX JWT and generated admin password live in
  `$DSH_HOME/dsh-artex/state.json` with mode `0600`. LLM keys are read from DSH
  credential refs or the process environment only on the Host side. Neither is
  sent to the browser or included in tool output.

## Sidecar

`src/lib/sidecar.js` supports three runtime modes:

| Mode | What it does |
|---|---|
| `external` | Connects to an already-running ARTEX at `endpoint`; never starts anything. |
| `docker` | Builds and starts `docker/compose.yml` (PostgreSQL + ARTEX), waits for health, reads the one-time setup token from logs, initializes the admin account if needed. |
| `binary` | Spawns a local ARTEX binary with `-addr`, `-data` and `-proxy`, using `ARTEX_PG_DSN` or `pgDsn`. |

A persisted token is reused across restarts. If ARTEX rejects it and no password
is available, the sidecar reports an actionable configuration error instead of
looping through the login rate limiter.

## Client half

`src/client.js` is a React panel bundled into one CJS file by
`scripts/build.mjs` and wrapped in the DSH ModuleLoader contract:

```js
window.__ModuleLoader__.load({ id: "dsh-artex", factory: (require) => { ... } })
```

Constraints enforced by the build script:

- only `react`, `react/jsx-runtime`, `react-dom` and `react-dom/client` may be
  externalized;
- no dynamic `import()`;
- `dist/` contains only `client.js`.

The panel has nine top-level tabs and mounts a settings card through
`ctx.slots`. It uses the same-origin `/artex/*` routes, so no CORS configuration
is required and the ARTEX JWT never enters the browser. The Console tab embeds
the full ARTEX UI in an iframe for long-tail pages; that iframe is intentionally
cross-origin and therefore asks for the ARTEX admin password once.

## Repository layout

```text
src/
  host.js                 DSH Host entry
  client.js               browser panel source
  lib/
    artex-client.js       REST/SSE client, auth, JWT persistence
    sidecar.js            external / docker / binary runtime
    tools.js              nine model tools + schemas
    routes.js             same-origin /artex/* HTTP API
    gate.js               DSH approval gate
    skills.js             bundled skill provider
    config.js             volatile-config helper
  shared/
    activity.js           activity key normalization (seq/id)
    graph.js              deterministic graph layout
docker/compose.yml        managed PostgreSQL + ARTEX
patches/                  optional upstream patches
skills/artex-pentest/     authorization-first pentest workflow
test/host.test.mjs        Host contract tests
```

## Key design decisions

1. **Sidecar, not in-process embedding.** ARTEX owns global state, process-wide
   logs and its own database/runtime. Embedding it inside DSH would couple two
   release cycles and make cleanup unsafe.
2. **Browser talks only to the Host.** This keeps the JWT out of browser
   storage, avoids CORS, and gives one place to enforce same-origin writes.
3. **iframe first for the full UI.** Re-implementing all of ARTEX's pages would
   duplicate upstream work. High-frequency workflows are native; the full UI
   remains available in Console.
4. **No same-origin ARTEX mount.** ARTEX's static UI uses absolute `/api` and
   `/_next` paths. Mounting it under DSH would require a patched build and would
   give third-party UI scripts same-origin access to DSH APIs. A cross-origin
   iframe is the safer trade-off.
5. **AGPL-3.0-or-later.** ARTEX is AGPL-3.0; the plugin and its optional patch
   are distributed under the same family of license.
