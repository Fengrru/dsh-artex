# Testing

## Unit and contract tests

```bash
npm ci
npm test
```

`test/host.test.mjs` uses Node's built-in test runner and does not require DSH,
Docker, PostgreSQL or network access. HTTP behavior is exercised through an
injected `fetchImpl`; sidecar tests use temporary directories under the OS temp
directory.

Coverage includes:

- plugin manifest, Config schema and package/file consistency;
- tool registration contract: snake_case names, raw JSON Schema,
  `additionalProperties: false`, output `{ schema, render }`, required fields;
- argument validation and task normalization;
- login, 401 retry, rate-limit and unreachable error mapping;
- JWT persistence and endpoint-scoped reuse;
- task creation acknowledgement, approval decisions and batch decisions;
- task categories/templates, skills upload/delete and notify channel/delivery
  client methods;
- agent config, built-in tool bindings, triggers and visibility client methods;
- activity key normalization, graph layout, secret redaction and sidecar config.

Current result: **37/37 passing** with Node 24 on Windows. CI runs the same
suite on Node 22 and 24.

## Build checks

```bash
npm run build
```

`scripts/build.mjs` fails if the client bundle:

- references a module outside the React baseline;
- contains a dynamic `import()`;
- leaves anything other than `client.js` in `dist/`.

## Manual DSH smoke test

1. `dsh plugin --profile dev add .`
2. Start DSH and open the ARTEX panel.
3. Check Console health and run doctor.
4. Create a task against a **local lab** with an authorization acknowledgement.
5. Verify SSE activity, HITL chat, findings, report and approvals.
6. Toggle traffic capture, replay a request through the recording proxy, and bind
   the exchange to a finding.
7. Check the template manager, skills page, agents tabs and notify page.

## Real ARTEX E2E record

The integration was validated against a real ARTEX build (not a mock):

- ARTEX binary + PostgreSQL 17, started by the plugin in `binary` mode;
- real task creation with scope and planner/worker activity over SSE;
- real DeepSeek completion against a local `127.0.0.1` lab: task reached `done`,
  goals were met, findings were produced, and a Markdown report was generated;
- real recording-proxy traffic captured and bound to findings as evidence;
- JWT reuse across a DSH restart;
- 0.15.0 additions verified through the real DSH routes and browser UI:
  task templates (create/edit/delete with rules), skill zip upload/delete,
  custom agent config/tool bindings/triggers/visibility, and notify
  filter/mode/history;
- Console iframe verified with an ARTEX binary built with embedded UI.

The test target was a disposable local lab. No third-party system was tested.
API keys used for manual E2E were supplied through DSH credentials or a local
environment variable and are not part of this repository.

## What is not covered

- A real Docker Compose run (the maintainer's test host had no Docker at the
  time; the compose path is statically checked).
- macOS and Linux smoke tests (Windows was the primary development host).
- DSH versions other than the tested `0.2.2-rc.5`.
- Multi-user or multiple concurrent ARTEX instances in one DSH profile.
- Load, fuzzing and long-running soak tests.

If you can run any of these, a PR with a short test log or CI job is welcome.

## Reporting test failures

Include the Node version, OS, runtime mode, DSH version, the failing command and
the relevant sanitized output. Do not paste JWTs, admin passwords, LLM API keys,
target credentials or private target addresses.
