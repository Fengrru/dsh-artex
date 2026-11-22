# Security policy

## Supported versions

Security fixes are applied to the latest `0.15.x` release line on `main`.
Older pre-releases may not receive patches.

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.**

Report it privately through GitHub Security Advisories:

<https://github.com/Fengrru/dsh-artex/security/advisories/new>

Include, when possible:

- affected version or commit;
- the runtime mode (`external`, `docker` or `binary`) and OS;
- reproduction steps and the observed impact;
- whether ARTEX, DSH or the plugin itself is the vulnerable component;
- any suggested fix or mitigation.

You can expect an initial acknowledgement within a few days. This is a
community project, so timelines are best-effort rather than contractual.
Please give us a reasonable window to ship a fix before publishing details.

## Threat model

`dsh-artex` is a plugin for an autonomous penetration-testing platform. It is
designed for **authorized** security testing only.

What the plugin assumes:

- **The Host half is trusted code.** DSH plugins run with the privileges of the
  DSH process. Do not install plugins you do not trust.
- **ARTEX is a separate, powerful service.** ARTEX workers can execute commands
  on the targets in scope. The plugin does not sandbox ARTEX; use the Docker
  runtime and a dedicated host if you need isolation.
- **The operator is authorized.** The plugin defaults to
  `requireAuthorizationAck=true` and `targetGate=true`, but it cannot verify that
  a user actually owns a target. Authorization responsibility stays with the
  operator.
- **Model output is not trusted.** Target responses, findings, traffic bodies and
  activity text can contain attacker-controlled content. Tool output marks this
  as untrusted data; models must not follow instructions embedded in it.
- **Approvals are a safety control, not a formality.** The plugin never
  auto-approves ARTEX `ask` decisions. Only approve operations that match the
  confirmed scope and that the operator understands.

Security properties the plugin tries to maintain:

- The ARTEX JWT and admin password stay in the DSH Host process and
  `$DSH_HOME/dsh-artex/state.json` (mode `0600`); they are not sent to the
  browser or placed in model context.
- LLM API keys supplied through DSH credential refs are used only in the Host
  and are redacted from logs.
- `/artex/*` browser routes require the DSH session and write routes also check
  same-origin Fetch metadata.
- ARTEX tool output is wrapped as untrusted data before it reaches the model.
- The Console iframe is cross-origin by design. The plugin deliberately does not
  inject its JWT into the ARTEX browser UI.

## Out of scope

- Vulnerabilities in **ARTEX upstream**. Report those to the ARTEX maintainers.
  If the integration amplifies an upstream issue, tell us as well.
- Vulnerabilities in **DSH itself** or in third-party MCP servers/tools that a
  user configures. Report them to the respective project.
- Findings that require the operator to deliberately disable safety defaults,
  hand over the admin password, or test systems without authorization.
- Denial-of-service or destructive testing against systems you do not own.

## Safe testing guidance

When validating a report, use a local lab (for example an intentionally
vulnerable VM or a disposable container). Do not test this plugin or ARTEX
against public third-party systems.
