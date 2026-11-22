// ARTEX REST client used by the Host half.
//
// Design rules:
// - `fetch` and the clock are injectable so tests never touch the network.
// - The JWT lives in memory only. The admin password comes from the
//   environment (ARTEX_ADMIN_PASSWORD) or the sidecar's private state file.
// - A 401 re-logs in once, then surfaces a structured auth error.
// - Every request has a timeout; caller cancellation is forwarded.

export class ArtexError extends Error {
  constructor(message, { status = 0, code = 'ARTEX_ERROR', body = null } = {}) {
    super(message)
    this.name = 'ArtexError'
    this.status = status
    this.code = code
    this.body = body
  }
}

export function normalizeBaseUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) throw new ArtexError('ARTEX endpoint is empty.', { code: 'ARTEX_CONFIG' })
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new ArtexError(`ARTEX endpoint is not a valid URL: ${raw}`, { code: 'ARTEX_CONFIG' })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ArtexError('ARTEX endpoint must be an http(s) URL.', { code: 'ARTEX_CONFIG' })
  }
  return url.toString().replace(/\/+$/, '')
}

function combineSignals(signal, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return signal
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeout
  return AbortSignal.any([signal, timeout])
}

function truncate(value, max = 2000) {
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export class ArtexClient {
  constructor({
    baseUrl,
    username = 'ARTEX',
    password = '',
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
    logger = console,
    token = '',
    onToken = null,
  }) {
    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.username = username || 'ARTEX'
    this.password = String(password || '')
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
    this.logger = logger
    this.token = String(token || '')
    this.onToken = typeof onToken === 'function' ? onToken : null
  }

  get authenticated() {
    return Boolean(this.token)
  }

  setPassword(password) {
    this.password = String(password || '')
    this.token = ''
  }

  setBaseUrl(baseUrl) {
    this.baseUrl = normalizeBaseUrl(baseUrl)
  }

  setToken(token) {
    this.token = String(token || '')
    this.onToken?.(this.token)
  }

  url(path) {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  }

  async request(method, path, {
    body,
    auth = true,
    signal,
    timeoutMs = this.timeoutMs,
    retryAuth = true,
    raw = false,
  } = {}) {
    if (auth && !this.token && this.password) {
      await this.login(signal)
    }
    const headers = { accept: 'application/json' }
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    if (body !== undefined && !isForm) headers['content-type'] = 'application/json'
    if (auth && this.token) headers.authorization = `Bearer ${this.token}`

    const response = await this.fetchImpl(this.url(path), {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: combineSignals(signal, timeoutMs),
    }).catch((error) => {
      if (error?.name === 'TimeoutError') {
        throw new ArtexError(`ARTEX request timed out after ${timeoutMs}ms: ${method} ${path}`, {
          code: 'ARTEX_TIMEOUT',
        })
      }
      if (error?.name === 'AbortError') throw error
      throw new ArtexError(`ARTEX is unreachable at ${this.baseUrl}: ${error?.message || error}`, {
        code: 'ARTEX_UNREACHABLE',
      })
    })

    if (response.status === 401 && auth && retryAuth && this.password) {
      this.token = ''
      await this.login(signal)
      return await this.request(method, path, { body, auth, signal, timeoutMs, retryAuth: false, raw })
    }

    const text = await response.text()
    let parsed = text
    const contentType = response.headers?.get?.('content-type') || ''
    if (contentType.includes('application/json') && text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }

    if (!response.ok) {
      const detail = typeof parsed === 'string'
        ? truncate(parsed, 800)
        : truncate(parsed?.error || parsed, 800)
      const code = response.status === 401
        ? 'ARTEX_AUTH_FAILED'
        : response.status === 429
          ? 'ARTEX_RATE_LIMITED'
          : `ARTEX_HTTP_${response.status}`
      const hint = response.status === 401
        ? ' Check ARTEX_ADMIN_PASSWORD (or initialize the instance with the setup token).'
        : response.status === 429
          ? ' ARTEX login is rate-limited (10/min/IP; the block can last 15 minutes). Wait, or restart the ARTEX process to reset its in-memory limiter.'
          : ''
      throw new ArtexError(`ARTEX ${method} ${path} failed (${response.status}): ${detail}.${hint}`, {
        status: response.status,
        code,
        body: parsed,
      })
    }

    return raw ? { text, response } : parsed
  }

  async authStatus(signal) {
    return await this.request('GET', '/api/auth/status', { auth: false, signal })
  }

  async login(signal) {
    if (!this.password) {
      throw new ArtexError(
        'ARTEX admin password is not configured. Set ARTEX_ADMIN_PASSWORD in the DSH process environment, or run the dsh-artex "start" action to initialize a fresh Docker instance.',
        { code: 'ARTEX_AUTH_CONFIG' },
      )
    }
    let data
    try {
      data = await this.request('POST', '/api/auth/login', {
        auth: false,
        body: { username: this.username, password: this.password },
        signal,
        retryAuth: false,
      })
    } catch (error) {
      if (error instanceof ArtexError && error.status === 401) {
        throw new ArtexError(
          'ARTEX rejected the admin password. Set ARTEX_ADMIN_PASSWORD to the password chosen at /setup, or re-initialize a fresh instance.',
          { status: 401, code: 'ARTEX_AUTH_FAILED' },
        )
      }
      throw error
    }
    if (!data?.token) {
      throw new ArtexError('ARTEX login succeeded but returned no token.', { code: 'ARTEX_AUTH_PROTOCOL' })
    }
    this.setToken(data.token)
    return this.token
  }

  async init(password, setupToken, signal) {
    const data = await this.request('POST', '/api/auth/init', {
      auth: false,
      body: { password, setup_token: setupToken },
      signal,
      retryAuth: false,
    })
    if (data?.token) this.setToken(data.token)
    this.password = password
    return data
  }

  async ensureAuth(signal) {
    if (this.token) return
    await this.login(signal)
  }

  // Open a streaming response (SSE). The caller owns the reader and abort.
  async stream(path, { signal, headers = {} } = {}) {
    if (!this.token && this.password) await this.login(signal)
    const request = () => this.fetchImpl(this.url(path), {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...headers,
      },
      signal,
    })
    let response = await request().catch((error) => {
      if (error?.name === 'AbortError') throw error
      throw new ArtexError(`ARTEX stream is unreachable at ${this.baseUrl}: ${error?.message || error}`, {
        code: 'ARTEX_UNREACHABLE',
      })
    })
    if (response.status === 401 && this.password) {
      this.token = ''
      await this.login(signal)
      response = await request()
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new ArtexError(`ARTEX stream failed (${response.status}): ${truncate(text, 500)}`, {
        status: response.status,
        code: response.status === 401 ? 'ARTEX_AUTH_FAILED' : `ARTEX_HTTP_${response.status}`,
      })
    }
    return response
  }

  async health(signal) {
    return await this.request('GET', '/api/health', { auth: false, signal })
  }

  async stats(taskId, signal) {
    const query = taskId ? `?task=${encodeURIComponent(taskId)}` : ''
    return await this.request('GET', `/api/stats${query}`, { signal })
  }

  async listTasks(signal) {
    const data = await this.request('GET', '/api/tasks', { signal })
    return Array.isArray(data?.tasks) ? data.tasks : []
  }

  async getTask(id, signal) {
    return await this.request('GET', `/api/tasks/${encodeURIComponent(id)}`, { signal })
  }

  async createTask(payload, signal) {
    return await this.request('POST', '/api/tasks', { body: payload, signal })
  }

  async controlTask(id, action, signal) {
    return await this.request('POST', `/api/tasks/${encodeURIComponent(id)}/control`, {
      body: { action },
      signal,
    })
  }

  async deleteTask(id, options = {}, signal) {
    return await this.request('DELETE', `/api/tasks/${encodeURIComponent(id)}`, {
      body: options,
      signal,
    })
  }

  async archiveTask(id, signal) {
    return await this.request('POST', `/api/tasks/${encodeURIComponent(id)}/archive`, { signal })
  }

  async listScope(taskId, signal) {
    const data = await this.request('GET', `/api/tasks/${encodeURIComponent(taskId)}/scope`, { signal })
    return Array.isArray(data?.scope) ? data.scope : []
  }

  async deleteScope(taskId, scopeId, signal) {
    return await this.request(
      'DELETE',
      `/api/tasks/${encodeURIComponent(taskId)}/scope/${encodeURIComponent(scopeId)}`,
      { signal },
    )
  }

  async listTaskInterceptRules(taskId, signal) {
    const data = await this.request('GET', `/api/tasks/${encodeURIComponent(taskId)}/intercept-rules`, { signal })
    return Array.isArray(data?.rules) ? data.rules : []
  }

  async addTaskInterceptRule(taskId, payload, signal) {
    return await this.request('POST', `/api/tasks/${encodeURIComponent(taskId)}/intercept-rules`, { body: payload, signal })
  }

  async deleteTaskInterceptRule(taskId, ruleId, signal) {
    return await this.request(
      'DELETE',
      `/api/tasks/${encodeURIComponent(taskId)}/intercept-rules/${encodeURIComponent(ruleId)}`,
      { signal },
    )
  }

  async toggleTaskInterceptRule(taskId, ruleId, signal) {
    return await this.request(
      'POST',
      `/api/tasks/${encodeURIComponent(taskId)}/intercept-rules/${encodeURIComponent(ruleId)}/toggle`,
      { body: {}, signal },
    )
  }

  async listTaskCredentials(taskId, signal) {
    const data = await this.request('GET', `/api/tasks/${encodeURIComponent(taskId)}/credentials`, { signal })
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.credentials)) return data.credentials
    return []
  }

  async addTaskCredential(taskId, payload, signal) {
    return await this.request('POST', `/api/tasks/${encodeURIComponent(taskId)}/credentials`, { body: payload, signal })
  }

  async deleteTaskCredential(taskId, credentialId, signal) {
    return await this.request(
      'DELETE',
      `/api/tasks/${encodeURIComponent(taskId)}/credentials/${encodeURIComponent(credentialId)}`,
      { signal },
    )
  }

  async listTaskCategories(signal) {
    const data = await this.request('GET', '/api/task-categories', { signal })
    return Array.isArray(data?.categories) ? data.categories : []
  }

  async createTaskCategory(name, signal) {
    return await this.request('POST', '/api/task-categories', { body: { name }, signal })
  }

  async deleteTaskCategory(id, signal) {
    return await this.request('DELETE', `/api/task-categories/${encodeURIComponent(id)}`, { signal })
  }

  async listTaskTemplates(signal) {
    const data = await this.request('GET', '/api/task-templates', { signal })
    return Array.isArray(data?.templates) ? data.templates : []
  }

  async createTaskTemplate(payload, signal) {
    return await this.request('POST', '/api/task-templates', { body: payload, signal })
  }

  async updateTaskTemplate(id, payload, signal) {
    return await this.request('PATCH', `/api/task-templates/${encodeURIComponent(id)}`, { body: payload, signal })
  }

  async deleteTaskTemplate(id, signal) {
    return await this.request('DELETE', `/api/task-templates/${encodeURIComponent(id)}`, { signal })
  }

  async listGoals(taskId, signal) {
    const data = await this.request('GET', `/api/tasks/${encodeURIComponent(taskId)}/goals`, { signal })
    return Array.isArray(data?.goals) ? data.goals : []
  }

  async addGoal(taskId, text, vulnclass, signal) {
    return await this.request('POST', `/api/tasks/${encodeURIComponent(taskId)}/goals`, {
      body: { text, vulnclass: vulnclass || '' }, signal,
    })
  }

  async deleteGoal(taskId, goalId, signal) {
    return await this.request(
      'DELETE',
      `/api/tasks/${encodeURIComponent(taskId)}/goals/${encodeURIComponent(goalId)}`,
      { signal },
    )
  }

  async listConstraints(taskId, signal) {
    const data = await this.request('GET', `/api/tasks/${encodeURIComponent(taskId)}/constraints`, { signal })
    return Array.isArray(data?.constraints) ? data.constraints : []
  }

  async addConstraint(taskId, text, kind, signal) {
    return await this.request('POST', `/api/tasks/${encodeURIComponent(taskId)}/constraints`, {
      body: { text, kind }, signal,
    })
  }

  async deleteConstraint(taskId, constraintId, signal) {
    return await this.request(
      'DELETE',
      `/api/tasks/${encodeURIComponent(taskId)}/constraints/${encodeURIComponent(constraintId)}`,
      { signal },
    )
  }

  async addScope(taskId, kind, value, reason, signal) {
    return await this.request('POST', `/api/tasks/${encodeURIComponent(taskId)}/scope`, {
      body: { kind, value, reason: reason || 'dsh-artex' },
      signal,
    })
  }

  async listIntents(taskId, signal) {
    const data = await this.request(
      'GET',
      `/api/exploration/intents?task=${encodeURIComponent(taskId)}`,
      { signal },
    )
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.items)) return data.items
    if (Array.isArray(data?.intents)) return data.intents
    return []
  }

  async controlIntent(taskId, intentId, action, mode = 'soft', signal) {
    return await this.request(
      'POST',
      `/api/tasks/${encodeURIComponent(taskId)}/intents/${encodeURIComponent(intentId)}/control`,
      { body: { action, mode }, signal },
    )
  }

  async activity(taskId, { since = 0, limit = 300, intent } = {}, signal) {
    const query = new URLSearchParams({
      task: String(taskId),
      since: String(since),
      limit: String(limit),
    })
    if (intent) query.set('intent', String(intent))
    return await this.request('GET', `/api/exploration/activity?${query}`, { signal })
  }

  async graph(taskId, signal) {
    return await this.request(
      'GET',
      `/api/exploration/graph?task=${encodeURIComponent(taskId)}`,
      { signal },
    )
  }

  async frontier(taskId, limit = 50, signal) {
    return await this.request(
      'GET',
      `/api/exploration/frontier?task=${encodeURIComponent(taskId)}&limit=${limit}`,
      { signal },
    )
  }

  async listFindings(taskId, signal) {
    const data = await this.request(
      'GET',
      `/api/exploration/findings?task=${encodeURIComponent(taskId)}`,
      { signal },
    )
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.items)) return data.items
    if (Array.isArray(data?.findings)) return data.findings
    return []
  }

  async getFinding(id, signal) {
    return await this.request('GET', `/api/exploration/findings/${encodeURIComponent(id)}`, { signal })
  }

  async report(taskId, signal) {
    const { text } = await this.request(
      'GET',
      `/api/report?task=${encodeURIComponent(taskId)}`,
      { signal, raw: true },
    )
    return text
  }

  async traffic(params = {}, signal) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
    }
    return await this.request('GET', `/api/traffic?${query}`, { signal })
  }

  async purgeTraffic({ host, all } = {}, signal) {
    if (all) return await this.request('DELETE', '/api/traffic/all', { signal })
    if (host) return await this.request('DELETE', `/api/traffic?host=${encodeURIComponent(host)}`, { signal })
    throw new ArtexError('purgeTraffic requires host or all.', { code: 'ARTEX_CONFIG' })
  }

  async exchange(id, signal) {
    return await this.request(
      'GET',
      `/api/traffic/exchange?id=${encodeURIComponent(id)}`,
      { signal },
    )
  }

  async llmStatus(signal) {
    return await this.request('GET', '/api/llm', { signal })
  }

  async listLLMProfiles(signal) {
    const data = await this.request('GET', '/api/llm/profiles', { signal })
    return Array.isArray(data?.profiles) ? data.profiles : []
  }

  async listLLMModels({ provider, baseUrl, apiKey, proxy, profileId }, signal) {
    const body = { provider, base_url: baseUrl }
    if (apiKey) body.api_key = apiKey
    if (proxy) body.proxy = proxy
    if (profileId !== undefined) body.profile_id = profileId
    return await this.request('POST', '/api/llm/models', { body, signal, timeoutMs: 90_000 })
  }

  async saveLLMProfile(profile, signal) {
    return await this.request('POST', '/api/llm/profiles', { body: profile, signal })
  }

  async deleteLLMProfile(id, signal) {
    return await this.request(
      'DELETE',
      `/api/llm/profiles/${encodeURIComponent(id)}`,
      { signal },
    )
  }

  async testLLM(payload, signal) {
    return await this.request('POST', '/api/llm/test', { body: payload, signal, timeoutMs: 120_000 })
  }

  async llmPool(signal) {
    return await this.request('GET', '/api/llm/pool', { signal })
  }

  async resetLLMPool(id = 0, signal) {
    return await this.request('POST', '/api/llm/pool/reset', { body: { id: Number(id) || 0 }, signal })
  }

  async activateLLMProfile(id, signal) {
    return await this.request('POST', '/api/llm/profiles/active', {
      body: { id: Number(id) },
      signal,
    })
  }

  async listAssets({ taskId, type, limit = 200, offset = 0 } = {}, signal) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (taskId) query.set('task_id', String(taskId))
    if (type) query.set('type', type)
    return await this.request('GET', `/api/assets?${query}`, { signal })
  }

  async assetCounts(taskId, signal) {
    const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : ''
    return await this.request('GET', `/api/assets/counts${query}`, { signal })
  }

  async coverage(taskId, signal) {
    return await this.request(
      'GET',
      `/api/tasks/${encodeURIComponent(taskId)}/coverage`,
      { signal },
    )
  }

  async settings(signal) {
    return await this.request('GET', '/api/settings', { signal })
  }

  async updateSettings(patch, signal) {
    return await this.request('PUT', '/api/settings', { body: patch, signal })
  }

  async patchFinding(id, patch, signal) {
    return await this.request(
      'PATCH',
      `/api/exploration/findings/${encodeURIComponent(id)}`,
      { body: patch, signal },
    )
  }

  async download(path, signal) {
    if (!this.token && this.password) await this.login(signal)
    const response = await this.fetchImpl(this.url(path), {
      method: 'GET',
      headers: {
        accept: '*/*',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      signal,
    })
    if (response.status === 401 && this.password) {
      this.token = ''
      await this.login(signal)
      return await this.download(path, signal)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new ArtexError(`ARTEX download failed (${response.status}): ${truncate(text, 500)}`, {
        status: response.status,
        code: `ARTEX_HTTP_${response.status}`,
      })
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers?.get?.('content-type') || 'application/octet-stream',
      contentDisposition: response.headers?.get?.('content-disposition') || '',
    }
  }

  async listFindingRetests(id, signal) {
    const data = await this.request(
      'GET',
      `/api/exploration/findings/${encodeURIComponent(id)}/retests`,
      { signal },
    )
    return Array.isArray(data?.retests) ? data.retests : []
  }

  async startFindingRetest(id, notes, signal) {
    return await this.request(
      'POST',
      `/api/exploration/findings/${encodeURIComponent(id)}/retests`,
      { body: { notes: notes || '' }, signal, timeoutMs: 120_000 },
    )
  }

  async activeFindingRetests(signal) {
    const data = await this.request('GET', '/api/exploration/findings/retests/active', { signal })
    return Array.isArray(data?.retests) ? data.retests : []
  }

  async findingTraffic(id, signal) {
    return await this.request(
      'GET',
      `/api/exploration/findings/${encodeURIComponent(id)}/traffic`,
      { signal },
    )
  }

  async bindFindingTraffic(id, refs, signal) {
    return await this.request(
      'POST',
      `/api/exploration/findings/${encodeURIComponent(id)}/traffic`,
      { body: { traffic_refs: refs }, signal },
    )
  }

  async listPending(signal) {
    const data = await this.request('GET', '/api/intercept/pending', { signal })
    return Array.isArray(data?.pending) ? data.pending : []
  }

  async decideBatch(ids, decision, signal) {
    return await this.request('POST', '/api/intercept/pending/batch-decide', {
      body: { ids, decision },
      signal,
    })
  }

  async alwaysAllow(approvalId, signal) {
    return await this.request(
      'POST',
      `/api/intercept/pending/${encodeURIComponent(approvalId)}/always-allow`,
      { body: {}, signal },
    )
  }

  async approvalHistory(params = {}, signal) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
    }
    return await this.request('GET', `/api/intercept/history?${query}`, { signal })
  }

  async decide(approvalId, decision, signal) {
    return await this.request(
      'POST',
      `/api/intercept/pending/${encodeURIComponent(approvalId)}/decide`,
      { body: { decision }, signal },
    )
  }

  async saveMCP(server, signal) {
    return await this.request('POST', '/api/mcp', { body: server, signal, timeoutMs: 120_000 })
  }

  async createSkill(payload, signal) {
    return await this.request('POST', '/api/skills', { body: payload, signal })
  }

  async uploadSkill(zip, filename, overwrite = false, signal) {
    const form = new FormData()
    form.append('file', new Blob([zip], { type: 'application/zip' }), filename || 'skill.zip')
    const query = overwrite ? '?overwrite=true' : ''
    return await this.request('POST', `/api/skills/upload${query}`, {
      body: form,
      signal,
      timeoutMs: 120_000,
    })
  }

  async deleteSkill(name, signal) {
    return await this.request('DELETE', `/api/skills/${encodeURIComponent(name)}`, { signal })
  }

  async writeSkillFile(name, file, content, signal) {
    return await this.request(
      'PUT',
      `/api/skills/${encodeURIComponent(name)}/files/${file.split('/').map(encodeURIComponent).join('/')}`,
      { body: { content }, signal },
    )
  }

  async workspaceWrite(path, content, signal) {
    return await this.request('POST', '/api/workspace/write', { body: { path, content }, signal })
  }

  async getAgent(key, signal) {
    return await this.request('GET', `/api/agents/${encodeURIComponent(key)}`, { signal })
  }

  async saveAgentPrompt(key, template, note, signal) {
    return await this.request(
      'PUT',
      `/api/agents/${encodeURIComponent(key)}/prompt`,
      { body: { template, note }, signal },
    )
  }

  async resetAgentPrompt(key, signal) {
    return await this.request(
      'POST',
      `/api/agents/${encodeURIComponent(key)}/prompt/reset`,
      { body: {}, signal },
    )
  }

  async getAgentVisibility(key, signal) {
    return await this.request('GET', `/api/agents/${encodeURIComponent(key)}/visibility`, { signal })
  }

  async saveAgentVisibility(key, payload, signal) {
    return await this.request('PUT', `/api/agents/${encodeURIComponent(key)}/visibility`, { body: payload, signal })
  }

  async saveAgentConfig(key, payload, signal) {
    return await this.request('PUT', `/api/agents/${encodeURIComponent(key)}/config`, { body: payload, signal })
  }

  async createAgent(payload, signal) {
    return await this.request('POST', '/api/agents', { body: payload, signal })
  }

  async updateAgent(key, payload, signal) {
    return await this.request('PATCH', `/api/agents/${encodeURIComponent(key)}`, { body: payload, signal })
  }

  async deleteAgent(key, signal) {
    return await this.request('DELETE', `/api/agents/${encodeURIComponent(key)}`, { signal })
  }

  async listTriggers(key, signal) {
    const data = await this.request('GET', `/api/agents/${encodeURIComponent(key)}/triggers`, { signal })
    return Array.isArray(data?.triggers) ? data.triggers : []
  }

  async createTrigger(key, payload, signal) {
    return await this.request('POST', `/api/agents/${encodeURIComponent(key)}/triggers`, { body: payload, signal })
  }

  async updateTrigger(id, payload, signal) {
    return await this.request('PATCH', `/api/triggers/${encodeURIComponent(id)}`, { body: payload, signal })
  }

  async deleteTrigger(id, signal) {
    return await this.request('DELETE', `/api/triggers/${encodeURIComponent(id)}`, { signal })
  }

  async listTools(signal) {
    const data = await this.request('GET', '/api/tools', { signal })
    return Array.isArray(data?.tools) ? data.tools : []
  }

  async updateTool(key, payload, signal) {
    return await this.request('PUT', `/api/tools/${encodeURIComponent(key)}`, { body: payload, signal })
  }

  async resetTool(key, signal) {
    return await this.request('POST', `/api/tools/${encodeURIComponent(key)}/reset`, { body: {}, signal })
  }

  async createCustomTool(payload, signal) {
    return await this.request('POST', '/api/tools/custom', { body: payload, signal })
  }

  async updateCustomTool(key, payload, signal) {
    return await this.request('PUT', `/api/tools/custom/${encodeURIComponent(key)}`, { body: payload, signal })
  }

  async deleteCustomTool(key, signal) {
    return await this.request('DELETE', `/api/tools/custom/${encodeURIComponent(key)}`, { signal })
  }

  async testCustomTool(payload, signal) {
    return await this.request('POST', '/api/tools/custom/test', { body: payload, signal, timeoutMs: 600_000 })
  }

  async createNotifyChannel(payload, signal) {
    return await this.request('POST', '/api/notify/channels', { body: payload, signal })
  }

  async updateNotifyChannel(id, payload, signal) {
    return await this.request('PATCH', `/api/notify/channels/${encodeURIComponent(id)}`, { body: payload, signal })
  }

  async listNotifyDeliveries({ state = '', event_kind = '', channel_id = '', page = 1, page_size = 50 } = {}, signal) {
    const query = new URLSearchParams({
      state, event_kind, channel_id: channel_id === '' ? '' : String(channel_id),
      page: String(page), page_size: String(page_size),
    })
    return await this.request('GET', `/api/notify/deliveries?${query}`, { signal })
  }

  async retryNotifyDelivery(id, signal) {
    return await this.request('POST', `/api/notify/deliveries/${encodeURIComponent(id)}/retry`, { body: {}, signal })
  }

  async testNotifyChannel(id, signal) {
    return await this.request('POST', `/api/notify/channels/${encodeURIComponent(id)}/test`, { body: {}, signal, timeoutMs: 120_000 })
  }

  async deleteNotifyChannel(id, signal) {
    return await this.request('DELETE', `/api/notify/channels/${encodeURIComponent(id)}`, { signal })
  }

  async listMCP(signal) {
    const data = await this.request('GET', '/api/mcp', { signal })
    return Array.isArray(data?.servers) ? data.servers : []
  }

  async mcpTools(id, signal) {
    return await this.request('GET', `/api/mcp/${encodeURIComponent(id)}/tools`, { signal })
  }

  async refreshMCP(id, signal) {
    return await this.request('POST', `/api/mcp/${encodeURIComponent(id)}/refresh`, { body: {}, signal, timeoutMs: 120_000 })
  }

  async deleteMCP(id, signal) {
    return await this.request('DELETE', `/api/mcp/${encodeURIComponent(id)}`, { signal })
  }

  async listSkills(signal) {
    const data = await this.request('GET', '/api/skills', { signal })
    return Array.isArray(data?.skills) ? data.skills : []
  }

  async skillFiles(name, signal) {
    return await this.request('GET', `/api/skills/${encodeURIComponent(name)}/files`, { signal })
  }

  async skillFile(name, file, signal) {
    return await this.request(
      'GET',
      `/api/skills/${encodeURIComponent(name)}/files/${file.split('/').map(encodeURIComponent).join('/')}`,
      { signal },
    )
  }

  async listAgents(signal) {
    const data = await this.request('GET', '/api/agents', { signal })
    return Array.isArray(data?.agents) ? data.agents : []
  }

  async listNotifyChannels(signal) {
    const data = await this.request('GET', '/api/notify/channels', { signal })
    return Array.isArray(data?.channels) ? data.channels : []
  }

  async logs({ limit = 100 } = {}, signal) {
    return await this.request('GET', `/api/logs?limit=${limit}`, { signal })
  }

  async workspaceList(path = '', signal) {
    return await this.request('GET', `/api/workspace/list?path=${encodeURIComponent(path)}`, { signal })
  }

  async workspaceRead(path, signal) {
    return await this.request('GET', `/api/workspace/read?path=${encodeURIComponent(path)}`, { signal })
  }

  async listConversations(signal) {
    const data = await this.request('GET', '/api/conversations', { signal })
    return Array.isArray(data?.conversations) ? data.conversations : []
  }

  async createConversation(payload, signal) {
    return await this.request('POST', '/api/conversations', { body: payload, signal })
  }

  async conversationMessages(id, { since, limit = 200 } = {}, signal) {
    const query = new URLSearchParams({ limit: String(limit) })
    if (since !== undefined) query.set('since', String(since))
    return await this.request(
      'GET',
      `/api/conversations/${encodeURIComponent(id)}/messages?${query}`,
      { signal },
    )
  }

  async sendConversationMessage(id, message, signal) {
    return await this.request(
      'POST',
      `/api/conversations/${encodeURIComponent(id)}/messages`,
      { body: { message }, signal, timeoutMs: 60_000 },
    )
  }

  async stopConversation(id, signal) {
    return await this.request(
      'POST',
      `/api/conversations/${encodeURIComponent(id)}/stop`,
      { body: {}, signal },
    )
  }

  async conversationMessageDetail(id, seq, signal) {
    return await this.request(
      'GET',
      `/api/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(seq)}`,
      { signal },
    )
  }

  async chat(taskId, message, signal) {
    return await this.request('POST', `/api/chat?task=${encodeURIComponent(taskId)}`, {
      body: { message },
      signal,
      timeoutMs: 60_000,
    })
  }

  async createTaskWithScope(payload, scopes = [], signal) {
    const task = await this.createTask(payload, signal)
    const scopeErrors = []
    for (const scope of scopes) {
      try {
        await this.addScope(task.id, scope.kind, scope.value, scope.reason, signal)
      } catch (error) {
        scopeErrors.push({
          kind: scope.kind,
          value: scope.value,
          error: error?.message || String(error),
        })
      }
    }
    return { task, scopeErrors }
  }

  async cancelTask(taskId, signal) {
    const notes = []
    try {
      await this.controlTask(taskId, 'pause', signal)
      notes.push('task paused')
    } catch (error) {
      notes.push(`pause skipped: ${error?.message || error}`)
    }
    const intents = await this.listIntents(taskId, signal)
    const active = intents.filter((intent) => ['open', 'running', 'paused'].includes(intent?.state))
    let cancelled = 0
    for (const intent of active) {
      if (!intent?.id) continue
      try {
        await this.controlIntent(taskId, intent.id, 'cancel', 'hard', signal)
        cancelled += 1
      } catch (error) {
        notes.push(`intent ${intent.id} cancel failed: ${error?.message || error}`)
      }
    }
    notes.push(`${cancelled}/${active.length} intents cancelled`)
    return { cancelled, total: active.length, notes }
  }

  async waitForTask(taskId, { timeoutMs = 120_000, intervalMs = 3_000, signal } = {}) {
    const deadline = Date.now() + timeoutMs
    let last = null
    while (Date.now() < deadline) {
      last = await this.getTask(taskId, signal)
      if (['done', 'failed', 'timeout'].includes(last?.status)) return last
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now())))
        if (signal) {
          if (signal.aborted) {
            clearTimeout(timer)
            reject(signal.reason || new Error('aborted'))
            return
          }
          const onAbort = () => {
            clearTimeout(timer)
            reject(signal.reason || new Error('aborted'))
          }
          signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    }
    return last
  }
}
