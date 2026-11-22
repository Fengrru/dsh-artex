// Same-origin HTTP routes for the dsh-artex panel.
//
// DSH's web server already gates the page with its own connection token; the
// per-request `connection.requestRejection` check is defence in depth and is
// skipped only when that optional service is absent (the 0.2.x default).
// All write routes additionally require same-origin Fetch metadata.

import { normalizePending, normalizeTask } from './tools.js'
import { cv } from './config.js'

const BASE = '/artex'

export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false
  return connection.requestRejection({ headers: req.headers })
}

export function sameOriginRejection(req) {
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return 403
  const origin = req.headers.origin
  if (origin) {
    const host = req.headers.host
    if (origin !== `http://${host}` && origin !== `https://${host}`) return 403
  }
  return false
}

export function readJson(req, max = 64 * 1024, methods = ['POST']) {
  return new Promise((resolve, reject) => {
    if (!methods.includes(req.method)) {
      return reject(Object.assign(new Error(`only ${methods.join('/')} is accepted`), { status: 405 }))
    }
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
      return reject(Object.assign(new Error('content-type must be application/json'), { status: 415 }))
    }
    const crossSite = sameOriginRejection(req)
    if (crossSite) return reject(Object.assign(new Error('cross-site request refused'), { status: crossSite }))
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > max) {
        req.destroy()
        reject(Object.assign(new Error('request body too large'), { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

// Raw-body reader for the skill zip upload. The browser sends the archive as
// application/zip so the Host half can forward it without a base64 round-trip.
export function readBinary(req, max = 20 * 1024 * 1024, methods = ['POST']) {
  return new Promise((resolve, reject) => {
    if (!methods.includes(req.method)) {
      return reject(Object.assign(new Error(`only ${methods.join('/')} is accepted`), { status: 405 }))
    }
    const crossSite = sameOriginRejection(req)
    if (crossSite) return reject(Object.assign(new Error('cross-site request refused'), { status: crossSite }))
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > max) {
        req.destroy()
        reject(Object.assign(new Error('request body too large'), { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function notifyPayload(body, patch = false) {
  const payload = {
    name: String(body.name || ''),
    kind: String(body.kind || ''),
    enabled: body.enabled !== false,
    mode: body.mode === 'digest' ? 'digest' : 'realtime',
    config: body.config && typeof body.config === 'object' ? body.config : {},
  }
  if (body.rate_per_min !== undefined && body.rate_per_min !== '') {
    const rate = Number(body.rate_per_min)
    if (Number.isFinite(rate) && rate >= 0) payload.rate_per_min = Math.trunc(rate)
  }
  if (body.filter && typeof body.filter === 'object') {
    payload.filter = {
      min_severity: String(body.filter.min_severity || ''),
      task_ids: (Array.isArray(body.filter.task_ids) ? body.filter.task_ids : [])
        .map(Number).filter((value) => Number.isFinite(value)),
      asset_ids: (Array.isArray(body.filter.asset_ids) ? body.filter.asset_ids : [])
        .map(Number).filter((value) => Number.isFinite(value)),
      vulnclass_include: (Array.isArray(body.filter.vulnclass_include) ? body.filter.vulnclass_include : [])
        .map((value) => String(value || '').trim()).filter(Boolean),
      vulnclass_exclude: (Array.isArray(body.filter.vulnclass_exclude) ? body.filter.vulnclass_exclude : [])
        .map((value) => String(value || '').trim()).filter(Boolean),
      on_status_change: Boolean(body.filter.on_status_change),
    }
  }
  if (patch) {
    if (body.name === undefined) delete payload.name
    if (body.kind === undefined) delete payload.kind
    if (body.enabled === undefined) delete payload.enabled
    if (body.mode === undefined) delete payload.mode
    if (body.config === undefined) delete payload.config
  }
  return payload
}

function triggerPayload(body) {
  const number = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
  }
  return {
    enabled: body.enabled !== false,
    interval_sec: number(body.interval_sec),
    on_finding: Boolean(body.on_finding),
    on_goal_met: Boolean(body.on_goal_met),
    on_task_timeout: Boolean(body.on_task_timeout),
    on_tool_call: Boolean(body.on_tool_call),
    on_task_create: Boolean(body.on_task_create),
    interval_message: String(body.interval_message || ''),
    finding_message: String(body.finding_message || ''),
    goal_message: String(body.goal_message || ''),
    task_timeout_message: String(body.task_timeout_message || ''),
    tool_call_message: String(body.tool_call_message || ''),
    task_create_message: String(body.task_create_message || ''),
    tool_names: (Array.isArray(body.tool_names) ? body.tool_names : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  }
}

function agentConfigPayload(body) {
  const payload = {}
  for (const key of ['max_turns', 'run_seconds', 'trigger_max_parallel']) {
    if (body[key] !== undefined && body[key] !== '') {
      const parsed = Number(body[key])
      if (Number.isFinite(parsed)) payload[key] = Math.max(0, Math.trunc(parsed))
    }
  }
  for (const key of ['web_search', 'interactive_shell']) {
    if (body[key] !== undefined) payload[key] = Boolean(body[key])
  }
  if (['serial', 'parallel'].includes(body.trigger_run_mode)) payload.trigger_run_mode = body.trigger_run_mode
  if (['by_task', 'all', 'none'].includes(body.trigger_merge_mode)) payload.trigger_merge_mode = body.trigger_merge_mode
  if (Object.prototype.hasOwnProperty.call(body, 'llm_profile_id')) {
    payload.llm_profile_id = body.llm_profile_id === null || body.llm_profile_id === '' ? null : Number(body.llm_profile_id)
  }
  return payload
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function unauthorized(res) {
  json(res, 401, { ok: false, error: 'unauthorized' })
}

// Templates carry a task-level preset: description/goal, an optional category
// and task-scoped intercept/allow rules. Keep the payload to known fields so a
// browser cannot smuggle arbitrary JSON into the upstream request.
function templatePayload(body) {
  const categoryId = body.category_id === null || body.category_id === undefined || body.category_id === ''
    ? null
    : Number(body.category_id)
  return {
    name: String(body.name || ''),
    description: String(body.description || ''),
    goal: String(body.goal || ''),
    category_id: Number.isFinite(categoryId) ? categoryId : null,
    intercept_rules: (Array.isArray(body.intercept_rules) ? body.intercept_rules : [])
      .filter((rule) => rule && typeof rule === 'object' && String(rule.pattern || '').trim())
      .map((rule) => ({
        enabled: rule.enabled !== false,
        action: rule.action === 'allow' ? 'allow' : 'block',
        kind: String(rule.kind || 'exact_domain'),
        pattern: String(rule.pattern || '').trim(),
        note: String(rule.note || ''),
      })),
  }
}

export function createApi({ client, sidecar }) {
  async function pendingCount() {
    try {
      await client.ensureAuth()
      return (await client.listPending()).length
    } catch {
      return null
    }
  }

  return {
    async handle(ctx, req, res) {
      try {
        if (requestRejection(ctx, req)) return unauthorized(res)
        const url = new URL(req.url || '/', 'http://x')
        const path = decodeURIComponent(url.pathname.slice(BASE.length)) || '/'
        const method = req.method || 'GET'

        if (method === 'GET' && path === '/config') {
          return json(res, 200, {
            ok: true,
            endpoint: sidecar.endpoint,
            uiUrl: sidecar.uiUrl,
            runtime: sidecar.runtime,
            autoStart: Boolean(cv(sidecar.config.autoStart, false)),
            targetGate: Boolean(cv(sidecar.config.targetGate, true)),
            approvalsPollMs: Math.max(1_000, cv(sidecar.config.approvalsPollMs, 3_000) || 3_000),
            hasPassword: Boolean(sidecar.password()),
          })
        }

        if (method === 'GET' && path === '/health') {
          const health = await sidecar.health()
          const pending = health.ok ? await pendingCount() : null
          return json(res, 200, {
            ok: true,
            sidecar: sidecar.status(),
            artex: health,
            pending,
            hasPassword: Boolean(sidecar.password()),
          })
        }

        if (method === 'GET' && path === '/doctor') {
          const data = await sidecar.doctor()
          return json(res, 200, { ok: true, doctor: data })
        }

        if (method === 'POST' && path === '/start') {
          const started = await sidecar.ensure({ force: true })
          const health = await sidecar.health()
          return json(res, 200, { ok: true, started, health, sidecar: sidecar.status() })
        }

        if (method === 'POST' && path === '/stop') {
          const stopped = await sidecar.stop()
          return json(res, 200, { ok: true, stopped, sidecar: sidecar.status() })
        }

        if (method === 'GET' && path === '/logs') {
          const tail = Math.max(1, Math.min(1_000, Number(url.searchParams.get('tail') || 80)))
          const text = await sidecar.logs(tail)
          return json(res, 200, { ok: true, text })
        }

        if (method === 'GET' && path === '/tasks') {
          await client.ensureAuth()
          const tasks = (await client.listTasks()).map(normalizeTask).filter(Boolean)
          return json(res, 200, { ok: true, tasks })
        }

        if (method === 'GET' && path === '/task') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          const task = normalizeTask(await client.getTask(id))
          const scope = await client.listScope(id).catch(() => [])
          return json(res, 200, { ok: true, task, scope })
        }

        if (method === 'POST' && path === '/task/create') {
          const body = await readJson(req)
          if (cv(sidecar.config.requireAuthorizationAck, true) && body.authorization_ack !== true) {
            return json(res, 400, {
              ok: false,
              error: 'authorization_ack must be true: confirm you own or are authorized to test the scope.',
            })
          }
          if (typeof body.goal !== 'string' || !body.goal.trim()) {
            return json(res, 400, { ok: false, error: 'goal is required' })
          }
          if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
            return json(res, 400, { ok: false, error: 'at least one scope row is required' })
          }
          await client.ensureAuth()
          const payload = {
            name: body.name || '',
            description: body.goal,
            goal: body.goal,
            timeout_seconds: Number(body.timeout_seconds) || cv(sidecar.config.defaultTimeoutSeconds, 3600) || 3600,
            seed_first_intent: body.seed_first_intent !== false,
            target_gate: body.target_gate !== undefined ? Boolean(body.target_gate) : Boolean(cv(sidecar.config.targetGate, true)),
          }
          if (body.llm_profile_id !== undefined) payload.llm_profile_id = Number(body.llm_profile_id)
          const { task, scopeErrors } = await client.createTaskWithScope(payload, body.scopes)
          return json(res, 201, { ok: true, task: normalizeTask(task), scope_errors: scopeErrors })
        }

        if (method === 'POST' && path === '/task/archive') {
          const body = await readJson(req)
          if (!body.id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          const data = await client.archiveTask(String(body.id))
          return json(res, 202, { ok: true, data })
        }

        if (method === 'POST' && path === '/task/delete') {
          const body = await readJson(req)
          if (!body.id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          const data = await client.deleteTask(String(body.id), {
            delete_assets: Boolean(body.delete_data),
            delete_traffic: Boolean(body.delete_data),
            delete_files: Boolean(body.delete_data),
            delete_findings: Boolean(body.delete_data),
            delete_llm_records: Boolean(body.delete_data),
          })
          return json(res, 200, { ok: true, data })
        }

        if (method === 'GET' && path === '/task/intercept') {
          const task = url.searchParams.get('task')
          if (!task) return json(res, 400, { ok: false, error: 'task is required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, rules: await client.listTaskInterceptRules(task) })
        }
        if (method === 'POST' && path === '/task/intercept') {
          const body = await readJson(req)
          if (!body.task_id || !body.kind || !body.pattern) {
            return json(res, 400, { ok: false, error: 'task_id/kind/pattern are required' })
          }
          await client.ensureAuth()
          return json(res, 200, {
            ok: true,
            data: await client.addTaskInterceptRule(body.task_id, {
              enabled: body.enabled !== false,
              action: body.action || 'block',
              kind: body.kind,
              pattern: body.pattern,
              note: body.note || '',
            }),
          })
        }
        if (method === 'DELETE' && path === '/task/intercept') {
          const task = url.searchParams.get('task')
          const id = url.searchParams.get('id')
          if (!task || !id) return json(res, 400, { ok: false, error: 'task and id are required' })
          await client.ensureAuth()
          await client.deleteTaskInterceptRule(task, id)
          return json(res, 200, { ok: true })
        }
        if (method === 'POST' && path === '/task/intercept/toggle') {
          const body = await readJson(req)
          if (!body.task_id || body.id === undefined) return json(res, 400, { ok: false, error: 'task_id and id are required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, data: await client.toggleTaskInterceptRule(body.task_id, body.id) })
        }

        if (method === 'GET' && path === '/task/credentials') {
          const task = url.searchParams.get('task')
          if (!task) return json(res, 400, { ok: false, error: 'task is required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, credentials: await client.listTaskCredentials(task) })
        }
        if (method === 'POST' && path === '/task/credential') {
          const body = await readJson(req)
          if (!body.task_id || !body.domain || !body.username) {
            return json(res, 400, { ok: false, error: 'task_id/domain/username are required' })
          }
          await client.ensureAuth()
          return json(res, 200, {
            ok: true,
            data: await client.addTaskCredential(body.task_id, {
              domain: body.domain,
              username: body.username,
              password: body.password || '',
              note: body.note || '',
            }),
          })
        }
        if (method === 'DELETE' && path === '/task/credential') {
          const task = url.searchParams.get('task')
          const id = url.searchParams.get('id')
          if (!task || !id) return json(res, 400, { ok: false, error: 'task and id are required' })
          await client.ensureAuth()
          await client.deleteTaskCredential(task, id)
          return json(res, 200, { ok: true })
        }

        if (method === 'GET' && path === '/task/categories') {
          await client.ensureAuth()
          return json(res, 200, { ok: true, categories: await client.listTaskCategories() })
        }
        if (method === 'POST' && path === '/task/category') {
          const body = await readJson(req)
          if (!body.name) return json(res, 400, { ok: false, error: 'name is required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, data: await client.createTaskCategory(body.name) })
        }
        if (method === 'DELETE' && path === '/task/category') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          await client.deleteTaskCategory(id)
          return json(res, 200, { ok: true })
        }

        if (method === 'GET' && path === '/task/templates') {
          await client.ensureAuth()
          return json(res, 200, { ok: true, templates: await client.listTaskTemplates() })
        }
        if (method === 'POST' && path === '/task/template') {
          const body = await readJson(req)
          if (!body.name || !body.description || !body.goal) {
            return json(res, 400, { ok: false, error: 'name, description and goal are required' })
          }
          await client.ensureAuth()
          return json(res, 200, { ok: true, data: await client.createTaskTemplate(templatePayload(body)) })
        }
        if (method === 'PATCH' && path === '/task/template') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          const body = await readJson(req, undefined, ['PATCH'])
          if (!body.name || !body.description || !body.goal) {
            return json(res, 400, { ok: false, error: 'name, description and goal are required' })
          }
          await client.ensureAuth()
          return json(res, 200, { ok: true, data: await client.updateTaskTemplate(id, templatePayload(body)) })
        }
        if (method === 'DELETE' && path === '/task/template') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          await client.deleteTaskTemplate(id)
          return json(res, 200, { ok: true })
        }

        if (method === 'GET' && path === '/task/goals') {
          const task = url.searchParams.get('task')
          if (!task) return json(res, 400, { ok: false, error: 'task is required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, goals: await client.listGoals(task) })
        }
        if (method === 'POST' && path === '/task/goal') {
          const body = await readJson(req)
          if (!body.task_id || !body.text) return json(res, 400, { ok: false, error: 'task_id and text are required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, data: await client.addGoal(body.task_id, body.text, body.vulnclass) })
        }
        if (method === 'DELETE' && path === '/task/goal') {
          const task = url.searchParams.get('task')
          const id = url.searchParams.get('id')
          if (!task || !id) return json(res, 400, { ok: false, error: 'task and id are required' })
          await client.ensureAuth()
          await client.deleteGoal(task, id)
          return json(res, 200, { ok: true })
        }
        if (method === 'GET' && path === '/task/scope') {
          const task = url.searchParams.get('task')
          if (!task) return json(res, 400, { ok: false, error: 'task is required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, scope: await client.listScope(task) })
        }
        if (method === 'POST' && path === '/task/scope') {
          const body = await readJson(req)
          if (!body.task_id || !body.kind || !body.value) return json(res, 400, { ok: false, error: 'task_id/kind/value are required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, data: await client.addScope(body.task_id, body.kind, body.value, body.reason) })
        }
        if (method === 'DELETE' && path === '/task/scope') {
          const task = url.searchParams.get('task')
          const id = url.searchParams.get('id')
          if (!task || !id) return json(res, 400, { ok: false, error: 'task and id are required' })
          await client.ensureAuth()
          await client.deleteScope(task, id)
          return json(res, 200, { ok: true })
        }
        if (method === 'GET' && path === '/task/constraints') {
          const task = url.searchParams.get('task')
          if (!task) return json(res, 400, { ok: false, error: 'task is required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, constraints: await client.listConstraints(task) })
        }
        if (method === 'POST' && path === '/task/constraint') {
          const body = await readJson(req)
          if (!body.task_id || !body.text || !body.kind) return json(res, 400, { ok: false, error: 'task_id/text/kind are required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, data: await client.addConstraint(body.task_id, body.text, body.kind) })
        }
        if (method === 'DELETE' && path === '/task/constraint') {
          const task = url.searchParams.get('task')
          const id = url.searchParams.get('id')
          if (!task || !id) return json(res, 400, { ok: false, error: 'task and id are required' })
          await client.ensureAuth()
          await client.deleteConstraint(task, id)
          return json(res, 200, { ok: true })
        }

        if (method === 'POST' && path === '/task/control') {
          const body = await readJson(req)
          if (!body.id || !['pause', 'resume', 'cancel'].includes(body.action)) {
            return json(res, 400, { ok: false, error: 'id and action (pause|resume|cancel) are required' })
          }
          await client.ensureAuth()
          if (body.action === 'cancel') {
            const result = await client.cancelTask(String(body.id))
            return json(res, 200, { ok: true, result })
          }
          const result = await client.controlTask(String(body.id), body.action)
          return json(res, 200, { ok: true, result })
        }

        if (method === 'POST' && path === '/chat') {
          const body = await readJson(req)
          if (!body.task_id || typeof body.message !== 'string' || !body.message.trim()) {
            return json(res, 400, { ok: false, error: 'task_id and message are required' })
          }
          await client.ensureAuth()
          const data = await client.chat(String(body.task_id), body.message.trim())
          return json(res, 202, { ok: true, data })
        }

        if (method === 'GET' && path === '/report') {
          const task = url.searchParams.get('task')
          if (!task) return json(res, 400, { ok: false, error: 'task is required' })
          await client.ensureAuth()
          const text = await client.report(task)
          return json(res, 200, { ok: true, report: text })
        }

        if (method === 'GET' && path === '/graph') {
          const task = url.searchParams.get('task')
          if (!task) return json(res, 400, { ok: false, error: 'task is required' })
          await client.ensureAuth()
          const data = await client.graph(task)
          return json(res, 200, { ok: true, ...data })
        }

        if (method === 'GET' && path === '/activity') {
          const task = url.searchParams.get('task')
          if (!task) return json(res, 400, { ok: false, error: 'task is required' })
          const since = Number(url.searchParams.get('since') || 0)
          const limit = Math.max(1, Math.min(300, Number(url.searchParams.get('limit') || 100)))
          await client.ensureAuth()
          const data = await client.activity(task, { since, limit })
          return json(res, 200, { ok: true, ...data })
        }

        // Live tail: forward ARTEX's SSE stream to the same-origin panel.
        // EventSource sends Last-Event-ID on reconnect; pass it through so the
        // upstream resumes from the exact cursor.
        if (method === 'GET' && path === '/activity/stream') {
          const task = url.searchParams.get('task')
          if (!task) return json(res, 400, { ok: false, error: 'task is required' })
          const since = Number(url.searchParams.get('since') || 0)
          const lastEventId = req.headers['last-event-id']
          await client.ensureAuth()
          const controller = new AbortController()
          req.on('close', () => controller.abort())
          let upstream
          try {
            upstream = await client.stream(
              `/api/exploration/activity/stream?task=${encodeURIComponent(task)}&since=${since}`,
              {
                signal: controller.signal,
                headers: lastEventId ? { 'last-event-id': String(lastEventId) } : {},
              },
            )
          } catch (error) {
            return json(res, 502, { ok: false, error: error?.message || String(error), code: error?.code || '' })
          }
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          })
          res.flushHeaders?.()
          const reader = upstream.body?.getReader()
          if (!reader) {
            res.end()
            return
          }
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (!res.write(Buffer.from(value))) {
                await new Promise((resolve) => {
                  res.once('drain', resolve)
                  res.once('close', resolve)
                })
              }
            }
          } catch {
            // Client disconnect or upstream abort: both are normal endings.
          } finally {
            try { await reader.cancel() } catch {}
            if (!res.writableEnded) res.end()
          }
          return
        }

        if (method === 'GET' && path === '/findings/export') {
          const format = url.searchParams.get('format') || 'md-single'
          const query = new URLSearchParams({ scope: 'filtered', format })
          const taskId = url.searchParams.get('task_id')
          const ids = url.searchParams.get('ids')
          if (taskId) query.set('task_id', taskId)
          if (ids) {
            query.set('scope', 'selected')
            query.set('ids', ids)
          }
          await client.ensureAuth()
          const file = await client.download(`/api/exploration/findings/export?${query}`)
          res.writeHead(200, {
            'content-type': file.contentType,
            'content-disposition': file.contentDisposition || `attachment; filename="findings.${format}"`,
            'cache-control': 'no-store',
          })
          res.end(file.buffer)
          return
        }

        if (method === 'PATCH' && path === '/finding') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          const body = await readJson(req, 64 * 1024, ['PATCH'])
          const patch = {}
          for (const key of ['status', 'severity', 'name', 'vulnclass']) {
            if (body[key] !== undefined) patch[key] = body[key]
          }
          if (Object.keys(patch).length === 0) {
            return json(res, 400, { ok: false, error: 'status/severity/name/vulnclass is required' })
          }
          await client.ensureAuth()
          const data = await client.patchFinding(id, patch)
          return json(res, 200, { ok: true, data })
        }

        if (method === 'GET' && path === '/findings') {
          const task = url.searchParams.get('task')
          if (!task) return json(res, 400, { ok: false, error: 'task is required' })
          await client.ensureAuth()
          const findings = await client.listFindings(task)
          return json(res, 200, { ok: true, findings })
        }

        if (method === 'GET' && path === '/assets') {
          const taskId = url.searchParams.get('task_id') || ''
          const type = url.searchParams.get('type') || ''
          const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 200)))
          const offset = Math.max(0, Number(url.searchParams.get('offset') || 0))
          await client.ensureAuth()
          const data = await client.listAssets({ taskId, type, limit, offset })
          return json(res, 200, { ok: true, ...data })
        }

        if (method === 'GET' && path === '/assets/counts') {
          const taskId = url.searchParams.get('task_id') || ''
          await client.ensureAuth()
          const data = await client.assetCounts(taskId)
          return json(res, 200, { ok: true, ...data })
        }

        if (method === 'GET' && path === '/coverage') {
          const task = url.searchParams.get('task')
          if (!task) return json(res, 400, { ok: false, error: 'task is required' })
          await client.ensureAuth()
          const data = await client.coverage(task)
          return json(res, 200, { ok: true, ...data })
        }

        if (method === 'GET' && path === '/llm') {
          await client.ensureAuth()
          return json(res, 200, { ok: true, status: await client.llmStatus(), profiles: await client.listLLMProfiles() })
        }

        if (method === 'POST' && path === '/llm/profile') {
          const body = await readJson(req)
          if (!body.format || !body.model) return json(res, 400, { ok: false, error: 'format and model are required' })
          await client.ensureAuth()
          const saved = await client.saveLLMProfile({
            name: body.name || '',
            format: body.format,
            base_url: body.base_url || '',
            model: body.model,
            api_key: body.api_key || '',
            streaming: body.streaming !== false,
          })
          if (body.activate !== false && saved?.id !== undefined) await client.activateLLMProfile(saved.id)
          return json(res, 200, { ok: true, id: saved?.id })
        }

        if (method === 'POST' && path === '/llm/profile/activate') {
          const body = await readJson(req)
          if (body.id === undefined) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          await client.activateLLMProfile(body.id)
          return json(res, 200, { ok: true })
        }

        if (method === 'DELETE' && path === '/llm/profile') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          await client.deleteLLMProfile(id)
          return json(res, 200, { ok: true })
        }

        if (method === 'POST' && path === '/llm/test') {
          const body = await readJson(req)
          await client.ensureAuth()
          const data = await client.testLLM(body.profile_id !== undefined
            ? { profile_id: Number(body.profile_id) }
            : {
                provider: body.provider,
                model: body.model,
                base_url: body.base_url,
                api_key: body.api_key,
              })
          return json(res, 200, { ok: true, result: data })
        }

        if (method === 'GET' && path === '/llm/pool') {
          await client.ensureAuth()
          return json(res, 200, { ok: true, pool: await client.llmPool() })
        }

        if (method === 'POST' && path === '/llm/pool/reset') {
          const body = await readJson(req)
          await client.ensureAuth()
          return json(res, 200, { ok: true, pool: await client.resetLLMPool(body.id || 0) })
        }

        if (method === 'GET' && path === '/conversations') {
          await client.ensureAuth()
          const conversations = await client.listConversations()
          return json(res, 200, { ok: true, conversations })
        }

        if (method === 'POST' && path === '/conversations') {
          const body = await readJson(req)
          await client.ensureAuth()
          const data = await client.createConversation({
            agent_key: body.agent_key || 'assistant',
            title: body.title || '',
          })
          return json(res, 200, { ok: true, data })
        }

        if (method === 'GET' && path === '/conversation/messages') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          const since = url.searchParams.has('since') ? Number(url.searchParams.get('since')) : undefined
          const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') || 200)))
          await client.ensureAuth()
          const data = await client.conversationMessages(id, { since, limit })
          return json(res, 200, { ok: true, ...data })
        }

        if (method === 'POST' && path === '/conversation/message') {
          const body = await readJson(req)
          if (!body.id || typeof body.message !== 'string' || !body.message.trim()) {
            return json(res, 400, { ok: false, error: 'id and message are required' })
          }
          await client.ensureAuth()
          const data = await client.sendConversationMessage(String(body.id), body.message.trim())
          return json(res, 202, { ok: true, data })
        }

        if (method === 'POST' && path === '/conversation/stop') {
          const body = await readJson(req)
          if (!body.id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          const data = await client.stopConversation(String(body.id))
          return json(res, 200, { ok: true, data })
        }

        if (method === 'GET' && path === '/conversation/message') {
          const id = url.searchParams.get('id')
          const seq = url.searchParams.get('seq')
          if (!id || !seq) return json(res, 400, { ok: false, error: 'id and seq are required' })
          await client.ensureAuth()
          const data = await client.conversationMessageDetail(id, seq)
          return json(res, 200, { ok: true, data })
        }

        if (method === 'GET' && path === '/system/settings') {
          await client.ensureAuth()
          return json(res, 200, { ok: true, settings: await client.settings() })
        }

        if (method === 'POST' && path === '/system/settings') {
          const body = await readJson(req)
          const allowed = [
            'noise_profile', 'workers', 'task_concurrency_enabled', 'task_concurrency_limit',
            'traffic_capture', 'agent_traffic_binding', 'llm_record',
            'constraints_inject_planner', 'constraints_inject_worker', 'noa_compaction',
            'notify_enabled',
          ]
          const patch = {}
          for (const key of allowed) {
            if (body[key] !== undefined) patch[key] = body[key]
          }
          if (Object.keys(patch).length === 0) return json(res, 400, { ok: false, error: 'no supported settings supplied' })
          await client.ensureAuth()
          await client.updateSettings(patch)
          return json(res, 200, { ok: true, settings: await client.settings() })
        }

        if (method === 'POST' && path === '/system/mcp') {
          const body = await readJson(req)
          if (!body.name || !body.transport) return json(res, 400, { ok: false, error: 'name and transport are required' })
          await client.ensureAuth()
          const saved = await client.saveMCP({
            id: Number(body.id) || 0,
            name: body.name,
            transport: body.transport,
            command: body.command || '',
            args: Array.isArray(body.args) ? body.args : [],
            env: body.env && typeof body.env === 'object' ? body.env : {},
            url: body.url || '',
            enabled: body.enabled !== false,
            insecure: Boolean(body.insecure),
            timeout_seconds: Number(body.timeout_seconds) || 120,
          })
          return json(res, 200, { ok: true, id: saved?.id })
        }

        if (method === 'POST' && path === '/system/skill') {
          const body = await readJson(req)
          if (!body.name || !body.description) return json(res, 400, { ok: false, error: 'name and description are required' })
          await client.ensureAuth()
          const data = await client.createSkill({
            name: body.name,
            description: body.description,
            license: body.license || '',
            compatibility: body.compatibility || '',
            mcps: Array.isArray(body.mcps) ? body.mcps : [],
            instructions: body.instructions || '',
          })
          return json(res, 200, { ok: true, data })
        }

        if (method === 'DELETE' && path === '/system/skill') {
          const name = url.searchParams.get('name')
          if (!name) return json(res, 400, { ok: false, error: 'name is required' })
          await client.ensureAuth()
          const data = await client.deleteSkill(name)
          return json(res, 200, { ok: true, data })
        }

        if (method === 'POST' && path === '/system/skill/upload') {
          const contentType = String(req.headers['content-type'] || '')
          if (!/zip|octet-stream/i.test(contentType)) {
            return json(res, 415, { ok: false, error: 'content-type must be application/zip' })
          }
          const zip = await readBinary(req)
          if (zip.length === 0) return json(res, 400, { ok: false, error: 'empty upload' })
          const filename = String(url.searchParams.get('filename') || 'skill.zip').split(/[\\/]/).pop()
          const overwrite = url.searchParams.get('overwrite') === 'true'
          await client.ensureAuth()
          const data = await client.uploadSkill(zip, filename, overwrite)
          return json(res, 200, { ok: true, data })
        }

        if (method === 'PUT' && path === '/system/skill/file') {
          const body = await readJson(req, 64 * 1024, ['PUT'])
          if (!body.name || !body.file) return json(res, 400, { ok: false, error: 'name and file are required' })
          await client.ensureAuth()
          const data = await client.writeSkillFile(body.name, body.file, body.content || '')
          return json(res, 200, { ok: true, data })
        }

        if (method === 'POST' && path === '/system/workspace/write') {
          const body = await readJson(req, 2 * 1024 * 1024)
          if (!body.path) return json(res, 400, { ok: false, error: 'path is required' })
          await client.ensureAuth()
          const data = await client.workspaceWrite(body.path, body.content || '')
          return json(res, 200, { ok: true, data })
        }

        if (method === 'GET' && path === '/system/agent') {
          const key = url.searchParams.get('key')
          if (!key) return json(res, 400, { ok: false, error: 'key is required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, ...(await client.getAgent(key)) })
        }

        if (method === 'POST' && path === '/system/agent/prompt') {
          const body = await readJson(req, 1024 * 1024)
          if (!body.key) return json(res, 400, { ok: false, error: 'key is required' })
          await client.ensureAuth()
          const data = await client.saveAgentPrompt(body.key, body.template || '', body.note || '')
          return json(res, 200, { ok: true, data })
        }

        if (method === 'POST' && path === '/system/agent/prompt/reset') {
          const body = await readJson(req)
          if (!body.key) return json(res, 400, { ok: false, error: 'key is required' })
          await client.ensureAuth()
          const data = await client.resetAgentPrompt(body.key)
          return json(res, 200, { ok: true, data })
        }

        if (method === 'POST' && path === '/system/agent') {
          const body = await readJson(req)
          if (!body.key || !body.name) return json(res, 400, { ok: false, error: 'key and name are required' })
          await client.ensureAuth()
          const data = await client.createAgent({
            key: body.key,
            name: body.name,
            description: body.description || '',
          })
          return json(res, 200, { ok: true, data })
        }
        if (method === 'PATCH' && path === '/system/agent') {
          const key = url.searchParams.get('key')
          if (!key) return json(res, 400, { ok: false, error: 'key is required' })
          const body = await readJson(req, undefined, ['PATCH'])
          if (!body.name) return json(res, 400, { ok: false, error: 'name is required' })
          await client.ensureAuth()
          const data = await client.updateAgent(key, { name: body.name, description: body.description || '' })
          return json(res, 200, { ok: true, data })
        }
        if (method === 'DELETE' && path === '/system/agent') {
          const key = url.searchParams.get('key')
          if (!key) return json(res, 400, { ok: false, error: 'key is required' })
          await client.ensureAuth()
          const data = await client.deleteAgent(key)
          return json(res, 200, { ok: true, data })
        }

        if (method === 'POST' && path === '/system/agent/config') {
          const body = await readJson(req)
          if (!body.key) return json(res, 400, { ok: false, error: 'key is required' })
          await client.ensureAuth()
          const data = await client.saveAgentConfig(body.key, agentConfigPayload(body))
          return json(res, 200, { ok: true, data })
        }

        if (method === 'GET' && path === '/system/agent/visibility') {
          const key = url.searchParams.get('key')
          if (!key) return json(res, 400, { ok: false, error: 'key is required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, ...(await client.getAgentVisibility(key)) })
        }
        if (method === 'PUT' && path === '/system/agent/visibility') {
          const key = url.searchParams.get('key')
          if (!key) return json(res, 400, { ok: false, error: 'key is required' })
          const body = await readJson(req, undefined, ['PUT'])
          await client.ensureAuth()
          const data = await client.saveAgentVisibility(key, {
            mcp: (Array.isArray(body.mcp) ? body.mcp : []).map(Number).filter((value) => Number.isFinite(value)),
            skill: (Array.isArray(body.skill) ? body.skill : []).map((value) => String(value || '')).filter(Boolean),
          })
          return json(res, 200, { ok: true, data })
        }

        if (method === 'GET' && path === '/system/agent/triggers') {
          const key = url.searchParams.get('key')
          if (!key) return json(res, 400, { ok: false, error: 'key is required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, triggers: await client.listTriggers(key) })
        }
        if (method === 'POST' && path === '/system/agent/trigger') {
          const body = await readJson(req)
          if (!body.key) return json(res, 400, { ok: false, error: 'key is required' })
          await client.ensureAuth()
          const data = await client.createTrigger(body.key, triggerPayload(body))
          return json(res, 200, { ok: true, data })
        }
        if (method === 'PATCH' && path === '/system/agent/trigger') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          const body = await readJson(req, undefined, ['PATCH'])
          await client.ensureAuth()
          const data = await client.updateTrigger(id, triggerPayload(body))
          return json(res, 200, { ok: true, data })
        }
        if (method === 'DELETE' && path === '/system/agent/trigger') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          const data = await client.deleteTrigger(id)
          return json(res, 200, { ok: true, data })
        }

        if (method === 'POST' && path === '/system/tool/builtin') {
          const body = await readJson(req)
          if (!body.key) return json(res, 400, { ok: false, error: 'key is required' })
          await client.ensureAuth()
          const data = await client.updateTool(body.key, {
            description: body.description || '',
            schema: body.schema || {},
            agents: Array.isArray(body.agents) ? body.agents : [],
            enabled: body.enabled !== false,
          })
          return json(res, 200, { ok: true, data })
        }
        if (method === 'POST' && path === '/system/tool/reset') {
          const body = await readJson(req)
          if (!body.key) return json(res, 400, { ok: false, error: 'key is required' })
          await client.ensureAuth()
          const data = await client.resetTool(body.key)
          return json(res, 200, { ok: true, data })
        }

        if (method === 'GET' && path === '/system/tools') {
          await client.ensureAuth()
          return json(res, 200, { ok: true, tools: await client.listTools() })
        }
        if (method === 'POST' && path === '/system/tool') {
          const body = await readJson(req)
          if (!body.key || !body.kind) return json(res, 400, { ok: false, error: 'key and kind are required' })
          await client.ensureAuth()
          const payload = {
            key: body.key,
            description: body.description || '',
            schema: body.schema || {},
            agents: Array.isArray(body.agents) ? body.agents : [],
            enabled: body.enabled !== false,
            kind: body.kind,
            exec: body.exec || {},
            deferred: Boolean(body.deferred),
          }
          const result = body.update
            ? await client.updateCustomTool(body.key, payload)
            : await client.createCustomTool(payload)
          return json(res, 200, { ok: true, result })
        }
        if (method === 'POST' && path === '/system/tool/test') {
          const body = await readJson(req)
          await client.ensureAuth()
          const result = await client.testCustomTool({
            key: body.key || '',
            kind: body.kind,
            exec: body.exec || {},
            params: body.params || {},
          })
          return json(res, 200, { ok: true, result })
        }
        if (method === 'DELETE' && path === '/system/tool') {
          const key = url.searchParams.get('key')
          if (!key) return json(res, 400, { ok: false, error: 'key is required' })
          await client.ensureAuth()
          await client.deleteCustomTool(key)
          return json(res, 200, { ok: true })
        }
        if (method === 'POST' && path === '/system/notify') {
          const body = await readJson(req)
          if (!body.name || !body.kind) return json(res, 400, { ok: false, error: 'name and kind are required' })
          await client.ensureAuth()
          const data = await client.createNotifyChannel(notifyPayload(body))
          return json(res, 200, { ok: true, data })
        }
        if (method === 'PATCH' && path === '/system/notify') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          const body = await readJson(req, undefined, ['PATCH'])
          await client.ensureAuth()
          const data = await client.updateNotifyChannel(id, notifyPayload(body, true))
          return json(res, 200, { ok: true, data })
        }
        if (method === 'POST' && path === '/system/notify/test') {
          const body = await readJson(req)
          if (body.id === undefined) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          const data = await client.testNotifyChannel(body.id)
          return json(res, 200, { ok: true, data })
        }
        if (method === 'DELETE' && path === '/system/notify') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          await client.deleteNotifyChannel(id)
          return json(res, 200, { ok: true })
        }
        if (method === 'GET' && path === '/system/notify/deliveries') {
          await client.ensureAuth()
          const data = await client.listNotifyDeliveries({
            state: url.searchParams.get('state') || '',
            event_kind: url.searchParams.get('event_kind') || '',
            channel_id: url.searchParams.get('channel_id') || '',
            page: Math.max(1, Number(url.searchParams.get('page') || 1)),
            page_size: Math.max(1, Math.min(200, Number(url.searchParams.get('page_size') || 50))),
          })
          return json(res, 200, { ok: true, ...data })
        }
        if (method === 'POST' && path === '/system/notify/delivery/retry') {
          const body = await readJson(req)
          if (body.id === undefined) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          const data = await client.retryNotifyDelivery(body.id)
          return json(res, 200, { ok: true, data })
        }

        if (method === 'GET' && path === '/system/mcp') {
          await client.ensureAuth()
          return json(res, 200, { ok: true, servers: await client.listMCP() })
        }
        if (method === 'POST' && path === '/system/mcp/refresh') {
          const body = await readJson(req)
          if (body.id === undefined) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, result: await client.refreshMCP(body.id) })
        }
        if (method === 'DELETE' && path === '/system/mcp') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          await client.deleteMCP(id)
          return json(res, 200, { ok: true })
        }
        if (method === 'GET' && path === '/system/skills') {
          await client.ensureAuth()
          return json(res, 200, { ok: true, skills: await client.listSkills() })
        }
        if (method === 'GET' && path === '/system/skill/files') {
          const name = url.searchParams.get('name')
          if (!name) return json(res, 400, { ok: false, error: 'name is required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, ...(await client.skillFiles(name)) })
        }
        if (method === 'GET' && path === '/system/skill/file') {
          const name = url.searchParams.get('name')
          const file = url.searchParams.get('file')
          if (!name || !file) return json(res, 400, { ok: false, error: 'name and file are required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, ...(await client.skillFile(name, file)) })
        }
        if (method === 'GET' && path === '/system/agents') {
          await client.ensureAuth()
          return json(res, 200, { ok: true, agents: await client.listAgents() })
        }
        if (method === 'GET' && path === '/system/notify') {
          await client.ensureAuth()
          return json(res, 200, { ok: true, channels: await client.listNotifyChannels() })
        }
        if (method === 'GET' && path === '/system/logs') {
          const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)))
          await client.ensureAuth()
          return json(res, 200, { ok: true, ...(await client.logs({ limit })) })
        }
        if (method === 'GET' && path === '/system/workspace') {
          const pathname = url.searchParams.get('path') || ''
          await client.ensureAuth()
          return json(res, 200, { ok: true, ...(await client.workspaceList(pathname)) })
        }
        if (method === 'GET' && path === '/system/workspace/read') {
          const pathname = url.searchParams.get('path')
          if (!pathname) return json(res, 400, { ok: false, error: 'path is required' })
          await client.ensureAuth()
          return json(res, 200, { ok: true, ...(await client.workspaceRead(pathname)) })
        }

        if (method === 'GET' && path === '/settings') {
          await client.ensureAuth()
          const data = await client.settings()
          return json(res, 200, { ok: true, settings: data })
        }

        if (method === 'POST' && path === '/settings') {
          const body = await readJson(req)
          const patch = {}
          if (body.traffic_capture !== undefined) patch.traffic_capture = Boolean(body.traffic_capture)
          if (body.agent_traffic_binding !== undefined) patch.agent_traffic_binding = Boolean(body.agent_traffic_binding)
          if (Object.keys(patch).length === 0) {
            return json(res, 400, { ok: false, error: 'traffic_capture or agent_traffic_binding is required' })
          }
          await client.ensureAuth()
          await client.updateSettings(patch)
          const data = await client.settings()
          return json(res, 200, { ok: true, settings: data })
        }

        if (method === 'GET' && path === '/finding/retests') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          const retests = await client.listFindingRetests(id)
          return json(res, 200, { ok: true, retests })
        }

        if (method === 'POST' && path === '/finding/retest') {
          const body = await readJson(req)
          if (!body.finding_id) return json(res, 400, { ok: false, error: 'finding_id is required' })
          await client.ensureAuth()
          const data = await client.startFindingRetest(String(body.finding_id), body.notes || '')
          return json(res, 202, { ok: true, ...data })
        }

        if (method === 'GET' && path === '/retests/active') {
          await client.ensureAuth()
          const retests = await client.activeFindingRetests()
          return json(res, 200, { ok: true, retests })
        }

        if (method === 'GET' && path === '/finding/traffic') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          const data = await client.findingTraffic(id)
          return json(res, 200, { ok: true, ...data })
        }

        if (method === 'POST' && path === '/finding/bind') {
          const body = await readJson(req)
          if (!body.finding_id || !Array.isArray(body.refs) || body.refs.length === 0) {
            return json(res, 400, { ok: false, error: 'finding_id and refs[] are required' })
          }
          await client.ensureAuth()
          const data = await client.bindFindingTraffic(String(body.finding_id), body.refs)
          return json(res, 200, { ok: true, ...data })
        }

        if (method === 'GET' && path === '/traffic') {
          const page = Math.max(0, Number(url.searchParams.get('page') || 0))
          const size = Math.max(1, Math.min(200, Number(url.searchParams.get('size') || 50)))
          await client.ensureAuth()
          const data = await client.traffic({
            host: url.searchParams.get('host') || '',
            q: url.searchParams.get('q') || '',
            method: url.searchParams.get('method') || '',
            page,
            size,
          })
          return json(res, 200, { ok: true, ...data })
        }

        if (method === 'POST' && path === '/traffic/purge') {
          const body = await readJson(req)
          if (body.confirm !== true) return json(res, 400, { ok: false, error: 'confirm=true is required' })
          if (!body.all && !body.host) return json(res, 400, { ok: false, error: 'host or all is required' })
          await client.ensureAuth()
          const data = await client.purgeTraffic({ host: body.host || '', all: Boolean(body.all) })
          return json(res, 200, { ok: true, data })
        }

        if (method === 'GET' && path === '/exchange') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          const data = await client.exchange(id)
          return json(res, 200, { ok: true, ...data })
        }

        if (method === 'GET' && path === '/pending') {
          await client.ensureAuth()
          const pending = (await client.listPending()).map(normalizePending)
          return json(res, 200, { ok: true, pending })
        }

        if (method === 'POST' && path === '/decide_batch') {
          const body = await readJson(req)
          if (!Array.isArray(body.ids) || body.ids.length === 0 || !['allowed', 'denied'].includes(body.decision)) {
            return json(res, 400, { ok: false, error: 'ids[] and decision (allowed|denied) are required' })
          }
          await client.ensureAuth()
          const data = await client.decideBatch(body.ids, body.decision)
          return json(res, 200, { ok: true, data })
        }

        if (method === 'POST' && path === '/always_allow') {
          const body = await readJson(req)
          if (body.id === undefined) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          const data = await client.alwaysAllow(body.id)
          return json(res, 200, { ok: true, data })
        }

        if (method === 'GET' && path === '/approval_history') {
          const task = url.searchParams.get('task') || ''
          const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)))
          await client.ensureAuth()
          const data = await client.approvalHistory({ task, limit })
          return json(res, 200, { ok: true, ...data })
        }

        if (method === 'POST' && path === '/decide') {
          const body = await readJson(req)
          if (body.id === undefined || !['allowed', 'denied'].includes(body.decision)) {
            return json(res, 400, { ok: false, error: 'id and decision (allowed|denied) are required' })
          }
          await client.ensureAuth()
          await client.decide(body.id, body.decision)
          return json(res, 200, { ok: true })
        }

        if (method === 'GET' && path === '/approval') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'id is required' })
          await client.ensureAuth()
          const pending = (await client.listPending()).map(normalizePending)
          const match = pending.find((p) => String(p.id) === String(id))
          if (!match) return json(res, 404, { ok: false, error: 'approval not found' })
          return json(res, 200, { ok: true, approval: match })
        }

        return json(res, 404, { ok: false, error: `no route for ${method} ${path}` })
      } catch (error) {
        const status = Number(error?.status) || 502
        return json(res, status, {
          ok: false,
          error: error?.message || String(error),
          code: error?.code || '',
        })
      }
    },
  }
}

export function apiBase() {
  return BASE
}
