// ARTEX sidecar supervisor.
//
// Modes:
//   external  - connect to an ARTEX that is already running
//   docker    - manage `postgres + artex` with docker compose (full toolchain)
//   binary    - spawn a local artex executable against an external PostgreSQL
//
// The supervisor is lazy: `apply()` never starts Docker. The first tool call
// (or the panel's Start button) calls ensure(), so DSH boot stays fast and a
// broken ARTEX install cannot disable the plugin row.

import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { ArtexError, normalizeBaseUrl } from './artex-client.js'
import { cv } from './config.js'

const execFileAsync = promisify(execFile)
const SETUP_TOKEN_RE = /setup token[^\n:]*:\s*([A-Za-z0-9_-]{8,})/i
const ANSI_RE = /\u001b\[[0-9;]*m/g

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function stateDir() {
  return join(dshHome(), 'dsh-artex')
}

function writePrivateJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
  try {
    chmodSync(tmp, 0o600)
  } catch {
    // Windows: chmod is advisory; the file still lives under the user profile.
  }
  renameSync(tmp, file)
}

function readState() {
  const file = join(stateDir(), 'state.json')
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function randomPassword() {
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

export function redactSecrets(text, secrets = []) {
  let out = String(text || '').replace(ANSI_RE, '')
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join('***')
  }
  out = out.replace(/setup token[^\n:]*:\s*[A-Za-z0-9_-]{8,}/gi, 'setup token: ***')
  out = out.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-***')
  out = out.replace(/\b[0-9a-f]{32,}\b/gi, '***')
  return out
}

function endpointParts(endpoint) {
  const url = new URL(normalizeBaseUrl(endpoint))
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  return { host: url.hostname, port: Number(port) }
}

export class ArtexSidecar {
  constructor({ config, client, logger = console }) {
    this.config = config
    this.client = client
    this.logger = logger
    this.state = 'idle'
    this.error = ''
    this.child = null
    this.output = []
    this.starting = null
    this.startedByPlugin = false
    this.stateFile = join(stateDir(), 'state.json')
  }

  get runtime() {
    return cv(this.config.runtime, 'external')
  }

  get endpoint() {
    return cv(this.config.endpoint, 'http://127.0.0.1:8787')
  }

  get uiUrl() {
    const override = cv(this.config.uiUrl, '')
    return (override || this.endpoint).replace(/\/+$/, '')
  }

  get composeFile() {
    const custom = cv(this.config.composeFile, '')
    return custom
      ? resolve(custom)
      : join(import.meta.dirname, '..', '..', 'docker', 'compose.yml')
  }

  get projectName() {
    return cv(this.config.projectName, 'dsh-artex')
  }

  password() {
    return process.env.ARTEX_ADMIN_PASSWORD || readState().password || ''
  }

  savePassword(password) {
    writePrivateJson(this.stateFile, { ...readState(), password })
  }

  // Reuse the 7-day JWT across DSH restarts so the plugin does not re-login on
  // every boot (ARTEX rate-limits login at 10/min/IP for up to 15 minutes).
  token() {
    const state = readState()
    if (!state.token) return ''
    try {
      if (state.tokenEndpoint && normalizeBaseUrl(this.endpoint) !== state.tokenEndpoint) return ''
    } catch {
      return ''
    }
    return String(state.token)
  }

  saveToken(token) {
    if (!token) return
    let endpoint = ''
    try { endpoint = normalizeBaseUrl(this.endpoint) } catch {}
    writePrivateJson(this.stateFile, {
      ...readState(),
      token: String(token),
      tokenEndpoint: endpoint,
      tokenAt: Date.now(),
    })
  }

  rememberOutput(chunk) {
    const text = String(chunk || '')
    if (!text) return
    this.output.push(text)
    if (this.output.length > 200) this.output.splice(0, this.output.length - 200)
    if (cv(this.config.debug, false)) this.logger.log?.(`[dsh-artex] ${redactSecrets(text).trim()}`)
  }

  outputText() {
    return redactSecrets(this.output.join(''), [this.password()])
  }

  async docker(args, { timeout = 120_000, env } = {}) {
    try {
      const { stdout, stderr } = await execFileAsync('docker', args, {
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, ...env },
      })
      return `${stdout || ''}${stderr || ''}`
    } catch (error) {
      const detail = redactSecrets(
        `${error?.stdout || ''}${error?.stderr || ''}${error?.message || error}`,
        [this.password()],
      )
      throw new ArtexError(`docker ${args.join(' ')} failed: ${detail}`, {
        code: 'ARTEX_DOCKER_FAILED',
      })
    }
  }

  async compose(args, options) {
    return await this.docker(
      ['compose', '-f', this.composeFile, '-p', this.projectName, ...args],
      options,
    )
  }

  composeEnv() {
    const { port } = endpointParts(this.endpoint)
    const artexDir = cv(this.config.artexDir, '')
    if (!artexDir) {
      throw new ArtexError(
        'runtime=docker requires config.artexDir pointing at an ARTEX checkout (the directory containing Dockerfile).',
        { code: 'ARTEX_CONFIG' },
      )
    }
    if (!existsSync(join(artexDir, 'Dockerfile'))) {
      throw new ArtexError(
        `ARTEX checkout not found at ${artexDir} (no Dockerfile). Set artexDir in the dsh-artex config.`,
        { code: 'ARTEX_CONFIG' },
      )
    }
    const password = process.env.POSTGRES_PASSWORD || readState().postgresPassword || randomPassword()
    if (!readState().postgresPassword) {
      writePrivateJson(this.stateFile, { ...readState(), postgresPassword: password })
    }
    return {
      ARTEX_DIR: String(resolve(artexDir)).replace(/\\/g, '/'),
      ARTEX_PORT: String(port),
      ARTEX_PROXY_PORT: String(cv(this.config.proxyPort, 8788)),
      POSTGRES_PASSWORD: password,
      ARTEX_SECRET_KEY: process.env.ARTEX_SECRET_KEY || '',
      ARTEX_TASK_BUDGET_TOKENS: process.env.ARTEX_TASK_BUDGET_TOKENS || '',
      ARTEX_TASK_BUDGET_TURNS: process.env.ARTEX_TASK_BUDGET_TURNS || '',
      ARTEX_NOISE_PROFILE: cv(this.config.noiseProfile, ''),
      ARTEX_TARGET_USER_AGENT: cv(this.config.targetUserAgent, ''),
    }
  }

  async health() {
    try {
      const data = await this.client.health()
      return { ok: Boolean(data?.ok), version: data?.version || '', error: '' }
    } catch (error) {
      return { ok: false, version: '', error: error?.message || String(error) }
    }
  }

  async waitHealthy({ timeoutMs = 600_000, intervalMs = 2_000 } = {}) {
    const deadline = Date.now() + timeoutMs
    let last = ''
    while (Date.now() < deadline) {
      const health = await this.health()
      if (health.ok) return health
      last = health.error
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    throw new ArtexError(
      `ARTEX did not become healthy at ${this.endpoint} within ${Math.round(timeoutMs / 1000)}s: ${last}`,
      { code: 'ARTEX_START_TIMEOUT' },
    )
  }

  async ensure({ signal, force = false } = {}) {
    if (this.state === 'running') {
      const health = await this.health()
      if (health.ok) return { state: 'running', mode: this.runtime, health }
    }
    // A previous start can fail after the child is already healthy (for
    // example a transient setup-token read). Reuse that child instead of
    // spawning a second process on the same port.
    if (this.runtime === 'binary' && this.child) {
      const health = await this.health()
      if (health.ok) {
        try {
          await this.#ensureAuth()
          this.state = 'running'
          this.error = ''
          return { state: 'running', mode: 'binary', health, note: 'reused the running child' }
        } catch (error) {
          this.state = 'error'
          this.error = error?.message || String(error)
          throw error
        }
      }
    }
    if (this.starting) return await this.starting
    this.starting = this.#ensure(signal, force).finally(() => {
      this.starting = null
    })
    return await this.starting
  }

  async #ensure(signal, force) {
    if (this.runtime === 'external') {
      const health = await this.waitHealthy({ timeoutMs: cv(this.config.startTimeoutMs, 30_000) })
      this.state = 'running'
      return { state: 'running', mode: 'external', health }
    }
    if (!force && !cv(this.config.autoStart, false)) {
      const health = await this.health()
      if (health.ok) {
        this.state = 'running'
        return { state: 'running', mode: this.runtime, health, note: 'autoStart is off; using the existing instance' }
      }
      throw new ArtexError(
        `ARTEX is not reachable at ${this.endpoint}, and autoStart is disabled in the dsh-artex config. ` +
        'Set autoStart: true (and runtime/artexDir) to let the plugin start it, or start ARTEX yourself.',
        { code: 'ARTEX_AUTOSTART_DISABLED' },
      )
    }

    this.state = 'starting'
    this.error = ''
    try {
      if (this.runtime === 'docker') await this.#startDocker(signal)
      else if (this.runtime === 'binary') await this.#startBinary(signal)
      else throw new ArtexError(`Unknown runtime "${this.runtime}" (external | docker | binary).`, {
        code: 'ARTEX_CONFIG',
      })
      this.startedByPlugin = true
      const health = await this.waitHealthy({ timeoutMs: cv(this.config.startTimeoutMs, 600_000) })
      await this.#ensureAuth()
      this.state = 'running'
      return { state: 'running', mode: this.runtime, health }
    } catch (error) {
      this.state = 'error'
      this.error = error?.message || String(error)
      throw error
    }
  }

  async #startDocker() {
    await this.docker(['version', '--format', '{{.Server.Version}}'], { timeout: 15_000 })
    await this.docker(['compose', 'version'], { timeout: 15_000 })
    this.logger.log?.(`[dsh-artex] docker compose up (project=${this.projectName})`)
    await this.compose(['up', '-d', '--build'], {
      timeout: cv(this.config.buildTimeoutMs, 1_800_000),
      env: this.composeEnv(),
    })
  }

  async #startBinary(signal) {
    if (!cv(this.config.binaryPath, '')) {
      throw new ArtexError('runtime=binary requires config.binaryPath.', { code: 'ARTEX_CONFIG' })
    }
    if (this.child && this.child.exitCode === null) return
    const binary = resolve(cv(this.config.binaryPath, ''))
    if (!existsSync(binary)) {
      throw new ArtexError(`ARTEX binary not found: ${binary}`, { code: 'ARTEX_CONFIG' })
    }
    const { port } = endpointParts(this.endpoint)
    const dataDir = cv(this.config.dataDir, '') || join(stateDir(), 'data')
    mkdirSync(dataDir, { recursive: true })
    const args = ['-addr', this.endpoint.replace(/^https?:\/\//, ''), '-data', dataDir]
    if (cv(this.config.proxyPort, 8788) !== 0) {
      args.push('-proxy', `127.0.0.1:${cv(this.config.proxyPort, 8788)}`)
    } else {
      args.push('-proxy', '')
    }
    this.logger.log?.(`[dsh-artex] spawning ${binary}`)
    this.child = spawn(binary, args, {
      cwd: dataDir,
      windowsHide: true,
      env: {
        ...process.env,
        ARTEX_PG_DSN: process.env.ARTEX_PG_DSN || cv(this.config.pgDsn, '') || '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child.stdout?.on('data', (chunk) => this.rememberOutput(chunk))
    this.child.stderr?.on('data', (chunk) => this.rememberOutput(chunk))
    this.child.on('exit', (code, sig) => {
      this.rememberOutput(`\n[artex] exited code=${code} signal=${sig}\n`)
      if (this.state !== 'stopping') this.state = 'error'
    })
    if (signal) {
      signal.addEventListener('abort', () => this.stop().catch(() => {}), { once: true })
    }
  }

  async #ensureAuth() {
    // A persisted JWT is enough; do not hit the login rate limiter again.
    if (this.client.token) return
    const existing = this.password()
    let loginError = null
    if (existing) {
      this.client.setPassword(existing)
      try {
        await this.client.login()
        return
      } catch (error) {
        if (error?.code !== 'ARTEX_AUTH_FAILED') throw error
        loginError = error
      }
    }

    // Fresh instance: read the one-time setup token from the raw server logs.
    // `logs()` redacts hex-looking secrets, so parse before redaction.
    let raw = ''
    try {
      raw = await this.rawLogs(400)
    } catch {
      raw = this.output.join('')
    }
    let match = raw.match(SETUP_TOKEN_RE)
    if (!match) {
      // Docker may still be flushing the first log lines right after health.
      for (let attempt = 0; attempt < 5 && !match; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        try {
          raw = await this.rawLogs(400)
        } catch {
          raw = this.output.join('')
        }
        match = raw.match(SETUP_TOKEN_RE)
      }
    }
    if (!match) {
      throw new ArtexError(
        loginError
          ? 'ARTEX rejected the stored admin password and no setup token is available. Set ARTEX_ADMIN_PASSWORD to the password chosen at /setup.'
          : 'ARTEX is running but not initialized, and no setup token was found in its logs. ' +
            (this.runtime === 'docker'
              ? 'Run `docker compose logs artex | grep "Setup token"`, then initialize through the ARTEX UI or set ARTEX_ADMIN_PASSWORD.'
              : 'Check the ARTEX process output, then initialize through the ARTEX UI or set ARTEX_ADMIN_PASSWORD.'),
        { code: 'ARTEX_SETUP_TOKEN_MISSING' },
      )
    }
    const password = existing || randomPassword()
    await this.client.init(password, match[1])
    this.savePassword(password)
    this.logger.log?.('[dsh-artex] initialized a fresh ARTEX instance (password stored in ~/.dsh/dsh-artex/state.json)')
  }

  async rawLogs(tail = 200) {
    if (this.runtime === 'docker') {
      return await this.compose(['logs', '--no-color', '--tail', String(tail), 'artex'], {
        timeout: 30_000,
        env: this.composeEnv(),
      })
    }
    if (this.runtime === 'binary') return this.output.join('')
    return 'logs are not managed for runtime=external'
  }

  async logs(tail = 200) {
    return redactSecrets(await this.rawLogs(tail), [this.password()])
  }

  async doctor() {
    const checks = []
    const add = (name, status, detail) => checks.push({ name, status, detail })
    add('runtime', 'ok', this.runtime)
    add('endpoint', 'ok', this.endpoint)
    const health = await this.health()
    add('health', health.ok ? 'ok' : 'error', health.ok ? `version ${health.version || 'unknown'}` : health.error)

    let authOk = false
    try {
      await this.client.ensureAuth()
      authOk = true
      add('auth', 'ok', 'JWT available')
    } catch (error) {
      add('auth', 'error', error?.message || String(error))
    }

    if (authOk) {
      try {
        const llm = await this.client.llmStatus()
        add('llm', llm?.configured ? 'ok' : 'warn', llm?.configured
          ? `${llm.provider}/${llm.model}`
          : 'no LLM provider configured; tasks will stop at model_error')
      } catch (error) {
        add('llm', 'warn', `LLM status read failed: ${error?.message || error}`)
      }
      try {
        const pending = await this.client.listPending()
        add('approvals', pending.length ? 'warn' : 'ok', `${pending.length} pending`)
      } catch (error) {
        add('approvals', 'warn', `pending read failed: ${error?.message || error}`)
      }
    }

    if (this.runtime === 'docker') {
      try {
        const version = await this.docker(['version', '--format', '{{.Server.Version}}'], { timeout: 10_000 })
        add('docker', 'ok', `server ${String(version).trim()}`)
      } catch (error) {
        add('docker', 'error', error?.message || String(error))
      }
      try {
        const compose = await this.docker(['compose', 'version'], { timeout: 10_000 })
        add('docker-compose', 'ok', String(compose).trim().split('\n')[0])
      } catch (error) {
        add('docker-compose', 'error', error?.message || String(error))
      }
      const artexDir = cv(this.config.artexDir, '')
      add('artexDir', artexDir && existsSync(join(artexDir, 'Dockerfile')) ? 'ok' : 'error',
        artexDir || 'not configured (runtime=docker requires the ARTEX checkout)')
      add('composeFile', existsSync(this.composeFile) ? 'ok' : 'error', this.composeFile)
    } else if (this.runtime === 'binary') {
      const binary = cv(this.config.binaryPath, '')
      add('binary', binary && existsSync(resolve(binary)) ? 'ok' : 'error', binary || 'not configured')
      const dsn = process.env.ARTEX_PG_DSN || cv(this.config.pgDsn, '')
      add('postgres', dsn ? 'ok' : 'error', dsn ? 'DSN configured' : 'set ARTEX_PG_DSN or config.pgDsn')
      const dataDir = cv(this.config.dataDir, '') || join(stateDir(), 'data')
      add('dataDir', 'ok', dataDir)
    } else {
      add('external', health.ok ? 'ok' : 'warn', health.ok ? 'reachable' : 'not reachable; start ARTEX separately')
    }

    const failed = checks.filter((check) => check.status === 'error').length
    const warned = checks.filter((check) => check.status === 'warn').length
    return {
      ok: failed === 0,
      summary: `${checks.length - failed - warned} ok, ${warned} warn, ${failed} error`,
      checks,
      sidecar: this.status(),
    }
  }

  async stop() {
    this.state = 'stopping'
    try {
      if (this.runtime === 'docker' && this.startedByPlugin) {
        await this.compose(['stop'], { timeout: 120_000, env: this.composeEnv() })
      } else if (this.runtime === 'binary' && this.child) {
        this.child.kill('SIGTERM')
        const child = this.child
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL')
            resolve()
          }, 5_000)
          child.once('exit', () => {
            clearTimeout(timer)
            resolve()
          })
        })
        this.child = null
      }
      this.state = 'idle'
      this.startedByPlugin = false
      return { state: this.state }
    } catch (error) {
      this.state = 'error'
      this.error = error?.message || String(error)
      throw error
    }
  }

  markConfigChanged() {
    if (this.state === 'starting') return
    this.state = 'idle'
    this.error = ''
    this.startedByPlugin = false
  }

  status() {
    return {
      runtime: this.runtime,
      state: this.state,
      endpoint: this.endpoint,
      uiUrl: this.uiUrl,
      autoStart: Boolean(cv(this.config.autoStart, false)),
      projectName: this.projectName,
      error: this.error,
      pid: this.child?.pid || null,
      dataDir: cv(this.config.dataDir, '') || null,
    }
  }
}

export function touchStateDir() {
  const dir = stateDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

export function stateFileMtime() {
  const file = join(stateDir(), 'state.json')
  return existsSync(file) ? statSync(file).mtimeMs : 0
}
