# Contributing to dsh-artex

Thanks for helping improve the ARTEX plugin for DeepSeek Harness. Bug reports,
documentation fixes and focused pull requests are welcome.

> This project is a security tool. Only test systems you own or have explicit
> permission to test. Contributions must not add features whose primary purpose
> is unauthorized access, stealth against defenders, or evasion of the approval
> and authorization controls described in the README.

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). For
security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a
public issue.

## Development setup

Requirements:

- Node.js `22.19+` or `24+`
- npm (the repository ships `package-lock.json`)
- Optional: a DSH 0.2.x installation for manual UI checks
- Optional: Docker, or an ARTEX checkout/binary plus PostgreSQL for real E2E work

```bash
git clone https://github.com/Fengrru/dsh-artex.git
cd dsh-artex
npm ci                 # installs dev deps; the prepare hook builds dist/
npm test               # node --test, no DSH required
npm run build          # src/client.js -> dist/client.js + bundle checks
```

To load the plugin into a DSH profile:

```bash
dsh plugin --profile dev add .
dsh --profile dev
```

The Host half is plain ESM and runs directly; the browser half must be rebuilt
after editing `src/client.js`.

## Project layout

| Path | Purpose |
|---|---|
| `src/host.js` | DSH Host entry: Config, lifecycle, tool registration, slots, system prompt |
| `src/lib/artex-client.js` | REST/SSE client for ARTEX, auth/JWT persistence, error mapping |
| `src/lib/sidecar.js` | `external` / `docker` / `binary` runtime management and `doctor` |
| `src/lib/tools.js` | The nine model tools and their JSON Schemas |
| `src/lib/routes.js` | Same-origin `/artex/*` HTTP routes used by the browser panel |
| `src/lib/gate.js` | DSH approval gate for task creation, retests and runtime start |
| `src/client.js` | React browser panel (single-file bundle source) |
| `src/shared/` | Pure helpers shared by Host and client (activity keys, graph layout) |
| `skills/artex-pentest/` | Bundled skill describing the authorized-testing workflow |
| `docker/compose.yml` | Managed PostgreSQL + ARTEX stack |
| `patches/` | Optional ARTEX patches (Windows evidence fsync) |
| `test/host.test.mjs` | Host-side contract tests; no DSH or network required |

## Design constraints

Please keep these invariants unless the PR explicitly discusses changing them:

1. **Host is zero-build ESM.** Do not add a Host bundling step.
2. **One client bundle.** `scripts/build.mjs` must produce only
   `dist/client.js`, wrapped in `window.__ModuleLoader__.load({...})`.
3. **React is external.** The client may only require `react`,
   `react/jsx-runtime`, `react-dom` and `react-dom/client`; no dynamic imports.
4. **Secrets stay in the Host.** The browser must never receive the ARTEX JWT,
   admin password or LLM API keys. Use the `/artex/*` routes rather than calling
   ARTEX directly from the client.
5. **Same-origin writes.** New browser routes must use the existing
   `requestRejection` / `sameOriginRejection` / `readJson` helpers.
6. **Approval gates are deliberate.** Do not auto-approve ARTEX operations or
   weaken `authorization_ack` / target-gate defaults.
7. **New runtime dependencies need a reason.** Prefer Node built-ins and the
   existing `@deepseek-ai/schemastery` / `esbuild` toolchain.

## Tests

- Add unit coverage in `test/host.test.mjs` for client methods, normalizers,
  tool schemas, gates and route-adjacent helpers.
- Unit tests must not require DSH, Docker, PostgreSQL or network access. Use the
  injected `fetchImpl` / `fakeFetch` pattern.
- If you change a browser flow, include a short manual verification note in the
  PR (screen name, action, observed result). Screenshots are welcome, but remove
  target names, tokens and personal paths first.
- Real E2E must use a local lab or an explicitly authorized target. Never point
  the tests at a third-party system.

## Commits and pull requests

Use Conventional Commits, for example:

```
feat(traffic): bind an exchange to a finding
fix(sidecar): reuse a persisted JWT for the same endpoint
docs(readme): clarify Console login
test(tools): cover approval batch decisions
```

Before opening a PR:

- [ ] `npm test` passes
- [ ] `npm run build` passes the bundle checks
- [ ] `npm pack --dry-run` contains the expected files
- [ ] No secrets, local absolute paths, generated state or `node_modules` added
- [ ] README / CHANGELOG updated for user-visible changes
- [ ] Security implications considered (approval gates, secret handling, target scope)

Keep PRs scoped. Refactors and behavior changes are easier to review separately.

## License

By contributing, you agree that your contributions are licensed under the
GNU Affero General Public License, version 3 or later
(`AGPL-3.0-or-later`), the same license as this repository. See
[LICENSE](LICENSE) and [NOTICE](NOTICE).
