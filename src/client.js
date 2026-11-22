// dsh-artex browser half.
//
// A thin React panel plus the full ARTEX UI in an iframe. The panel talks only
// to same-origin /artex/* routes served by the Host half, so the ARTEX JWT
// never enters the browser and no CORS configuration is needed.
//
// Built by scripts/build.mjs into dist/client.js with the ModuleLoader wrapper.

import { activityKey } from './shared/activity.js'
import { layoutGraph, payloadOf } from './shared/graph.js'

const React = require('react')
const h = React.createElement
const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

const PANEL_ID = 'artex'
const BASE = '/artex'

// ---------------------------------------------------------------------------
// tiny shared state for the sidebar badge
// ---------------------------------------------------------------------------
const badge = { count: 0, listeners: new Set() }

function setPendingBadge(count) {
  if (count === badge.count) return
  badge.count = count
  for (const listener of [...badge.listeners]) listener()
}

function subscribeBadge(listener) {
  badge.listeners.add(listener)
  return () => badge.listeners.delete(listener)
}

function usePendingBadge() {
  return useSyncExternalStore(subscribeBadge, () => badge.count)
}

const panelTab = { tab: 'console', listeners: new Set() }

function setPanelTab(tab) {
  if (tab === panelTab.tab) return
  panelTab.tab = tab
  for (const listener of [...panelTab.listeners]) listener()
}

function subscribePanelTab(listener) {
  panelTab.listeners.add(listener)
  return () => panelTab.listeners.delete(listener)
}

function usePanelTab() {
  return useSyncExternalStore(subscribePanelTab, () => panelTab.tab)
}

// ---------------------------------------------------------------------------
// HTTP + polling helpers
// ---------------------------------------------------------------------------
async function api(path, options = {}) {
  const hasBody = options.body !== undefined
  const response = await fetch(`${BASE}${path}`, {
    method: options.method || (hasBody ? 'POST' : 'GET'),
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  })
  let data
  try {
    data = await response.json()
  } catch {
    data = { ok: false, error: `HTTP ${response.status}` }
  }
  if (!response.ok || data?.ok === false) {
    const message = data?.error || `HTTP ${response.status}`
    const error = new Error(message)
    error.code = data?.code
    throw error
  }
  return data
}

function usePoll(path, intervalMs, enabled = true) {
  const [state, setState] = useState({ data: null, error: '', loading: true })
  const [nonce, setNonce] = useState(0)
  const pathRef = useRef(path)
  pathRef.current = path

  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    const controller = new AbortController()

    const load = async () => {
      try {
        const data = await api(pathRef.current, { signal: controller.signal })
        if (!alive) return
        setState({ data, error: '', loading: false })
      } catch (error) {
        if (!alive || error?.name === 'AbortError') return
        setState((previous) => ({ data: previous.data, error: error.message, loading: false }))
      }
    }

    load()
    const timer = setInterval(load, Math.max(1_000, intervalMs))
    return () => {
      alive = false
      clearInterval(timer)
      controller.abort()
    }
  }, [path, intervalMs, enabled, nonce])

  return { ...state, refresh: () => setNonce((value) => value + 1) }
}

async function run(action) {
  try {
    const result = await action()
    return { result, error: '' }
  } catch (error) {
    return { result: null, error: error?.message || String(error) }
  }
}

// ---------------------------------------------------------------------------
// styles (host theme tokens with safe fallbacks)
// ---------------------------------------------------------------------------
const S = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    background: 'var(--dsw-alias-bg-base, #ffffff)',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    font: '13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  tabbar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    rowGap: 4,
    padding: '8px 12px',
    borderBottom: '1px solid var(--dsw-alias-border-l1, #e5e7eb)',
    flex: '0 0 auto',
  },
  tab: {
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #57606a)',
    borderRadius: 6,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 13,
  },
  tabActive: {
    background: 'var(--dsw-alias-bg-layer-2, #f3f4f6)',
    borderColor: 'var(--dsw-alias-border-l2, #d0d7de)',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    fontWeight: 600,
  },
  body: { flex: 1, minHeight: 0, minWidth: 0, overflow: 'auto', padding: 12 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  button: {
    border: '1px solid var(--dsw-alias-border-l2, #d0d7de)',
    background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    borderRadius: 6,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
  },
  primary: {
    border: '1px solid var(--dsw-alias-brand-primary, #6b34db)',
    background: 'var(--dsw-alias-brand-primary, #6b34db)',
    color: '#fff',
        borderRadius: 6,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
  },
  danger: {
    border: '1px solid var(--dsw-alias-label-error, #cf222e)',
    background: 'transparent',
    color: 'var(--dsw-alias-label-error, #cf222e)',
    borderRadius: 6,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
  },
  card: {
    border: '1px solid var(--dsw-alias-border-l1, #e5e7eb)',
    borderRadius: 8,
    padding: 10,
    background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
    marginBottom: 8,
  },
  muted: { color: 'var(--dsw-alias-label-tertiary, #6e7781)' },
  error: { color: 'var(--dsw-alias-label-error, #cf222e)' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l2, #d0d7de)',
    borderRadius: 6,
    background: 'var(--dsw-alias-bg-base, #ffffff)',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    padding: '6px 8px',
    font: '12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace',
  },
  pre: {
    margin: '4px 0 0',
    padding: 8,
    borderRadius: 6,
    background: 'var(--dsw-alias-bg-layer-2, #f6f8fa)',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    font: '12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace',
    maxHeight: 220,
    overflow: 'auto',
  },
  status: {
    display: 'inline-block',
    borderRadius: 999,
    padding: '1px 8px',
    fontSize: 11,
    border: '1px solid var(--dsw-alias-border-l2, #d0d7de)',
    background: 'var(--dsw-alias-bg-layer-2, #f3f4f6)',
  },
}

function Badge({ children, tone }) {
  const color = tone === 'danger'
    ? 'var(--dsw-alias-label-error, #cf222e)'
    : 'var(--dsw-alias-label-secondary, #57606a)'
  return h('span', { style: { ...S.status, color } }, children)
}

// ---------------------------------------------------------------------------
// Settings page (Plugins -> dsh-artex -> row "artex" -> Configure)
// ---------------------------------------------------------------------------
const SETTINGS_TEXT = [
  ['endpoint', 'ARTEX API 地址', 'http://127.0.0.1:8787'],
  ['uiUrl', 'UI 地址（可选）', '默认与 API 地址相同'],
  ['artexDir', 'ARTEX 源码目录（Docker 模式必填）', '/path/to/ARTEX'],
  ['projectName', 'Compose 项目名', 'dsh-artex'],
  ['binaryPath', 'artex 可执行文件（binary 模式）', ''],
]
const SETTINGS_NUMBER = [
  ['defaultTimeoutSeconds', '新任务默认超时（秒）'],
  ['maxWaitSeconds', '单次 artex_wait 上限（秒）'],
  ['approvalsPollMs', '审批轮询间隔（毫秒）'],
]
const SETTINGS_BOOL = [
  ['autoStart', '允许工具/面板启动托管运行时'],
  ['targetGate', '新任务默认开启目标审批门'],
  ['requireAuthorizationAck', '创建任务必须显式授权确认'],
  ['confirmTaskCreation', '创建 ARTEX 任务前要求 DSH 审批'],
  ['confirmRuntimeStart', '启动托管运行时前要求 DSH 审批'],
  ['confirmRetest', '启动 finding 复测前要求 DSH 审批'],
  ['debug', '把 sidecar 日志写入 DSH 日志（脱敏）'],
]

function ArtexSettings({ view, form }) {
  const state = form?.state
  const value = state?.value || {}
  const [draft, setDraft] = useState(() => ({ ...value }))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setDraft({ ...(form?.state?.value || {}) })
    setMessage('')
    setError('')
  }, [form?.state?.revision, form?.state?.status])

  if (view === 'summary') {
    return 'ARTEX 运行时、连接参数与安全策略（授权确认、目标审批门、超时、审批轮询）。'
  }
  if (!form) return h('div', { style: S.muted }, '配置服务不可用。')
  if (state?.status === 'loading') return h('div', { style: S.muted }, '加载配置…')
  if (state?.status === 'unavailable') return h('div', { style: S.error }, '该配置对当前客户端不可用。')

  const set = (key, next) => setDraft((current) => ({ ...current, [key]: next }))
  const writable = state?.writable !== false

  const save = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    const ops = []
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
    for (const [key] of SETTINGS_TEXT) {
      const next = typeof draft[key] === 'string' ? draft[key].trim() : draft[key]
      if (same(next, value[key])) continue
      if (next === '' || next === undefined) ops.push({ op: 'unset', path: [key] })
      else ops.push({ op: 'set', path: [key], value: next })
    }
    for (const [key] of SETTINGS_NUMBER) {
      const next = Number(draft[key])
      if (!Number.isFinite(next)) {
        setBusy(false)
        setError(`${key} 必须是数字。`)
        return
      }
      if (!same(next, value[key])) ops.push({ op: 'set', path: [key], value: next })
    }
    for (const [key] of SETTINGS_BOOL) {
      const next = Boolean(draft[key])
      if (!same(next, value[key])) ops.push({ op: 'set', path: [key], value: next })
    }
    if (!same(draft.runtime, value.runtime)) ops.push({ op: 'set', path: ['runtime'], value: draft.runtime })
    if (!same(draft.noiseProfile, value.noiseProfile)) ops.push({ op: 'set', path: ['noiseProfile'], value: draft.noiseProfile })

    if (ops.length === 0) {
      setBusy(false)
      setMessage('没有修改。')
      return
    }
    try {
      const accepted = await form.mutate(ops, state?.revision)
      if (accepted) setMessage('已保存。运行时/目录类修改请回到 ARTEX 面板点“启动/重连”生效。')
      else setError('保存被拒绝：配置可能已被其他窗口修改，请刷新后重试。')
    } catch (failure) {
      setError(failure?.message || String(failure))
    } finally {
      setBusy(false)
    }
  }

  return h('div', { style: { maxWidth: 720 } },
    h('div', { style: { ...S.muted, marginBottom: 10 } },
      '这些字段是 DSH 的 live Config；保存后立即写入 profile patch。runtime / artexDir / composeFile 变更后需要重新启动或重连 ARTEX。'),
    !writable ? h('div', { style: { ...S.error, marginBottom: 8 } }, '当前配置文档不可写（可能被 home patch 或命令行覆盖）。') : null,

    h('div', { style: S.card },
      h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '运行时'),
      h('label', { style: { display: 'block', marginBottom: 8 } },
        h('div', { style: S.muted }, 'runtime'),
        h('select', {
          value: draft.runtime || 'external',
          onChange: (event) => set('runtime', event.target.value),
          style: S.input,
          disabled: !writable,
        },
          h('option', { value: 'external' }, 'external — 连接已有 ARTEX'),
          h('option', { value: 'docker' }, 'docker — 托管 postgres + artex'),
          h('option', { value: 'binary' }, 'binary — 启动本地 artex 可执行文件'),
        ),
      ),
      SETTINGS_TEXT.map(([key, label, placeholder]) => h('label', { key, style: { display: 'block', marginBottom: 8 } },
        h('div', { style: S.muted }, label),
        h('input', {
          value: draft[key] ?? '',
          placeholder,
          onChange: (event) => set(key, event.target.value),
          style: S.input,
          disabled: !writable,
        }),
      )),
      h('label', { style: { display: 'block', marginBottom: 8 } },
        h('div', { style: S.muted }, 'noiseProfile'),
        h('select', {
          value: draft.noiseProfile || '',
          onChange: (event) => set('noiseProfile', event.target.value),
          style: S.input,
          disabled: !writable,
        },
          h('option', { value: '' }, 'off'),
          h('option', { value: 'quiet' }, 'quiet'),
          h('option', { value: 'balanced' }, 'balanced'),
          h('option', { value: 'aggressive' }, 'aggressive'),
        ),
      ),
    ),

    h('div', { style: S.card },
      h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '安全与预算'),
      SETTINGS_BOOL.map(([key, label]) => h('label', { key, style: { ...S.row, marginBottom: 6, cursor: writable ? 'pointer' : 'default' } },
        h('input', {
          type: 'checkbox',
          checked: Boolean(draft[key]),
          onChange: (event) => set(key, event.target.checked),
          disabled: !writable,
        }),
        h('span', null, label),
      )),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginTop: 8 } },
        SETTINGS_NUMBER.map(([key, label]) => h('label', { key },
          h('div', { style: S.muted }, label),
          h('input', {
            type: 'number',
            min: 1,
            value: draft[key] ?? '',
            onChange: (event) => set(key, event.target.value),
            style: S.input,
            disabled: !writable,
          }),
        )),
      ),
    ),

    h('div', { style: S.row },
      h('button', { style: S.primary, onClick: save, disabled: busy || !writable }, busy ? '保存中…' : '保存'),
      h('span', { style: { ...S.muted, marginLeft: 4 } }, `revision ${state?.revision ?? '-'}`),
    ),
    message ? h('div', { style: { ...S.muted, marginTop: 6 } }, message) : null,
    error ? h('div', { style: { ...S.error, marginTop: 6 } }, error) : null,
  )
}

// ---------------------------------------------------------------------------
// Console: full ARTEX UI
// ---------------------------------------------------------------------------
function Console({ config, health, onStart, starting, startError }) {
  const [doctor, setDoctor] = useState(null)
  const [doctorBusy, setDoctorBusy] = useState(false)
  const runDoctor = async () => {
    setDoctorBusy(true)
    const { result, error } = await run(() => api('/doctor'))
    setDoctorBusy(false)
    setDoctor(result?.doctor || { ok: false, summary: error || 'diagnostics failed', checks: [] })
  }
  const url = config?.uiUrl || config?.endpoint || ''
  if (!url) return h('div', { style: S.muted }, '正在读取 ARTEX 配置…')

  const down = health && health.artex && health.artex.ok === false
  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    h('div', { style: { ...S.row, padding: '6px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1, #e5e7eb)' } },
      h('span', { style: S.muted }, `ARTEX: ${url}`),
      h('span', { style: { flex: 1 } }),
      h('a', { href: url, target: '_blank', rel: 'noreferrer', style: { ...S.button, textDecoration: 'none' } }, '新标签打开'),
      h('button', { style: S.button, onClick: runDoctor, disabled: doctorBusy }, doctorBusy ? '诊断中…' : '诊断'),
      h('button', { style: S.button, onClick: onStart, disabled: starting }, starting ? '启动中…' : '启动/重连'),
    ),
    doctor
      ? h('div', { style: { ...S.card, margin: '6px 10px', maxHeight: 260, overflow: 'auto' } },
          h('div', { style: { ...S.row, marginBottom: 4 } },
            h('strong', null, '诊断'),
            h('span', { style: S.muted }, doctor.summary || ''),
          ),
          (doctor.checks || []).map((check) => h('div', { key: check.name, style: { ...S.row, fontSize: 11, marginTop: 2 } },
            h(Badge, { tone: check.status === 'error' ? 'danger' : undefined }, check.status),
            h('span', { style: { minWidth: 90 } }, check.name),
            h('span', { style: { ...S.muted, wordBreak: 'break-all' } }, check.detail),
          )),
        )
      : null,
    down || startError
      ? h('div', { style: { padding: '8px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1, #e5e7eb)' } },
          h('div', { style: S.error }, startError || health?.artex?.error || 'ARTEX 未运行'),
          h('div', { style: { ...S.muted, marginTop: 4 } },
            '首次使用请在配置中设置 runtime=docker 与 artexDir，然后点“启动/重连”。也可以连接一个已在运行的外部 ARTEX。'),
        )
      : null,
    h('iframe', {
      src: url,
      title: 'ARTEX console',
      style: { flex: 1, width: '100%', border: 0, minHeight: 0, background: '#fff' },
    }),
  )
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
function parseScopes(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(':')
      if (colon < 0) return { kind: 'root_domain', value: line, reason: 'dsh-artex' }
      const kind = line.slice(0, colon).trim()
      const rest = line.slice(colon + 1)
      const bar = rest.indexOf('|')
      const value = (bar < 0 ? rest : rest.slice(0, bar)).trim()
      const reason = (bar < 0 ? 'dsh-artex' : rest.slice(bar + 1).trim()) || 'dsh-artex'
      return { kind, value, reason }
    })
}

function TaskCard({ task, selected, onSelect }) {
  const findings = task.findings || {}
  const total = (findings.critical || 0) + (findings.high || 0) + (findings.medium || 0) + (findings.low || 0)
  return h('button', {
    onClick: () => onSelect(task.id),
    style: {
      ...S.card,
      width: '100%',
      textAlign: 'left',
      cursor: 'pointer',
      borderColor: selected ? 'var(--dsw-alias-brand-primary, #6b34db)' : 'var(--dsw-alias-border-l1, #e5e7eb)',
    },
  },
    h('div', { style: { ...S.row, justifyContent: 'space-between' } },
      h('strong', null, task.name || `Task ${task.id}`),
      h('span', { style: S.row },
        h(Badge, { tone: task.status === 'failed' || task.status === 'timeout' ? 'danger' : undefined }, task.status),
        task.paused ? h(Badge, null, 'paused') : null,
        task.queued ? h(Badge, null, 'queued') : null,
      ),
    ),
    h('div', { style: { ...S.muted, marginTop: 4 } },
      `goals ${task.goals_met}/${task.goals_total} · in flight ${task.in_flight} · findings ${total}`),
    h('div', { style: { marginTop: 4 } }, task.goal || ''),
  )
}

const TEMPLATE_KINDS = ['exact_domain', 'exact_url', 'exact_ip', 'fuzzy_domain', 'fuzzy_ip', 'fuzzy_url', 'cidr']

function templateDraft(template) {
  return {
    name: template?.name || '',
    description: template?.description || '',
    goal: template?.goal || '',
    category_id: template?.category_id == null ? '' : String(template.category_id),
    intercept_rules: (template?.intercept_rules || []).map((rule) => ({
      enabled: rule.enabled !== false,
      action: rule.action === 'allow' ? 'allow' : 'block',
      kind: rule.kind || 'exact_domain',
      pattern: rule.pattern || '',
      note: rule.note || '',
    })),
  }
}

function TaskTemplates({ categories }) {
  const templates = usePoll('/task/templates', 60_000)
  const [selectedID, setSelectedID] = useState(null)
  const [draft, setDraft] = useState(templateDraft(null))
  const [rule, setRule] = useState({ action: 'block', kind: 'exact_domain', pattern: '', note: '' })
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const list = templates.data?.templates || []

  const select = (template) => {
    setSelectedID(template.id)
    setDraft(templateDraft(template))
    setNotice('')
  }

  const startNew = () => {
    setSelectedID(null)
    setDraft(templateDraft(null))
    setNotice('')
  }

  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }))

  const addRule = () => {
    if (!rule.pattern.trim()) return setNotice('rule pattern 不能为空')
    setDraft((current) => ({
      ...current,
      intercept_rules: [...current.intercept_rules, { ...rule, pattern: rule.pattern.trim(), enabled: true }],
    }))
    setRule({ action: 'block', kind: 'exact_domain', pattern: '', note: '' })
    setNotice('')
  }

  const removeRule = (index) => {
    setDraft((current) => ({ ...current, intercept_rules: current.intercept_rules.filter((_, i) => i !== index) }))
  }

  const save = async () => {
    if (!draft.name.trim() || !draft.description.trim() || !draft.goal.trim()) {
      return setNotice('name、description、goal 都必须填写')
    }
    setBusy(true)
    setNotice('')
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      goal: draft.goal.trim(),
      category_id: draft.category_id === '' ? null : Number(draft.category_id),
      intercept_rules: draft.intercept_rules,
    }
    const { result, error } = selectedID == null
      ? await run(() => api('/task/template', { body: payload }))
      : await run(() => api(`/task/template?id=${encodeURIComponent(selectedID)}`, { method: 'PATCH', body: payload }))
    setBusy(false)
    if (error) return setNotice(error)
    const saved = result?.data || result
    if (saved?.id) {
      setSelectedID(saved.id)
      setDraft(templateDraft(saved))
    }
    setNotice(selectedID == null ? '模板已创建' : '模板已保存')
    templates.refresh()
  }

  const remove = async () => {
    if (selectedID == null) return
    if (!window.confirm(`删除模板 ${draft.name || selectedID}？`)) return
    setBusy(true)
    setNotice('')
    const { error } = await run(() => api(`/task/template?id=${encodeURIComponent(selectedID)}`, { method: 'DELETE' }))
    setBusy(false)
    if (error) return setNotice(error)
    startNew()
    setNotice('模板已删除')
    templates.refresh()
  }

  return h('div', { style: { ...S.card, marginBottom: 8 } },
    h('div', { style: { ...S.row, marginBottom: 6 } },
      h('strong', null, '任务模板'),
      h('button', { style: S.button, onClick: startNew }, '新建模板'),
      h('span', { style: { flex: 1 } }),
      h('button', { style: S.button, onClick: templates.refresh }, '刷新'),
    ),
    h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
      h('div', { style: { flex: '1 1 220px', minWidth: 200 } },
        h('div', { style: { ...S.muted, fontSize: 11, marginBottom: 4 } }, '已有模板'),
        list.length === 0
          ? h('div', { style: S.muted }, '还没有模板。')
          : list.map((template) => h('div', {
              key: template.id,
              onClick: () => select(template),
              style: {
                ...S.card,
                padding: 7,
                marginBottom: 5,
                cursor: 'pointer',
                border: selectedID === template.id ? '1px solid #2f6feb' : undefined,
              },
            },
              h('div', { style: { fontWeight: 600, fontSize: 12 } }, template.name),
              h('div', { style: { ...S.muted, fontSize: 11, whiteSpace: 'pre-wrap' } }, template.description || ''),
              h('div', { style: { ...S.muted, fontSize: 11, marginTop: 2 } },
                `${template.goal ? `${template.goal.length} 字符 goal` : '无 goal'} · rules ${(template.intercept_rules || []).length}`),
            )),
      ),
      h('div', { style: { flex: '2 1 320px', minWidth: 260 } },
        h('div', { style: { ...S.muted, fontSize: 11, marginBottom: 4 } }, selectedID == null ? '新模板' : `编辑模板 #${selectedID}`),
        h('input', {
          value: draft.name,
          onChange: (event) => update('name', event.target.value),
          placeholder: '模板名',
          style: { ...S.input, marginBottom: 5 },
        }),
        h('textarea', {
          value: draft.description,
          onChange: (event) => update('description', event.target.value),
          placeholder: '任务描述（应用模板时预填）',
          rows: 2,
          style: { ...S.input, resize: 'vertical', marginBottom: 5 },
        }),
        h('textarea', {
          value: draft.goal,
          onChange: (event) => update('goal', event.target.value),
          placeholder: 'Goal（应用模板时预填，需要包含目标与测试方向）',
          rows: 4,
          style: { ...S.input, resize: 'vertical', marginBottom: 5 },
        }),
        h('select', {
          value: draft.category_id,
          onChange: (event) => update('category_id', event.target.value),
          style: { ...S.input, marginBottom: 5 },
        },
          h('option', { value: '' }, '（不指定分类）'),
          (categories || []).map((category) => h('option', { key: category.id, value: String(category.id) }, category.name)),
        ),
        h('div', { style: { ...S.muted, fontSize: 11, marginBottom: 3 } }, `任务级 intercept/allow 规则（${draft.intercept_rules.length}）`),
        draft.intercept_rules.map((item, index) => h('div', { key: index, style: { ...S.row, fontSize: 11, marginBottom: 3 } },
          h(Badge, { tone: item.action === 'block' ? 'danger' : undefined }, item.action),
          h('span', null, item.kind),
          h('span', { style: { flex: 1, wordBreak: 'break-all' } }, item.pattern),
          h('button', { style: S.danger, onClick: () => removeRule(index) }, '移除'),
        )),
        h('div', { style: { ...S.row, flexWrap: 'wrap', marginBottom: 6 } },
          h('select', { value: rule.action, onChange: (event) => setRule((current) => ({ ...current, action: event.target.value })), style: { ...S.input, width: 92, flex: '0 0 auto' } },
            h('option', { value: 'block' }, 'block'),
            h('option', { value: 'allow' }, 'allow'),
          ),
          h('select', { value: rule.kind, onChange: (event) => setRule((current) => ({ ...current, kind: event.target.value })), style: { ...S.input, width: 128, flex: '0 0 auto' } },
            TEMPLATE_KINDS.map((kind) => h('option', { key: kind, value: kind }, kind)),
          ),
          h('input', { value: rule.pattern, onChange: (event) => setRule((current) => ({ ...current, pattern: event.target.value })), placeholder: 'pattern', style: { ...S.input, flex: 1, minWidth: 120 } }),
          h('input', { value: rule.note, onChange: (event) => setRule((current) => ({ ...current, note: event.target.value })), placeholder: 'note', style: { ...S.input, width: 110, flex: '0 0 auto' } }),
          h('button', { style: S.button, onClick: addRule }, '添加规则'),
        ),
        h('div', { style: S.row },
          h('button', { style: S.primary, onClick: save, disabled: busy }, busy ? '保存中…' : selectedID == null ? '创建模板' : '保存修改'),
          selectedID == null ? null : h('button', { style: S.danger, onClick: remove, disabled: busy }, '删除模板'),
        ),
      ),
    ),
    notice ? h('div', { style: { ...S.muted, marginTop: 5 } }, notice) : null,
    templates.error ? h('div', { style: { ...S.error, marginTop: 5 } }, templates.error) : null,
  )
}

function CreateTask({ onCreated, requireAck }) {
  const [open, setOpen] = useState(false)
  const [goal, setGoal] = useState('')
  const [description, setDescription] = useState('')
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState('')
  const [ack, setAck] = useState(false)
  const [templateID, setTemplateID] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const templates = usePoll('/task/templates', 60_000, open)
  const templateList = templates.data?.templates || []
  const template = templateList.find((item) => String(item.id) === String(templateID)) || null

  const chooseTemplate = (value) => {
    setTemplateID(value)
    const picked = templateList.find((item) => String(item.id) === String(value))
    if (!picked) return
    setGoal(picked.goal || '')
    setDescription(picked.description || '')
    setName((current) => current.trim() ? current : (picked.name || ''))
  }

  const submit = async () => {
    setError('')
    if (requireAck && !ack) {
      setError('请先勾选授权确认：你拥有或已获授权测试这些目标。')
      return
    }
    const parsed = parseScopes(scopes)
    if (!goal.trim()) return setError('goal 不能为空')
    if (parsed.length === 0) return setError('至少填写一条 scope')
    setBusy(true)
    const { result, error: failure } = await run(() => api('/task/create', {
      body: {
        name: name.trim() || template?.name || '',
        description: description.trim(),
        goal: goal.trim(),
        scopes: parsed,
        authorization_ack: ack,
        seed_first_intent: true,
        ...(template?.category_id != null ? { category_id: template.category_id } : {}),
        ...((template?.intercept_rules || []).length ? { intercept_rules: template.intercept_rules } : {}),
      },
    }))
    setBusy(false)
    if (failure) return setError(failure)
    setOpen(false)
    setGoal('')
    setDescription('')
    setScopes('')
    setAck(false)
    setTemplateID('')
    onCreated?.(result.task)
  }

  if (!open) {
    return h('div', { style: { marginBottom: 8 } },
      h('button', { style: S.primary, onClick: () => setOpen(true) }, '新建任务'),
      error ? h('div', { style: S.error }, error) : null,
    )
  }

  return h('div', { style: S.card },
    h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '新建 ARTEX 任务'),
    templateList.length
      ? h('label', { style: { display: 'block', marginBottom: 6 } },
          h('div', { style: S.muted }, '从模板填充（可选）'),
          h('select', {
            value: templateID,
            onChange: (event) => chooseTemplate(event.target.value),
            style: S.input,
          },
            h('option', { value: '' }, '（不使用模板）'),
            templateList.map((item) => h('option', { key: item.id, value: String(item.id) }, item.name)),
          ),
          template
            ? h('div', { style: { ...S.muted, fontSize: 11, marginTop: 2 } },
                `已应用：分类 ${template.category_id == null ? '无' : template.category_id} · 规则 ${(template.intercept_rules || []).length} 条（创建时随任务生效）`)
            : null,
        )
      : null,
    h('label', { style: { display: 'block', marginBottom: 6 } },
      h('div', { style: S.muted }, '描述（可选，默认 Unnamed task）'),
      h('textarea', {
        value: description,
        onChange: (event) => setDescription(event.target.value),
        rows: 2,
        style: { ...S.input, resize: 'vertical' },
        placeholder: '任务背景、授权边界或特别说明',
      }),
    ),
    h('label', { style: { display: 'block', marginBottom: 6 } },
      h('div', { style: S.muted }, 'Goal（≥80 字符，包含目标域名/IP 和测试方向）'),
      h('textarea', {
        value: goal,
        onChange: (event) => setGoal(event.target.value),
        rows: 4,
        style: { ...S.input, resize: 'vertical' },
        placeholder: '对 example.com 进行授权渗透测试：枚举子域、服务与端点，重点验证 SQLi/XSS/SSRF，禁止 DoS 与数据破坏。',
      }),
    ),
    h('label', { style: { display: 'block', marginBottom: 6 } },
      h('div', { style: S.muted }, '任务名（可选）'),
      h('input', { value: name, onChange: (event) => setName(event.target.value), style: S.input }),
    ),
    h('label', { style: { display: 'block', marginBottom: 6 } },
      h('div', { style: S.muted }, 'Scope（每行一条：kind:value|授权说明；kind 为 company/root_domain/subdomain/ip/cidr/icp/keyword）'),
      h('textarea', {
        value: scopes,
        onChange: (event) => setScopes(event.target.value),
        rows: 3,
        style: { ...S.input, resize: 'vertical' },
        placeholder: 'root_domain:example.com|客户合同 #2026-001\ncidr:203.0.113.0/24|自有资产',
      }),
    ),
    h('label', { style: { ...S.row, marginBottom: 8, cursor: 'pointer' } },
      h('input', { type: 'checkbox', checked: ack, onChange: (event) => setAck(event.target.checked) }),
      h('span', null, '我确认拥有这些目标，或已获得明确授权在 scope 内测试。'),
    ),
    h('div', { style: S.row },
      h('button', { style: S.primary, onClick: submit, disabled: busy }, busy ? '创建中…' : '创建'),
      h('button', { style: S.button, onClick: () => setOpen(false), disabled: busy }, '取消'),
    ),
    error ? h('div', { style: { ...S.error, marginTop: 6 } }, error) : null,
  )
}

function ActivityFeed({ taskId }) {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)
  const cursorRef = useRef(0)
  const seenRef = useRef(new Set())

  const append = useCallback((nextItems) => {
    if (!Array.isArray(nextItems) || nextItems.length === 0) return
    setItems((previous) => {
      const merged = [...previous]
      for (const item of nextItems) {
        const key = activityKey(item)
        if (key === undefined || seenRef.current.has(key)) continue
        seenRef.current.add(key)
        merged.push(item)
        if (typeof key === 'number' && key > cursorRef.current) cursorRef.current = key
      }
      return merged.slice(-80)
    })
  }, [])

  useEffect(() => {
    setItems([])
    setError('')
    setLive(false)
    cursorRef.current = 0
    seenRef.current = new Set()
  }, [taskId])

  // Polling fallback. SSE is primary; this keeps the feed alive when the
  // stream is blocked by a proxy or the upstream has no SSE support.
  useEffect(() => {
    if (!taskId) return undefined
    let alive = true
    const controller = new AbortController()
    const load = async () => {
      try {
        const data = await api(
          `/activity?task=${encodeURIComponent(taskId)}&since=${cursorRef.current}&limit=100`,
          { signal: controller.signal },
        )
        if (!alive) return
        append(data.items)
        setError('')
      } catch (failure) {
        if (alive && failure?.name !== 'AbortError') setError(failure.message)
      }
    }
    const timer = setInterval(load, 10_000)
    load()
    return () => {
      alive = false
      clearInterval(timer)
      controller.abort()
    }
  }, [taskId, append])

  // Primary live tail: same-origin SSE proxied by the Host half. EventSource
  // reconnects automatically and sends Last-Event-ID, which the proxy forwards.
  useEffect(() => {
    if (!taskId || typeof EventSource === 'undefined') return undefined
    let source
    try {
      source = new EventSource(`${BASE}/activity/stream?task=${encodeURIComponent(taskId)}&since=0`)
    } catch {
      return undefined
    }
    source.onopen = () => {
      setLive(true)
      setError('')
    }
    source.onmessage = (event) => {
      try {
        append([JSON.parse(event.data)])
      } catch {
        // Ignore keep-alive comments or malformed frames.
      }
    }
    source.onerror = () => {
      setLive(false)
      setError('实时流中断，正在用轮询兜底（会自动重连）。')
    }
    return () => source.close()
  }, [taskId, append])

  if (!taskId) return null
  return h('div', { style: { marginTop: 10 } },
    h('div', { style: { ...S.row, marginBottom: 4 } },
      h('div', { style: { fontWeight: 600 } }, '实时活动'),
      h('span', { style: { ...S.muted, fontSize: 11 } }, live ? '● SSE' : '○ 轮询兜底'),
    ),
    error ? h('div', { style: S.error }, error) : null,
    items.length === 0
      ? h('div', { style: S.muted }, '暂无活动（任务可能刚创建或正在规划）。')
      : h('div', null, items.slice(-40).map((item) => h('div', { key: activityKey(item), style: { ...S.card, padding: 8 } },
          h('div', { style: S.row },
            h('span', { style: S.muted }, `#${activityKey(item)}`),
            item.worker ? h(Badge, null, item.worker) : null,
            item.tool ? h(Badge, null, item.tool) : null,
            h('span', { style: S.muted }, item.kind || ''),
          ),
          h('div', { style: { marginTop: 2, whiteSpace: 'pre-wrap' } }, item.summary || ''),
        ))),
  )
}

function TaskGoals({ taskId }) {
  const data = usePoll(`/task/goals?task=${encodeURIComponent(taskId || '')}`, 10_000, Boolean(taskId))
  const [text, setText] = useState('')
  const [vulnclass, setVulnclass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const goals = data.data?.goals || []

  const add = async () => {
    if (!text.trim()) return setError('goal text 不能为空')
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/task/goal', { body: { task_id: taskId, text: text.trim(), vulnclass } }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setText('')
      setVulnclass('')
      data.refresh()
    }
  }

  const remove = async (goal) => {
    if (!window.confirm('删除这个 goal？')) return
    const { error: failure } = await run(() => api(`/task/goal?task=${encodeURIComponent(taskId)}&id=${encodeURIComponent(goal.id)}`, { method: 'DELETE' }))
    if (failure) setError(failure)
    else data.refresh()
  }

  if (!taskId) return null
  return h('div', null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    error ? h('div', { style: { ...S.error, marginBottom: 4 } }, error) : null,
    goals.length === 0
      ? h('div', { style: S.muted }, '还没有 goal。')
      : goals.map((goal) => h('div', { key: goal.id, style: { ...S.card, padding: 8 } },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('div', { style: S.row },
              h(Badge, { tone: goal.state === 'met' ? undefined : 'danger' }, goal.state || 'open'),
              goal.vulnclass ? h(Badge, null, goal.vulnclass) : null,
            ),
            h('button', { style: S.danger, onClick: () => remove(goal) }, '删除'),
          ),
          h('div', { style: { marginTop: 2, whiteSpace: 'pre-wrap' } }, goal.text || ''),
        )),
    h('div', { style: { ...S.row, marginTop: 6 } },
      h('input', { value: text, onChange: (event) => setText(event.target.value), placeholder: '新 goal 文本', style: { ...S.input, flex: 1 } }),
      h('input', { value: vulnclass, onChange: (event) => setVulnclass(event.target.value), placeholder: 'vulnclass（可选）', style: { ...S.input, width: 130, flex: '0 0 auto' } }),
      h('button', { style: S.primary, onClick: add, disabled: busy }, busy ? '添加中…' : '添加'),
    ),
  )
}

function TaskScope({ taskId }) {
  const data = usePoll(`/task/scope?task=${encodeURIComponent(taskId || '')}`, 15_000, Boolean(taskId))
  const [kind, setKind] = useState('root_domain')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rows = data.data?.scope || []

  const add = async () => {
    if (!value.trim()) return setError('scope value 不能为空')
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/task/scope', {
      body: { task_id: taskId, kind, value: value.trim(), reason: reason.trim() || 'dsh-artex' },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setValue('')
      setReason('')
      data.refresh()
    }
  }

  const remove = async (row) => {
    if (!window.confirm('删除这条 scope？')) return
    const { error: failure } = await run(() => api(`/task/scope?task=${encodeURIComponent(taskId)}&id=${encodeURIComponent(row.id)}`, { method: 'DELETE' }))
    if (failure) setError(failure)
    else data.refresh()
  }

  if (!taskId) return null
  return h('div', null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    error ? h('div', { style: { ...S.error, marginBottom: 4 } }, error) : null,
    rows.length === 0
      ? h('div', { style: S.muted }, '还没有 scope。')
      : rows.map((row) => h('div', { key: row.id, style: { ...S.card, padding: 8 } },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('div', { style: S.row },
              h(Badge, null, row.kind || '?'),
              h('span', null, row.domain || row.net || row.value || row.company_name || ''),
            ),
            h('button', { style: S.danger, onClick: () => remove(row) }, '删除'),
          ),
          row.reason ? h('div', { style: { ...S.muted, fontSize: 11, marginTop: 2 } }, row.reason) : null,
        )),
    h('div', { style: { ...S.row, marginTop: 6 } },
      h('select', { value: kind, onChange: (event) => setKind(event.target.value), style: { ...S.input, width: 130, flex: '0 0 auto' } },
        ['root_domain', 'subdomain', 'ip', 'cidr', 'company', 'icp', 'keyword'].map((value) => h('option', { key: value, value }, value))),
      h('input', { value, onChange: (event) => setValue(event.target.value), placeholder: 'value', style: { ...S.input, flex: 1 } }),
      h('input', { value: reason, onChange: (event) => setReason(event.target.value), placeholder: 'reason', style: { ...S.input, width: 150, flex: '0 0 auto' } }),
      h('button', { style: S.primary, onClick: add, disabled: busy }, busy ? '添加中…' : '添加'),
    ),
  )
}

function TaskConstraints({ taskId }) {
  const data = usePoll(`/task/constraints?task=${encodeURIComponent(taskId || '')}`, 15_000, Boolean(taskId))
  const [kind, setKind] = useState('allow')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rows = data.data?.constraints || []

  const add = async () => {
    if (!text.trim()) return setError('constraint text 不能为空')
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/task/constraint', {
      body: { task_id: taskId, kind, text: text.trim() },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setText('')
      data.refresh()
    }
  }

  const remove = async (row) => {
    if (!window.confirm('删除这条 constraint？')) return
    const { error: failure } = await run(() => api(`/task/constraint?task=${encodeURIComponent(taskId)}&id=${encodeURIComponent(row.id)}`, { method: 'DELETE' }))
    if (failure) setError(failure)
    else data.refresh()
  }

  if (!taskId) return null
  return h('div', null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    error ? h('div', { style: { ...S.error, marginBottom: 4 } }, error) : null,
    rows.length === 0
      ? h('div', { style: S.muted }, '还没有 operation constraint。')
      : rows.map((row) => h('div', { key: row.id, style: { ...S.card, padding: 8 } },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('div', { style: S.row },
              h(Badge, { tone: row.kind === 'deny' ? 'danger' : undefined }, row.kind || '?'),
              h('span', { style: { ...S.muted, fontSize: 11 } }, row.origin || ''),
            ),
            h('button', { style: S.danger, onClick: () => remove(row) }, '删除'),
          ),
          h('div', { style: { marginTop: 2, whiteSpace: 'pre-wrap' } }, row.text || ''),
        )),
    h('div', { style: { ...S.row, marginTop: 6 } },
      h('select', { value: kind, onChange: (event) => setKind(event.target.value), style: { ...S.input, width: 100, flex: '0 0 auto' } },
        h('option', { value: 'allow' }, 'allow'),
        h('option', { value: 'deny' }, 'deny'),
      ),
      h('input', { value: text, onChange: (event) => setText(event.target.value), placeholder: 'constraint 文本', style: { ...S.input, flex: 1 } }),
      h('button', { style: S.primary, onClick: add, disabled: busy }, busy ? '添加中…' : '添加'),
    ),
  )
}

function TaskCredentials({ taskId }) {
  const data = usePoll(`/task/credentials?task=${encodeURIComponent(taskId || '')}`, 15_000, Boolean(taskId))
  const [domain, setDomain] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rows = data.data?.credentials || []

  const add = async () => {
    if (!domain.trim() || !username.trim()) return setError('domain 和 username 必填')
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/task/credential', {
      body: { task_id: taskId, domain: domain.trim(), username: username.trim(), password, note: note.trim() },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setDomain('')
      setUsername('')
      setPassword('')
      setNote('')
      data.refresh()
    }
  }

  const remove = async (row) => {
    if (!window.confirm(`删除 ${row.username}@${row.domain} 的凭据？`)) return
    const { error: failure } = await run(() => api(`/task/credential?task=${encodeURIComponent(taskId)}&id=${encodeURIComponent(row.id)}`, { method: 'DELETE' }))
    if (failure) setError(failure)
    else data.refresh()
  }

  if (!taskId) return null
  return h('div', null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    error ? h('div', { style: { ...S.error, marginBottom: 4 } }, error) : null,
    rows.length === 0
      ? h('div', { style: S.muted }, '还没有任务凭据。')
      : rows.map((row) => h('div', { key: row.id, style: { ...S.card, padding: 8 } },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('div', { style: S.row },
              h(Badge, null, row.domain || '?'),
              h('strong', null, row.username || ''),
              row.source ? h(Badge, null, row.source) : null,
            ),
            h('button', { style: S.danger, onClick: () => remove(row) }, '删除'),
          ),
          h('div', { style: { ...S.muted, fontSize: 11, marginTop: 2 } },
            `password: ${row.password || '(not set)'}${row.note ? ` · ${row.note}` : ''}`),
        )),
    h('div', { style: { ...S.row, marginTop: 6, flexWrap: 'wrap' } },
      h('input', { value: domain, onChange: (event) => setDomain(event.target.value), placeholder: 'domain', style: { ...S.input, width: 150, flex: '0 0 auto' } }),
      h('input', { value: username, onChange: (event) => setUsername(event.target.value), placeholder: 'username', style: { ...S.input, width: 130, flex: '0 0 auto' } }),
      h('input', { type: 'password', value: password, onChange: (event) => setPassword(event.target.value), placeholder: 'password（空=agent 生成）', style: { ...S.input, width: 180, flex: '0 0 auto' } }),
      h('input', { value: note, onChange: (event) => setNote(event.target.value), placeholder: 'note', style: { ...S.input, flex: 1, minWidth: 120 } }),
      h('button', { style: S.primary, onClick: add, disabled: busy }, busy ? '添加中…' : '添加'),
    ),
  )
}

function TaskIntercept({ taskId }) {
  const data = usePoll(`/task/intercept?task=${encodeURIComponent(taskId || '')}`, 15_000, Boolean(taskId))
  const [action, setAction] = useState('block')
  const [kind, setKind] = useState('exact_domain')
  const [pattern, setPattern] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rules = data.data?.rules || []

  const add = async () => {
    if (!pattern.trim()) return setError('pattern 不能为空')
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/task/intercept', {
      body: { task_id: taskId, action, kind, pattern: pattern.trim(), note: note.trim(), enabled: true },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setPattern('')
      setNote('')
      data.refresh()
    }
  }

  const toggle = async (rule) => {
    const { error: failure } = await run(() => api('/task/intercept/toggle', { body: { task_id: taskId, id: rule.id } }))
    if (failure) setError(failure)
    else data.refresh()
  }

  const remove = async (rule) => {
    if (!window.confirm('删除这条 intercept rule？')) return
    const { error: failure } = await run(() => api(`/task/intercept?task=${encodeURIComponent(taskId)}&id=${encodeURIComponent(rule.id)}`, { method: 'DELETE' }))
    if (failure) setError(failure)
    else data.refresh()
  }

  if (!taskId) return null
  return h('div', null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    error ? h('div', { style: { ...S.error, marginBottom: 4 } }, error) : null,
    h('div', { style: { ...S.muted, marginBottom: 4, fontSize: 11 } },
      '任务级规则：block = 拦截并等待审批；allow = 白名单放行。只影响本任务。'),
    rules.length === 0
      ? h('div', { style: S.muted }, '还没有任务级 intercept rule。')
      : rules.map((rule) => h('div', { key: rule.id, style: { ...S.card, padding: 8 } },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('div', { style: S.row },
              h(Badge, { tone: rule.action === 'block' ? 'danger' : undefined }, rule.action || 'block'),
              h(Badge, null, rule.kind || '?'),
              h('span', { style: { wordBreak: 'break-all' } }, rule.pattern || ''),
              h(Badge, { tone: rule.enabled ? undefined : 'danger' }, rule.enabled ? 'enabled' : 'disabled'),
            ),
            h('div', { style: S.row },
              h('button', { style: S.button, onClick: () => toggle(rule) }, rule.enabled ? '禁用' : '启用'),
              h('button', { style: S.danger, onClick: () => remove(rule) }, '删除'),
            ),
          ),
          rule.note ? h('div', { style: { ...S.muted, fontSize: 11, marginTop: 2 } }, rule.note) : null,
        )),
    h('div', { style: { ...S.row, marginTop: 6, flexWrap: 'wrap' } },
      h('select', { value: action, onChange: (event) => setAction(event.target.value), style: { ...S.input, width: 100, flex: '0 0 auto' } },
        h('option', { value: 'block' }, 'block'),
        h('option', { value: 'allow' }, 'allow'),
      ),
      h('select', { value: kind, onChange: (event) => setKind(event.target.value), style: { ...S.input, width: 130, flex: '0 0 auto' } },
        ['exact_domain', 'exact_url', 'exact_ip', 'fuzzy_domain', 'fuzzy_ip', 'fuzzy_url', 'cidr'].map((value) => h('option', { key: value, value }, value)),
      ),
      h('input', { value: pattern, onChange: (event) => setPattern(event.target.value), placeholder: 'pattern', style: { ...S.input, flex: 1, minWidth: 160 } }),
      h('input', { value: note, onChange: (event) => setNote(event.target.value), placeholder: 'note', style: { ...S.input, width: 140, flex: '0 0 auto' } }),
      h('button', { style: S.primary, onClick: add, disabled: busy }, busy ? '添加中…' : '添加'),
    ),
  )
}

function TaskPlan({ taskId }) {
  const [view, setView] = useState('goals')
  if (!taskId) return null
  return h('div', { style: { marginTop: 12 } },
    h('div', { style: { ...S.row, marginBottom: 6 } },
      h('strong', null, 'Plan'),
      ['goals', 'scope', 'constraints', 'credentials', 'intercept'].map((id) => h('button', {
        key: id,
        style: { ...S.tab, ...(view === id ? S.tabActive : {}) },
        onClick: () => setView(id),
      }, id)),
    ),
    view === 'goals'
      ? h(TaskGoals, { taskId })
      : view === 'scope'
        ? h(TaskScope, { taskId })
        : view === 'constraints'
          ? h(TaskConstraints, { taskId })
          : view === 'credentials'
            ? h(TaskCredentials, { taskId })
            : h(TaskIntercept, { taskId }),
  )
}

function TaskChat({ taskId }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const send = async () => {
    const text = message.trim()
    if (!text || !taskId) return
    setBusy(true)
    setNotice('')
    setError('')
    const { result, error: failure } = await run(() => api('/chat', {
      body: { task_id: taskId, message: text },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setMessage('')
      const reply = result?.data?.reply
      if (reply) setNotice(`ARTEX 规则模式回复：${reply}`)
      else setNotice('已发送给 ARTEX main agent；回复会出现在下面的实时活动。')
    }
  }

  if (!taskId) return null
  return h('div', { style: { marginTop: 12 } },
    h('div', { style: { fontWeight: 600, marginBottom: 4 } }, '操作员消息（HITL）'),
    h('div', { style: { ...S.muted, marginBottom: 4, fontSize: 11 } },
      '发送给 ARTEX main agent。它能看到任务上下文；回复走活动流，不会直接执行你的指令。'),
    h('textarea', {
      value: message,
      onChange: (event) => setMessage(event.target.value),
      rows: 2,
      placeholder: '例如：先只做被动侦察，不要主动发包；发现登录接口后暂停等我确认。',
      style: { ...S.input, resize: 'vertical' },
    }),
    h('div', { style: { ...S.row, marginTop: 4 } },
      h('button', { style: S.primary, onClick: send, disabled: busy || !message.trim() }, busy ? '发送中…' : '发送'),
    ),
    notice ? h('div', { style: { ...S.muted, marginTop: 4 } }, notice) : null,
    error ? h('div', { style: { ...S.error, marginTop: 4 } }, error) : null,
  )
}

function TaskReport({ taskId }) {
  const [open, setOpen] = useState(false)
  const [report, setReport] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setBusy(true)
    setError('')
    const { result, error: failure } = await run(() => api(`/report?task=${encodeURIComponent(taskId)}`))
    setBusy(false)
    if (failure) setError(failure)
    else setReport(result?.report || '')
  }

  const download = () => {
    if (!report) return
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `artex-task-${taskId}-report.md`
    anchor.click()
    URL.revokeObjectURL(href)
  }

  if (!taskId) return null
  return h('div', { style: { marginTop: 12 } },
    h('div', { style: S.row },
      h('button', { style: S.button, onClick: toggle }, open ? '收起报告' : '生成报告'),
      report ? h('button', { style: S.button, onClick: download }, '下载 .md') : null,
    ),
    busy ? h('div', { style: S.muted }, '生成中…') : null,
    error ? h('div', { style: S.error }, error) : null,
    open && report
      ? h('pre', { style: { ...S.pre, maxHeight: 460, marginTop: 6 } }, report)
      : null,
  )
}

function FindingControls({ finding, onSaved }) {
  const [status, setStatus] = useState(finding.status || 'pending')
  const [severity, setSeverity] = useState(finding.severity || 'medium')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api(`/finding?id=${encodeURIComponent(finding.finding_id || finding.id)}`, {
      method: 'PATCH',
      body: { status, severity },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else onSaved?.()
  }

  return h('div', { style: { marginTop: 4 } },
    h('div', { style: S.row },
      h('select', { value: status, onChange: (event) => setStatus(event.target.value), style: { ...S.input, width: 130, flex: '0 0 auto' } },
        ['pending', 'in_progress', 'confirmed', 'resolved', 'fixed', 'false_positive', 'ignored', 'duplicate', 'risk_accepted']
          .map((value) => h('option', { key: value, value }, value)),
      ),
      h('select', { value: severity, onChange: (event) => setSeverity(event.target.value), style: { ...S.input, width: 110, flex: '0 0 auto' } },
        ['critical', 'high', 'medium', 'low'].map((value) => h('option', { key: value, value }, value)),
      ),
      h('button', { style: S.button, onClick: save, disabled: busy }, busy ? '保存中…' : '保存状态'),
    ),
    error ? h('div', { style: { ...S.error, marginTop: 2 } }, error) : null,
  )
}

function FindingRetest({ findingId }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retests, setRetests] = useState([])

  const load = async () => {
    const { result, error: failure } = await run(() => api(`/finding/retests?id=${encodeURIComponent(findingId)}`))
    if (failure) setError(failure)
    else setRetests(result?.retests || [])
  }

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setError('')
    setNotice('')
    await load()
  }

  const start = async () => {
    if (!confirmed) {
      setError('请先勾选确认：复测会调用 LLM 重新验证。')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    const { error: failure } = await run(() => api('/finding/retest', {
      body: { finding_id: findingId, notes: notes.trim() },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setNotice('复测已启动；结果会写入下方的复测记录。')
      setNotes('')
      setConfirmed(false)
      setTimeout(load, 1500)
    }
  }

  return h('div', { style: { marginTop: 4 } },
    h('button', { style: S.button, onClick: toggle }, open ? '收起复测' : '复测 / 记录'),
    open
      ? h('div', { style: { ...S.card, padding: 8, marginTop: 6 } },
          h('div', { style: { ...S.muted, marginBottom: 4 } },
            '复测会运行 ARTEX retester agent 并调用 LLM；原始证据和报告不会被覆盖。'),
          h('textarea', {
            value: notes,
            onChange: (event) => setNotes(event.target.value),
            rows: 2,
            placeholder: '可选：修复版本、复测条件、要重点确认的内容',
            style: { ...S.input, resize: 'vertical' },
          }),
          h('label', { style: { ...S.row, marginTop: 4, fontSize: 11, cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: confirmed,
              onChange: (event) => setConfirmed(event.target.checked),
            }),
            h('span', null, '我确认复测会调用 LLM 重新测试'),
          ),
          h('div', { style: { ...S.row, marginTop: 4 } },
            h('button', { style: S.primary, onClick: start, disabled: busy || !confirmed }, busy ? '启动中…' : '确认复测'),
            h('button', { style: S.button, onClick: load, disabled: busy }, '刷新记录'),
          ),
          notice ? h('div', { style: { ...S.muted, marginTop: 4 } }, notice) : null,
          error ? h('div', { style: { ...S.error, marginTop: 4 } }, error) : null,
          retests.length
            ? h('div', { style: { marginTop: 6 } }, retests.map((retest) => h('div', { key: retest.id, style: { marginTop: 4 } },
                h('div', { style: S.row },
                  h(Badge, null, retest.status || '?'),
                  retest.verdict ? h(Badge, null, retest.verdict) : null,
                  h('span', { style: { ...S.muted, fontSize: 11 } }, retest.created_at || ''),
                ),
                retest.summary ? h('div', { style: { marginTop: 2 } }, retest.summary) : null,
                retest.evidence ? h('pre', { style: { ...S.pre, maxHeight: 180 } }, retest.evidence) : null,
              )))
            : h('div', { style: { ...S.muted, marginTop: 6, fontSize: 11 } }, '暂无复测记录。'),
        )
      : null,
  )
}

function FindingEvidence({ findingId, count }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setLoading(true)
    setError('')
    const { result, error: failure } = await run(() => api(`/finding/traffic?id=${encodeURIComponent(findingId)}`))
    setLoading(false)
    if (failure) setError(failure)
    else setData(result)
  }

  const bindings = data?.bindings || []
  return h('div', { style: { marginTop: 4 } },
    h('button', { style: S.button, onClick: toggle }, open ? '收起证据' : `查看证据 (${count})`),
    open
      ? h('div', { style: { ...S.card, padding: 8, marginTop: 6 } },
          loading ? h('div', { style: S.muted }, '加载证据…') : null,
          error ? h('div', { style: S.error }, error) : null,
          !loading && !error && bindings.length === 0 ? h('div', { style: S.muted }, '没有绑定流量。') : null,
          bindings.map((binding) => h('div', { key: binding.id, style: { marginTop: 4 } },
            h('div', { style: S.row },
              h(Badge, null, binding.role),
              h('span', null, `${binding.snapshot?.method || ''} ${binding.snapshot?.status ?? ''}`),
              h('span', { style: { wordBreak: 'break-all' } }, binding.snapshot?.url || binding.snapshot_id),
            ),
            binding.note ? h('div', { style: { ...S.muted, fontSize: 11 } }, binding.note) : null,
          )),
        )
      : null,
  )
}

function TaskFindings({ taskId }) {
  const findings = usePoll(`/findings?task=${encodeURIComponent(taskId || '')}`, 15_000, Boolean(taskId))
  const list = findings.data?.findings || []
  const counts = list.reduce((acc, finding) => {
    const key = finding.severity || 'unknown'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  if (!taskId) return null
  return h('div', { style: { marginTop: 12 } },
    h('div', { style: { ...S.row, marginBottom: 4 } },
      h('div', { style: { fontWeight: 600 } }, 'Findings'),
      h('span', { style: { ...S.muted, fontSize: 11 } },
        list.length === 0
          ? '暂无'
          : `critical ${counts.critical || 0} · high ${counts.high || 0} · medium ${counts.medium || 0} · low ${counts.low || 0}`),
      h('span', { style: { flex: 1 } }),
      list.length > 0
        ? h('button', {
            style: S.button,
            onClick: async () => {
              try {
                const response = await fetch(`${BASE}/findings/export?format=md-single&task_id=${encodeURIComponent(taskId)}`)
                if (!response.ok) throw new Error(`HTTP ${response.status}`)
                const blob = await response.blob()
                const disposition = response.headers.get('content-disposition') || ''
                const match = /filename="([^"]+)"/.exec(disposition)
                const href = URL.createObjectURL(blob)
                const anchor = document.createElement('a')
                anchor.href = href
                anchor.download = match?.[1] || `findings-task-${taskId}.md`
                anchor.click()
                URL.revokeObjectURL(href)
              } catch (failure) {
                findings.refresh()
              }
            },
          }, '导出 MD')
        : null,
    ),
    findings.error ? h('div', { style: S.error }, findings.error) : null,
    list.length === 0
      ? h('div', { style: S.muted }, '该任务还没有 findings。这不是错误；测试可能仍在进行。')
      : h('div', null, list.map((finding) => h('div', { key: finding.finding_id || finding.id, style: { ...S.card, padding: 8 } },
          h('div', { style: S.row },
            h(Badge, { tone: ['critical', 'high'].includes(finding.severity) ? 'danger' : undefined }, finding.severity || '?'),
            h('strong', null, finding.name || finding.vulnclass || 'finding'),
            h(Badge, null, finding.status || '?'),
            finding.verification_status ? h(Badge, null, finding.verification_status) : null,
            typeof finding.traffic_count === 'number' && finding.traffic_count > 0
              ? h(Badge, null, `traffic ${finding.traffic_count}`)
              : null,
          ),
          h('div', { style: { marginTop: 2, whiteSpace: 'pre-wrap' } }, finding.summary || ''),
          finding.assets?.length
            ? h('div', { style: { ...S.muted, marginTop: 2, fontSize: 11 } },
                `assets: ${finding.assets.map((asset) => asset.label || asset.name || asset.id).join(', ')}`)
            : null,
          finding.traffic_count > 0
            ? h(FindingEvidence, { findingId: finding.finding_id || finding.id, count: finding.traffic_count })
            : null,
          h(FindingRetest, { findingId: finding.finding_id || finding.id }),
          h(FindingControls, { finding, onSaved: findings.refresh }),
        ))),
  )
}

function Tasks({ health, onStart, starting }) {
  const tasks = usePoll('/tasks', 5_000, Boolean(health?.artex?.ok))
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const categories = usePoll('/task/categories', 30_000)
  const list = tasks.data?.tasks || []
  const current = list.find((task) => task.id === selected) || null

  useEffect(() => { setConfirmDelete(false) }, [selected])

  const addCategory = async () => {
    if (!newCategory.trim()) return
    const { error } = await run(() => api('/task/category', { body: { name: newCategory.trim() } }))
    if (!error) {
      setNewCategory('')
      categories.refresh()
    } else setNotice(error)
  }

  const removeCategory = async (category) => {
    if (!window.confirm(`删除分类 ${category.name}？`)) return
    const { error } = await run(() => api(`/task/category?id=${encodeURIComponent(category.id)}`, { method: 'DELETE' }))
    if (error) setNotice(error)
    else categories.refresh()
  }

  const control = async (action) => {
    if (!current) return
    setNotice('')
    const { error } = await run(() => api('/task/control', { body: { id: current.id, action } }))
    if (error) setNotice(error)
    else setNotice(`任务 ${current.id}: ${action} 已发送`)
    tasks.refresh()
  }

  const archive = async () => {
    if (!current) return
    setNotice('')
    const { error } = await run(() => api('/task/archive', { body: { id: current.id } }))
    setNotice(error || `任务 ${current.id}: 归档已排队`)
    tasks.refresh()
  }

  const remove = async () => {
    if (!current) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      setNotice(`再次点击“确认删除”将永久删除任务 ${current.id}（保留资产/流量/findings）`)
      return
    }
    setNotice('')
    const { error } = await run(() => api('/task/delete', { body: { id: current.id, delete_data: false } }))
    if (error) setNotice(error)
    else {
      setNotice(`任务 ${current.id}: 已删除`)
      setSelected('')
      setConfirmDelete(false)
      tasks.refresh()
    }
  }

  return h('div', null,
    h('div', { style: { ...S.row, marginBottom: 8 } },
      h('button', { style: S.button, onClick: tasks.refresh }, '刷新'),
      h('button', { style: S.button, onClick: () => setShowCategories((value) => !value) }, showCategories ? '收起分类' : '分类'),
      h('button', { style: S.button, onClick: () => setShowTemplates((value) => !value) }, showTemplates ? '收起模板' : '模板'),
      h('span', { style: { flex: 1 } }),
      health?.artex?.ok
        ? h('span', { style: S.muted }, `ARTEX ${health.artex.version || ''}`)
        : h('button', { style: S.primary, onClick: onStart, disabled: starting }, starting ? '启动中…' : '启动 ARTEX'),
    ),
    showCategories
      ? h('div', { style: { ...S.card, marginBottom: 8 } },
          h('div', { style: { fontWeight: 600, marginBottom: 4 } }, '任务分类'),
          (categories.data?.categories || []).map((category) => h('div', { key: category.id, style: { ...S.row, fontSize: 12, marginBottom: 3 } },
            h('span', { style: { flex: 1 } }, `${category.name} (${category.task_count ?? 0})`),
            h('button', { style: S.danger, onClick: () => removeCategory(category) }, '删除'),
          )),
          h('div', { style: { ...S.row, marginTop: 4 } },
            h('input', { value: newCategory, onChange: (event) => setNewCategory(event.target.value), placeholder: '新分类名', style: { ...S.input, flex: 1 } }),
            h('button', { style: S.primary, onClick: addCategory }, '添加'),
          ),
        )
      : null,
    showTemplates ? h(TaskTemplates, { categories: categories.data?.categories || [] }) : null,
    notice ? h('div', { style: { ...S.muted, marginBottom: 6 } }, notice) : null,
    tasks.error ? h('div', { style: { ...S.error, marginBottom: 6 } }, tasks.error) : null,
    !health?.artex?.ok
      ? h('div', { style: S.card },
          h('div', { style: S.muted }, 'ARTEX 未运行，任务列表暂不可用。先点“启动 ARTEX”，或用 Console 连接已有实例。'),
          health?.artex?.error ? h('div', { style: { ...S.error, marginTop: 4 } }, health.artex.error) : null,
        )
      : h('div', null,
          h(CreateTask, {
            requireAck: true,
            onCreated: (task) => {
              setSelected(task.id)
              tasks.refresh()
            },
          }),
          tasks.loading && list.length === 0
            ? h('div', { style: S.muted }, '加载任务…')
            : list.length === 0
              ? h('div', { style: S.muted }, '还没有 ARTEX 任务。创建前请确认授权与 scope。')
              : h('div', null, list.map((task) => h(TaskCard, {
                  key: task.id,
                  task,
                  selected: task.id === selected,
                  onSelect: setSelected,
                }))),
        ),
    current
      ? h('div', { style: { ...S.card, marginTop: 10 } },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('strong', null, `Task ${current.id}`),
            h('div', { style: S.row },
              h('button', { style: S.button, onClick: () => control('pause') }, '暂停'),
              h('button', { style: S.button, onClick: () => control('resume') }, '恢复'),
              h('button', { style: S.danger, onClick: () => control('cancel') }, '取消'),
              h('button', { style: S.button, onClick: archive }, '归档'),
              h('button', { style: S.danger, onClick: remove }, confirmDelete ? '确认删除' : '删除'),
            ),
          ),
          h('div', { style: { marginTop: 6, whiteSpace: 'pre-wrap' } }, current.goal),
          h(TaskPlan, { taskId: current.id }),
          h(TaskChat, { taskId: current.id }),
          h(ActivityFeed, { taskId: current.id }),
          h(TaskFindings, { taskId: current.id }),
          h(TaskReport, { taskId: current.id }),
        )
      : null,
  )
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------
function Approvals({ health, onStart, starting }) {
  const pending = usePoll('/pending', 3_000, Boolean(health?.artex?.ok))
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState([])
  const [history, setHistory] = useState(null)
  const [historyError, setHistoryError] = useState('')
  const items = pending.data?.pending || []

  useEffect(() => {
    if (pending.data) setPendingBadge(items.length)
  }, [pending.data, items.length])

  const toggle = (id) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const decide = async (id, decision) => {
    setNotice('')
    const { error } = await run(() => api('/decide', { body: { id, decision } }))
    if (error) setNotice(error)
    else setNotice(`审批 #${id}: ${decision === 'allowed' ? '已允许' : '已拒绝'}`)
    pending.refresh()
  }

  const batch = async (decision) => {
    if (selected.length === 0) return
    setNotice('')
    const { error } = await run(() => api('/decide_batch', { body: { ids: selected, decision } }))
    if (error) setNotice(error)
    else setNotice(`已批量${decision === 'allowed' ? '允许' : '拒绝'} ${selected.length} 条`)
    setSelected([])
    pending.refresh()
  }

  const alwaysAllow = async (id) => {
    setNotice('')
    const { error } = await run(() => api('/always_allow', { body: { id } }))
    if (error) setNotice(error)
    else setNotice(`审批 #${id}: 已创建 always-allow 规则；当前请求仍在待审批列表`)
    pending.refresh()
  }

  const loadHistory = async () => {
    setHistoryError('')
    const { result, error } = await run(() => api('/approval_history?limit=50'))
    if (error) setHistoryError(error)
    else setHistory(result?.items || [])
  }

  return h('div', null,
    h('div', { style: { ...S.row, marginBottom: 8 } },
      h('button', { style: S.button, onClick: pending.refresh }, '刷新'),
      h('span', { style: S.muted }, `待审批 ${items.length}`),
      h('span', { style: { flex: 1 } }),
      h('button', { style: S.button, onClick: () => batch('allowed'), disabled: selected.length === 0 }, `批量允许 (${selected.length})`),
      h('button', { style: S.danger, onClick: () => batch('denied'), disabled: selected.length === 0 }, `批量拒绝 (${selected.length})`),
      h('button', { style: S.button, onClick: loadHistory }, '历史'),
    ),
    h('div', { style: { ...S.muted, marginBottom: 8 } },
      'worker 命中 ask 规则时会同步阻塞。只允许与已确认 scope 一致且非破坏性的命令；越界或高危操作请先问用户。'),
    notice ? h('div', { style: { ...S.muted, marginBottom: 6 } }, notice) : null,
    pending.error ? h('div', { style: { ...S.error, marginBottom: 6 } }, pending.error) : null,
    !health?.artex?.ok
      ? h('div', { style: S.card },
          h('div', { style: S.error }, 'ARTEX 未运行'),
          h('button', { style: { ...S.primary, marginTop: 6 }, onClick: onStart, disabled: starting }, starting ? '启动中…' : '启动 ARTEX'),
        )
      : items.length === 0
        ? h('div', { style: S.muted }, '当前没有待审批请求。这不是错误。')
        : items.map((item) => h('div', { key: item.id, style: S.card },
            h('div', { style: { ...S.row, justifyContent: 'space-between' } },
              h('label', { style: { ...S.row, gap: 6, cursor: 'pointer' } },
                h('input', {
                  type: 'checkbox',
                  checked: selected.includes(item.id),
                  onChange: () => toggle(item.id),
                }),
                h('strong', null, `#${item.id} ${item.tool_name}`),
              ),
              h('div', { style: S.row },
                item.task_id ? h(Badge, null, `task ${item.task_id}`) : null,
                item.risk ? h(Badge, { tone: 'danger' }, `risk ${item.risk.level || item.risk.score || '?'}`) : null,
              ),
            ),
            h('div', { style: { ...S.muted, marginTop: 2 } }, item.reason || 'approval requested'),
            h('pre', { style: S.pre }, item.command || '(no command)'),
            h('div', { style: { ...S.row, marginTop: 6 } },
              h('button', { style: S.primary, onClick: () => decide(item.id, 'allowed') }, '允许'),
              h('button', { style: S.danger, onClick: () => decide(item.id, 'denied') }, '拒绝'),
              h('button', { style: S.button, onClick: () => alwaysAllow(item.id) }, '总是允许此类'),
            ),
          )),
    history
      ? h('div', { style: { ...S.card, marginTop: 10 } },
          h('div', { style: { fontWeight: 600, marginBottom: 4 } }, '审批历史'),
          historyError ? h('div', { style: S.error }, historyError) : null,
          history.length === 0 ? h('div', { style: S.muted }, '暂无历史。') : null,
          history.map((row) => h('div', { key: row.id, style: { ...S.row, fontSize: 11, marginTop: 2 } },
            h(Badge, { tone: row.status === 'denied' ? 'danger' : undefined }, row.status || '?'),
            h('span', null, `#${row.id} ${row.tool_name || ''}`),
            h('span', { style: S.muted }, row.decided_by ? `by ${row.decided_by}` : ''),
          )),
        )
      : null,
  )
}

// ---------------------------------------------------------------------------
// LLM profiles / pool
// ---------------------------------------------------------------------------
function LLM() {
  const data = usePoll('/llm', 15_000)
  const pool = usePoll('/llm/pool', 30_000)
  const [format, setFormat] = useState('openai')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/v1')
  const [model, setModel] = useState('deepseek-flash')
  const [apiKey, setApiKey] = useState('')
  const [activate, setActivate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const profiles = data.data?.profiles || []
  const status = data.data?.status || null

  const refresh = () => { data.refresh(); pool.refresh() }

  const create = async () => {
    if (!format || !model) return setError('format 和 model 必填')
    setBusy(true)
    setError('')
    setNotice('')
    const { result, error: failure } = await run(() => api('/llm/profile', {
      body: { name, format, base_url: baseUrl, model, api_key: apiKey, activate },
    }))
    setBusy(false)
    if (failure) return setError(failure)
    setApiKey('')
    setNotice(`已保存 profile ${result?.id ?? ''}${activate ? ' 并激活' : ''}。`)
    refresh()
  }

  const act = async (profile) => {
    setError('')
    const { error: failure } = await run(() => api('/llm/profile/activate', { body: { id: Number(profile.id) } }))
    if (failure) setError(failure)
    else setNotice(`已激活 ${profile.name || profile.id}`)
    refresh()
  }

  const remove = async (profile) => {
    setError('')
    const { error: failure } = await run(() => api(`/llm/profile?id=${encodeURIComponent(profile.id)}`, { method: 'DELETE' }))
    if (failure) setError(failure)
    else setNotice(`已删除 ${profile.name || profile.id}`)
    refresh()
  }

  const test = async (profile) => {
    setError('')
    setNotice('测试中…')
    const { result, error: failure } = await run(() => api('/llm/test', { body: { profile_id: Number(profile.id) } }))
    if (failure) setError(failure)
    else if (result?.result?.ok) setNotice(`测试通过 ${result.result.latency_ms}ms：${result.result.reply || ''}`)
    else setError(`测试失败：${result?.result?.error || 'unknown'}`)
  }

  return h('div', null,
    h('div', { style: { ...S.row, marginBottom: 8 } },
      h('span', { style: { ...S.muted, fontSize: 11 } },
        status?.configured
          ? `当前：${status.provider}/${status.model}${status.key_set ? ' · key set' : ''}`
          : '当前没有可用 LLM'),
      h('span', { style: { flex: 1 } }),
      h('button', { style: S.button, onClick: refresh }, '刷新'),
    ),
    notice ? h('div', { style: { ...S.muted, marginBottom: 6 } }, notice) : null,
    error ? h('div', { style: { ...S.error, marginBottom: 6 } }, error) : null,
    h('div', { style: { ...S.card, marginBottom: 8 } },
      h('div', { style: { fontWeight: 600, marginBottom: 4 } }, '新建 LLM Profile'),
      h('div', { style: { ...S.row, marginBottom: 4 } },
        h('input', { value: name, onChange: (event) => setName(event.target.value), placeholder: '名称（可选）', style: { ...S.input, flex: 1, minWidth: 120 } }),
        h('select', { value: format, onChange: (event) => setFormat(event.target.value), style: { ...S.input, width: 160, flex: '0 0 auto' } },
          h('option', { value: 'openai' }, 'openai'),
          h('option', { value: 'anthropic' }, 'anthropic'),
          h('option', { value: 'openai-responses' }, 'openai-responses'),
          h('option', { value: 'ollama' }, 'ollama'),
        ),
      ),
      h('div', { style: { ...S.row, marginBottom: 4 } },
        h('input', { value: baseUrl, onChange: (event) => setBaseUrl(event.target.value), placeholder: 'base_url', style: { ...S.input, flex: 1, minWidth: 200 } }),
        h('input', { value: model, onChange: (event) => setModel(event.target.value), placeholder: 'model', style: { ...S.input, width: 180, flex: '0 0 auto' } }),
      ),
      h('div', { style: { ...S.row } },
        h('input', { type: 'password', value: apiKey, onChange: (event) => setApiKey(event.target.value), placeholder: 'api_key（ollama 可空）', style: { ...S.input, flex: 1 } }),
        h('label', { style: { ...S.row, gap: 4, fontSize: 12 } },
          h('input', { type: 'checkbox', checked: activate, onChange: (event) => setActivate(event.target.checked) }),
          h('span', null, '保存后激活'),
        ),
        h('button', { style: S.primary, onClick: create, disabled: busy }, busy ? '保存中…' : '保存'),
      ),
    ),
    profiles.length === 0
      ? h('div', { style: S.muted }, '没有 LLM profile。可以用上面的表单创建，或用 artex_llm 从 DEEPSEEK_API_KEY 引导。')
      : profiles.map((profile) => h('div', { key: profile.id, style: S.card },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('div', { style: S.row },
              h('strong', null, `${profile.id} · ${profile.name || '(unnamed)'}`),
              profile.is_default ? h(Badge, { tone: 'danger' }, 'active') : null,
              h(Badge, null, profile.format || '?'),
              h('span', { style: S.muted }, profile.model || ''),
            ),
            h('div', { style: S.row },
              h('button', { style: S.button, onClick: () => test(profile) }, '测试'),
              h('button', { style: S.button, onClick: () => act(profile), disabled: Boolean(profile.is_default) }, '激活'),
              h('button', { style: S.danger, onClick: () => remove(profile), disabled: Boolean(profile.is_default) }, '删除'),
            ),
          ),
          h('div', { style: { ...S.muted, fontSize: 11, marginTop: 2 } },
            `${profile.base_url || '-'} · key ${profile.api_key_hint || 'not set'}`),
        )),
    pool.data?.pool
      ? h('div', { style: { ...S.card, marginTop: 8 } },
          h('div', { style: { fontWeight: 600, marginBottom: 4 } }, 'Failover pool'),
          h('pre', { style: { ...S.pre, maxHeight: 220 } }, JSON.stringify(pool.data.pool, null, 2)),
          h('button', {
            style: S.button,
            onClick: async () => {
              const { error: failure } = await run(() => api('/llm/pool/reset', { body: { id: 0 } }))
              if (failure) setError(failure)
              else setNotice('已重置所有 circuit breaker')
              pool.refresh()
            },
          }, '重置 circuit breaker'),
        )
      : null,
  )
}

// ---------------------------------------------------------------------------
// Chat / conversations
// ---------------------------------------------------------------------------
function Chat() {
  const conversations = usePoll('/conversations', 5_000)
  const [conversationId, setConversationId] = useState('')
  const [items, setItems] = useState([])
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const cursorRef = useRef(0)
  const seenRef = useRef(new Set())
  const threadRef = useRef(null)
  const list = conversations.data?.conversations || []

  useEffect(() => {
    if (list.length === 0) {
      if (conversationId) setConversationId('')
      return
    }
    if (!list.some((conversation) => String(conversation.id) === String(conversationId))) {
      setConversationId(String(list[0].id))
    }
  }, [conversations.data, conversationId])

  const append = useCallback((nextItems) => {
    if (!Array.isArray(nextItems) || nextItems.length === 0) return
    setItems((previous) => {
      const merged = [...previous]
      for (const item of nextItems) {
        const key = activityKey(item)
        if (key === undefined || seenRef.current.has(key)) continue
        seenRef.current.add(key)
        merged.push(item)
        if (typeof key === 'number' && key > cursorRef.current) cursorRef.current = key
      }
      merged.sort((a, b) => Number(activityKey(a) || 0) - Number(activityKey(b) || 0))
      return merged.slice(-400)
    })
  }, [])

  useEffect(() => {
    setItems([])
    setRunning(false)
    setError('')
    setNotice('')
    cursorRef.current = 0
    seenRef.current = new Set()
    if (!conversationId) return undefined

    let alive = true
    const controller = new AbortController()
    let timer = null
    const load = async () => {
      try {
        const data = await api(`/conversation/messages?id=${encodeURIComponent(conversationId)}&limit=200`, { signal: controller.signal })
        if (!alive) return
        append(data.items)
        cursorRef.current = Number(data.cursor || cursorRef.current || 0)
        setRunning(Boolean(data.running))
        setError('')
      } catch (failure) {
        if (alive && failure?.name !== 'AbortError') setError(failure.message)
      }
    }
    const poll = async () => {
      try {
        const data = await api(`/conversation/messages?id=${encodeURIComponent(conversationId)}&since=${cursorRef.current}`, { signal: controller.signal })
        if (!alive) return
        append(data.items)
        setRunning(Boolean(data.running))
        setError('')
      } catch (failure) {
        if (alive && failure?.name !== 'AbortError') setError(failure.message)
      }
    }
    load().then(() => {
      if (alive) timer = setInterval(poll, 2_000)
    })
    return () => {
      alive = false
      clearInterval(timer)
      controller.abort()
    }
  }, [conversationId, append])

  useEffect(() => {
    const node = threadRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [items.length])

  const create = async () => {
    setError('')
    const { result, error: failure } = await run(() => api('/conversations', { body: { agent_key: 'auto', title: '' } }))
    if (failure) setError(failure)
    else {
      const id = result?.data?.id || result?.data?.conversation?.id
      if (id) setConversationId(String(id))
      conversations.refresh()
    }
  }

  const send = async () => {
    const text = message.trim()
    if (!text || !conversationId) return
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/conversation/message', {
      body: { id: conversationId, message: text },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setMessage('')
      setNotice('已发送；回复会逐步出现在线程里。')
    }
  }

  const stop = async () => {
    if (!conversationId) return
    const { error: failure } = await run(() => api('/conversation/stop', { body: { id: conversationId } }))
    if (failure) setError(failure)
    else setNotice('已请求停止当前回合。')
  }

  const current = list.find((conversation) => String(conversation.id) === String(conversationId)) || null

  return h('div', { style: { display: 'flex', gap: 10, minHeight: 420, alignItems: 'stretch' } },
    h('div', { style: { width: 220, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6 } },
      h('div', { style: S.row },
        h('button', { style: S.primary, onClick: create }, '新建会话'),
        h('button', { style: S.button, onClick: conversations.refresh }, '刷新'),
      ),
      conversations.error ? h('div', { style: S.error }, conversations.error) : null,
      h('div', { style: { overflow: 'auto', maxHeight: 520 } },
        list.map((conversation) => h('button', {
          key: conversation.id,
          onClick: () => setConversationId(String(conversation.id)),
          style: {
            ...S.card,
            width: '100%',
            textAlign: 'left',
            cursor: 'pointer',
            padding: 8,
            borderColor: String(conversation.id) === String(conversationId)
              ? 'var(--dsw-alias-brand-primary, #6b34db)'
              : 'var(--dsw-alias-border-l1, #e5e7eb)',
          },
        },
          h('div', { style: { fontWeight: 600, fontSize: 12 } }, conversation.title || `Conversation ${conversation.id}`),
          h('div', { style: { ...S.muted, fontSize: 10 } },
            `${conversation.agent_key || ''}${conversation.running ? ' · running' : ''}`),
        )),
      ),
    ),
    h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
      h('div', { style: { ...S.row, marginBottom: 4 } },
        h('strong', null, current ? (current.title || `Conversation ${current.id}`) : '未选择会话'),
        running ? h(Badge, { tone: 'danger' }, 'running') : null,
        h('span', { style: { flex: 1 } }),
        running ? h('button', { style: S.danger, onClick: stop }, '停止') : null,
      ),
      error ? h('div', { style: S.error }, error) : null,
      notice ? h('div', { style: { ...S.muted, fontSize: 11 } }, notice) : null,
      h('div', {
        ref: threadRef,
        style: {
          flex: 1,
          minHeight: 260,
          maxHeight: 520,
          overflow: 'auto',
          border: '1px solid var(--dsw-alias-border-l1, #e5e7eb)',
          borderRadius: 8,
          padding: 8,
          background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
        },
      },
        items.length === 0
          ? h('div', { style: S.muted }, conversationId ? '线程为空，发一条消息开始。' : '选择或新建一个会话。')
          : items.map((item) => {
              const kind = item.kind || 'text'
              const isUser = kind === 'user'
              const who = item.worker || ''
              return h('div', {
                key: activityKey(item),
                style: {
                  display: 'flex',
                  justifyContent: isUser ? 'flex-end' : 'flex-start',
                  marginBottom: 6,
                },
              },
                h('div', {
                  style: {
                    maxWidth: '82%',
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: isUser
                      ? 'var(--dsw-alias-brand-primary, #6b34db)'
                      : 'var(--dsw-alias-bg-layer-2, #f3f4f6)',
                    color: isUser ? '#ffffff' : 'var(--dsw-alias-label-primary, #1f2328)',
                    fontSize: 12,
                  },
                },
                  !isUser && (who || item.tool || kind !== 'text')
                    ? h('div', { style: { ...S.row, gap: 4, marginBottom: 2, opacity: 0.75 } },
                        who ? h('span', { style: { fontSize: 10 } }, who) : null,
                        item.tool ? h('span', { style: { fontSize: 10, fontWeight: 600 } }, item.tool) : null,
                        h('span', { style: { fontSize: 10 } }, kind),
                      )
                    : null,
                  h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
                    item.summary || (item.detail ? String(item.detail).slice(0, 2000) : '')),
                ),
              )
            }),
      ),
      h('div', { style: { ...S.row, marginTop: 6 } },
        h('textarea', {
          value: message,
          onChange: (event) => setMessage(event.target.value),
          rows: 2,
          placeholder: '给 ARTEX assistant 发消息…',
          style: { ...S.input, flex: 1, resize: 'vertical' },
          onKeyDown: (event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) send()
          },
        }),
        h('button', { style: S.primary, onClick: send, disabled: busy || !message.trim() || !conversationId }, busy ? '发送中…' : '发送'),
      ),
    ),
  )
}

function SystemMCP() {
  const data = usePoll('/system/mcp', 10_000)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', transport: 'stdio', command: '', args: '', url: '', env: '{}', enabled: true })
  const servers = data.data?.servers || []
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const add = async () => {
    if (!form.name.trim()) return setError('MCP 名称必填')
    let env = {}
    try {
      env = form.env.trim() ? JSON.parse(form.env) : {}
    } catch {
      return setError('env 必须是 JSON object')
    }
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/system/mcp', {
      body: {
        name: form.name.trim(),
        transport: form.transport,
        command: form.command.trim(),
        args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
        url: form.url.trim(),
        env,
        enabled: form.enabled,
      },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setShowAdd(false)
      setForm({ name: '', transport: 'stdio', command: '', args: '', url: '', env: '{}', enabled: true })
      setNotice('MCP server 已添加')
      data.refresh()
    }
  }

  const refresh = async (server) => {
    setError('')
    setNotice('')
    const { result, error: failure } = await run(() => api('/system/mcp/refresh', { body: { id: server.id } }))
    if (failure) setError(failure)
    else {
      const tools = result?.result?.tools || result?.result?.result?.tools || []
      setNotice(`已刷新 ${server.name}：${tools.length} 个工具`)
    }
    data.refresh()
  }

  const remove = async (server) => {
    if (!window.confirm(`删除 MCP server ${server.name}？`)) return
    setError('')
    const { error: failure } = await run(() => api(`/system/mcp?id=${encodeURIComponent(server.id)}`, { method: 'DELETE' }))
    if (failure) setError(failure)
    else setNotice(`已删除 ${server.name}`)
    data.refresh()
  }

  return h('div', null,
    h('div', { style: { ...S.row, marginBottom: 8 } },
      h('button', { style: S.button, onClick: data.refresh }, '刷新'),
      h('button', { style: S.primary, onClick: () => setShowAdd((value) => !value) }, showAdd ? '取消新增' : '新增 MCP'),
      h('span', { style: { ...S.muted, fontSize: 11 } }, `${servers.length} 个 server`),
    ),
    showAdd
      ? h('div', { style: { ...S.card, marginBottom: 8 } },
          h('div', { style: { ...S.row, marginBottom: 4 } },
            h('input', { value: form.name, onChange: (event) => setField('name', event.target.value), placeholder: 'name', style: { ...S.input, flex: 1 } }),
            h('select', { value: form.transport, onChange: (event) => setField('transport', event.target.value), style: { ...S.input, width: 110, flex: '0 0 auto' } },
              h('option', { value: 'stdio' }, 'stdio'),
              h('option', { value: 'http' }, 'http'),
              h('option', { value: 'sse' }, 'sse'),
            ),
          ),
          h('input', { value: form.command, onChange: (event) => setField('command', event.target.value), placeholder: 'command（stdio）', style: { ...S.input, marginBottom: 4 } }),
          h('input', { value: form.args, onChange: (event) => setField('args', event.target.value), placeholder: 'args（空格分隔，stdio）', style: { ...S.input, marginBottom: 4 } }),
          h('input', { value: form.url, onChange: (event) => setField('url', event.target.value), placeholder: 'url（http/sse）', style: { ...S.input, marginBottom: 4 } }),
          h('textarea', { value: form.env, onChange: (event) => setField('env', event.target.value), rows: 2, placeholder: 'env JSON', style: { ...S.input, resize: 'vertical' } }),
          h('div', { style: { ...S.row, marginTop: 4 } },
            h('label', { style: { ...S.row, gap: 4, fontSize: 12 } },
              h('input', { type: 'checkbox', checked: form.enabled, onChange: (event) => setField('enabled', event.target.checked) }),
              h('span', null, '启用'),
            ),
            h('button', { style: S.primary, onClick: add, disabled: busy }, busy ? '添加中…' : '添加'),
          ),
        )
      : null,
    notice ? h('div', { style: { ...S.muted, marginBottom: 4 } }, notice) : null,
    error ? h('div', { style: { ...S.error, marginBottom: 4 } }, error) : null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    servers.length === 0
      ? h('div', { style: S.muted }, '没有 MCP server。可在 Console 的 MCP 页面添加。')
      : servers.map((server) => h('div', { key: server.id, style: S.card },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('div', { style: S.row },
              h('strong', null, server.name),
              h(Badge, null, server.transport || '?'),
              h(Badge, { tone: server.enabled ? undefined : 'danger' }, server.enabled ? 'enabled' : 'disabled'),
            ),
            h('div', { style: S.row },
              h('button', { style: S.button, onClick: () => refresh(server) }, '刷新工具'),
              h('button', { style: S.danger, onClick: () => remove(server) }, '删除'),
            ),
          ),
          h('div', { style: { ...S.muted, fontSize: 11, marginTop: 2, wordBreak: 'break-all' } },
            server.url || [server.command, ...(server.args || [])].join(' ')),
          h('div', { style: { ...S.muted, fontSize: 11 } },
            `timeout ${server.timeout_seconds || '?'}s · env ${Object.keys(server.env || {}).length}`),
        )),
  )
}

function SystemSkills() {
  const data = usePoll('/system/skills', 15_000)
  const [selected, setSelected] = useState('')
  const [files, setFiles] = useState([])
  const [file, setFile] = useState('')
  const [content, setContent] = useState('')
  const [editContent, setEditContent] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newInstructions, setNewInstructions] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [fileBusy, setFileBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const skills = data.data?.skills || []

  const createSkill = async () => {
    if (!newName.trim() || !newDesc.trim()) return setError('skill name 和 description 必填')
    setCreateBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/system/skill', {
      body: { name: newName.trim(), description: newDesc.trim(), instructions: newInstructions },
    }))
    setCreateBusy(false)
    if (failure) setError(failure)
    else {
      setShowCreate(false)
      setNewName('')
      setNewDesc('')
      setNewInstructions('')
      setNotice('skill 已创建')
      data.refresh()
    }
  }

  const saveFile = async () => {
    if (!selected || !file) return
    setFileBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/system/skill/file', {
      method: 'PUT',
      body: { name: selected, file, content: editContent },
    }))
    setFileBusy(false)
    if (failure) setError(failure)
    else setNotice(`${selected}/${file} 已保存`)
  }

  const open = async (skill) => {
    setError('')
    setSelected(skill.name)
    setFile('')
    setContent('')
    const { result, error: failure } = await run(() => api(`/system/skill/files?name=${encodeURIComponent(skill.name)}`))
    if (failure) setError(failure)
    else setFiles(result?.files || [])
  }

  const read = async (name) => {
    setError('')
    const { result, error: failure } = await run(() => api(`/system/skill/file?name=${encodeURIComponent(selected)}&file=${encodeURIComponent(name)}`))
    if (failure) setError(failure)
    else {
      setFile(name)
      setContent(result?.content || '')
      setEditContent(result?.content || '')
    }
  }

  const removeSkill = async (name) => {
    if (!window.confirm(`删除 skill ${name} 及其全部文件？`)) return
    setError('')
    setNotice('')
    const { error: failure } = await run(() => api(`/system/skill?name=${encodeURIComponent(name)}`, { method: 'DELETE' }))
    if (failure) setError(failure)
    else {
      if (selected === name) {
        setSelected('')
        setFiles([])
        setFile('')
      }
      setNotice(`skill ${name} 已删除`)
      data.refresh()
    }
  }

  const upload = async (event) => {
    const archive = event.target.files?.[0]
    if (!archive) return
    if (archive.size > 20 * 1024 * 1024) {
      event.target.value = ''
      return setError('zip 不能超过 20 MB')
    }
    setUploadBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(
        `${BASE}/system/skill/upload?filename=${encodeURIComponent(archive.name)}&overwrite=${overwrite ? 'true' : 'false'}`,
        { method: 'POST', headers: { 'content-type': 'application/zip' }, body: archive },
      )
      const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`)
      const saved = payload.data || payload
      setNotice(`skill ${saved.name || archive.name} 已上传`)
      data.refresh()
    } catch (failure) {
      setError(failure.message || String(failure))
    } finally {
      setUploadBusy(false)
      event.target.value = ''
    }
  }

  return h('div', null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    h('div', { style: { ...S.row, marginBottom: 6, flexWrap: 'wrap' } },
      h('button', { style: S.button, onClick: data.refresh }, '刷新'),
      h('button', { style: S.primary, onClick: () => setShowCreate((value) => !value) }, showCreate ? '取消新建' : '新建 Skill'),
      h('label', { style: { ...S.row, fontSize: 11, cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: overwrite, onChange: (event) => setOverwrite(event.target.checked) }),
        h('span', null, '覆盖同名'),
      ),
      h('label', { style: { ...S.row, fontSize: 11, cursor: uploadBusy ? 'default' : 'pointer' } },
        h('span', { style: S.button }, uploadBusy ? '上传中…' : '上传 zip'),
        h('input', {
          type: 'file',
          accept: '.zip,application/zip',
          disabled: uploadBusy,
          onChange: upload,
          style: { display: 'none' },
        }),
      ),
      h('span', { style: { ...S.muted, fontSize: 11 } }, `${skills.length} 个 skill`),
    ),
    showCreate
      ? h('div', { style: { ...S.card, marginBottom: 8 } },
          h('input', { value: newName, onChange: (event) => setNewName(event.target.value), placeholder: 'name（lowercase-hyphen）', style: { ...S.input, marginBottom: 4 } }),
          h('input', { value: newDesc, onChange: (event) => setNewDesc(event.target.value), placeholder: 'description', style: { ...S.input, marginBottom: 4 } }),
          h('textarea', { value: newInstructions, onChange: (event) => setNewInstructions(event.target.value), rows: 4, placeholder: 'instructions（可选）', style: { ...S.input, resize: 'vertical' } }),
          h('button', { style: { ...S.primary, marginTop: 4 }, onClick: createSkill, disabled: createBusy }, createBusy ? '创建中…' : '创建'),
        )
      : null,
    notice ? h('div', { style: { ...S.muted, marginBottom: 4 } }, notice) : null,
    error ? h('div', { style: { ...S.error, marginBottom: 4 } }, error) : null,
    skills.length === 0
      ? h('div', { style: S.muted }, '没有 skill。可以新建，或上传包含 SKILL.md 的 zip。')
      : skills.map((skill) => h('div', { key: skill.name, style: S.card },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('div', { style: S.row },
              h('strong', null, skill.name),
              h(Badge, null, `${skill.calls || 0} calls`),
              h(Badge, null, `${skill.files?.length || 0} files`),
            ),
            h('div', { style: S.row },
              h('button', { style: S.button, onClick: () => open(skill) }, selected === skill.name ? '刷新文件' : '查看文件'),
              h('button', { style: S.danger, onClick: () => removeSkill(skill.name) }, '删除'),
            ),
          ),
          h('div', { style: { ...S.muted, fontSize: 11, marginTop: 2 } }, skill.description || ''),
          selected === skill.name
            ? h('div', { style: { marginTop: 6 } },
                files.map((name) => h('button', {
                  key: name,
                  style: { ...S.button, marginRight: 4, marginBottom: 4 },
                  onClick: () => read(name),
                }, name)),
                file ? h('div', null,
                  h('div', { style: { ...S.row, marginTop: 4 } },
                    h('div', { style: { ...S.muted, fontSize: 11, flex: 1 } }, file),
                    h('button', { style: S.button, onClick: saveFile, disabled: fileBusy }, fileBusy ? '保存中…' : '保存文件'),
                  ),
                  h('textarea', {
                    value: editContent,
                    onChange: (event) => setEditContent(event.target.value),
                    rows: 12,
                    style: { ...S.input, resize: 'vertical' },
                  }),
                ) : null,
              )
            : null,
        )),
  )
}

function AgentTools({ agentKey }) {
  const data = usePoll('/system/tools', 15_000)
  const [busyKey, setBusyKey] = useState('')
  const [error, setError] = useState('')
  const tools = data.data?.tools || []

  const toggle = async (tool) => {
    const agents = Array.isArray(tool.agents) ? tool.agents : []
    const bound = agents.includes(agentKey)
    if (!tool.system) {
      setError(`custom tool ${tool.key} 的绑定请在 Custom Tools 页用 agents 字段编辑。`)
      return
    }
    setBusyKey(tool.key)
    setError('')
    const next = bound ? agents.filter((key) => key !== agentKey) : [...new Set([...agents, agentKey])]
    const { error: failure } = await run(() => api('/system/tool/builtin', {
      body: {
        key: tool.key,
        description: tool.description || '',
        schema: tool.schema || {},
        agents: next,
        enabled: tool.enabled !== false,
      },
    }))
    setBusyKey('')
    if (failure) setError(failure)
    else data.refresh()
  }

  return h('div', null,
    h('div', { style: { ...S.muted, fontSize: 11, marginBottom: 4 } },
      '勾选后该工具会绑定到当前 agent（system 工具）；custom tool 在 Custom Tools 页编辑 agents。'),
    error ? h('div', { style: S.error }, error) : null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    tools.length === 0
      ? h('div', { style: S.muted }, '没有工具。')
      : tools.map((tool) => {
          const agents = Array.isArray(tool.agents) ? tool.agents : []
          const bound = agents.includes(agentKey)
          return h('label', {
            key: tool.key,
            style: { ...S.row, ...S.card, padding: 6, marginBottom: 4, cursor: tool.system ? 'pointer' : 'default', opacity: tool.system ? 1 : 0.7 },
          },
            h('input', {
              type: 'checkbox',
              checked: bound,
              disabled: !tool.system || busyKey === tool.key,
              onChange: () => toggle(tool),
            }),
            h('strong', { style: { fontSize: 12 } }, tool.key),
            h(Badge, { tone: tool.enabled ? undefined : 'danger' }, tool.enabled ? 'enabled' : 'disabled'),
            h(Badge, null, tool.system ? 'builtin' : 'custom'),
            h('span', { style: { ...S.muted, fontSize: 11, flex: 1 } }, tool.description || ''),
            agents.length ? h('span', { style: { ...S.muted, fontSize: 10 } }, agents.join(', ')) : null,
          )
        }),
  )
}

function AgentConfig({ detail, onSaved }) {
  const agent = detail?.agent || {}
  const [form, setForm] = useState({
    max_turns: String(agent.max_turns ?? 0),
    run_seconds: String(agent.run_seconds ?? 600),
    web_search: Boolean(agent.web_search),
    interactive_shell: Boolean(agent.interactive_shell),
    trigger_run_mode: agent.trigger_run_mode || 'serial',
    trigger_merge_mode: agent.trigger_merge_mode || 'all',
    trigger_max_parallel: String(agent.trigger_max_parallel ?? 5),
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    const { error: failure } = await run(() => api('/system/agent/config', {
      body: {
        key: agent.key,
        max_turns: Number(form.max_turns) || 0,
        run_seconds: Number(form.run_seconds) || 0,
        web_search: form.web_search,
        interactive_shell: form.interactive_shell,
        trigger_run_mode: form.trigger_run_mode,
        trigger_merge_mode: form.trigger_merge_mode,
        trigger_max_parallel: Number(form.trigger_max_parallel) || 0,
      },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setNotice('配置已保存；新回合生效')
      onSaved?.()
    }
  }

  return h('div', null,
    h('div', { style: { ...S.row, flexWrap: 'wrap', marginBottom: 6 } },
      h('label', { style: { fontSize: 12 } }, 'max_turns ',
        h('input', { type: 'number', min: 0, value: form.max_turns, onChange: (event) => setField('max_turns', event.target.value), style: { ...S.input, width: 90 } })),
      h('label', { style: { fontSize: 12 } }, 'run_seconds ',
        h('input', { type: 'number', min: 0, value: form.run_seconds, onChange: (event) => setField('run_seconds', event.target.value), style: { ...S.input, width: 100 } })),
      h('label', { style: { ...S.row, fontSize: 12 } },
        h('input', { type: 'checkbox', checked: form.web_search, onChange: (event) => setField('web_search', event.target.checked) }),
        h('span', null, 'web_search')),
      h('label', { style: { ...S.row, fontSize: 12 } },
        h('input', { type: 'checkbox', checked: form.interactive_shell, onChange: (event) => setField('interactive_shell', event.target.checked) }),
        h('span', null, 'interactive_shell')),
    ),
    h('div', { style: { ...S.row, flexWrap: 'wrap', marginBottom: 6 } },
      h('label', { style: { fontSize: 12 } }, 'trigger run ',
        h('select', { value: form.trigger_run_mode, onChange: (event) => setField('trigger_run_mode', event.target.value), style: { ...S.input, width: 110 } },
          h('option', { value: 'serial' }, 'serial'),
          h('option', { value: 'parallel' }, 'parallel'),
        )),
      h('label', { style: { fontSize: 12 } }, 'merge ',
        h('select', { value: form.trigger_merge_mode, onChange: (event) => setField('trigger_merge_mode', event.target.value), style: { ...S.input, width: 110 } },
          h('option', { value: 'all' }, 'all'),
          h('option', { value: 'by_task' }, 'by_task'),
          h('option', { value: 'none' }, 'none'),
        )),
      h('label', { style: { fontSize: 12 } }, 'max parallel ',
        h('input', { type: 'number', min: 1, value: form.trigger_max_parallel, onChange: (event) => setField('trigger_max_parallel', event.target.value), style: { ...S.input, width: 80 } })),
    ),
    h('div', { style: { ...S.muted, fontSize: 11, marginBottom: 6 } },
      '0 表示使用内置默认。max_turns/run_seconds 是该 agent 单回合的预算；trigger 策略决定多次触发如何排队或合并。'),
    h('div', { style: S.row },
      h('button', { style: S.primary, onClick: save, disabled: busy }, busy ? '保存中…' : '保存配置'),
    ),
    notice ? h('div', { style: { ...S.muted, marginTop: 4 } }, notice) : null,
    error ? h('div', { style: { ...S.error, marginTop: 4 } }, error) : null,
  )
}

const TRIGGER_MESSAGES = [
  ['interval', 'interval_message', '间隔触发消息'],
  ['finding', 'finding_message', '发现 finding 时消息'],
  ['goal', 'goal_message', 'goal 达成时消息'],
  ['task_timeout', 'task_timeout_message', '任务超时消息'],
  ['tool_call', 'tool_call_message', '工具调用时消息'],
  ['task_create', 'task_create_message', '任务创建时消息'],
]

function emptyTrigger() {
  return {
    enabled: true,
    interval_sec: '0',
    on_finding: false,
    on_goal_met: false,
    on_task_timeout: false,
    on_tool_call: false,
    on_task_create: false,
    interval_message: '',
    finding_message: '',
    goal_message: '',
    task_timeout_message: '',
    tool_call_message: '',
    task_create_message: '',
    tool_names: [],
  }
}

function AgentVisibility({ agentKey }) {
  const mcp = usePoll('/system/mcp', 30_000)
  const skills = usePoll('/system/skills', 30_000)
  const [selectedMCP, setSelectedMCP] = useState([])
  const [selectedSkills, setSelectedSkills] = useState([])
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const servers = mcp.data?.servers || []
  const skillList = skills.data?.skills || []
  // Keep visibility rows for skills that no longer exist on disk visible, so a
  // stale binding can still be removed from this panel.
  const skillNames = [...new Set([...skillList.map((skill) => skill.name), ...selectedSkills])]

  useEffect(() => {
    let alive = true
    setSelectedMCP([])
    setSelectedSkills([])
    setNotice('')
    setError('')
    api(`/system/agent/visibility?key=${encodeURIComponent(agentKey)}`)
      .then((data) => {
        if (!alive) return
        setSelectedMCP((data.mcp || []).map(String))
        setSelectedSkills(data.skill || [])
      })
      .catch((failure) => { if (alive) setError(failure.message) })
    return () => { alive = false }
  }, [agentKey, index])

  const toggle = (list, setList, value) => {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  }

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    const { error: failure } = await run(() => api(`/system/agent/visibility?key=${encodeURIComponent(agentKey)}`, {
      method: 'PUT',
      body: { mcp: selectedMCP.map(Number), skill: selectedSkills },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setNotice('可见性已保存')
      setIndex((value) => value + 1)
    }
  }

  return h('div', null,
    h('div', { style: { ...S.muted, fontSize: 11, marginBottom: 6 } },
      '控制该 agent 能看到的 MCP server 与 skill；全不勾选表示都不可见。修改对后续回合生效。'),
    mcp.error ? h('div', { style: S.error }, mcp.error) : null,
    skills.error ? h('div', { style: S.error }, skills.error) : null,
    h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
      h('div', { style: { flex: '1 1 240px', minWidth: 220 } },
        h('div', { style: { fontWeight: 600, fontSize: 12, marginBottom: 3 } }, `MCP servers (${selectedMCP.length}/${servers.length})`),
        servers.length === 0
          ? h('div', { style: S.muted }, '没有 MCP server。')
          : servers.map((server) => h('label', { key: server.id, style: { ...S.row, fontSize: 12, marginBottom: 3 } },
              h('input', {
                type: 'checkbox',
                checked: selectedMCP.includes(String(server.id)),
                onChange: () => toggle(selectedMCP, setSelectedMCP, String(server.id)),
              }),
              h('span', null, server.name || `#${server.id}`),
              h(Badge, null, server.kind || server.transport || ''),
            )),
      ),
      h('div', { style: { flex: '1 1 240px', minWidth: 220 } },
        h('div', { style: { fontWeight: 600, fontSize: 12, marginBottom: 3 } }, `Skills (${selectedSkills.length}/${skillNames.length})`),
        skillNames.length === 0
          ? h('div', { style: S.muted }, '没有 skill。')
          : skillNames.map((name) => h('label', { key: name, style: { ...S.row, fontSize: 12, marginBottom: 3 } },
              h('input', {
                type: 'checkbox',
                checked: selectedSkills.includes(name),
                onChange: () => toggle(selectedSkills, setSelectedSkills, name),
              }),
              h('span', null, name),
              skillList.some((skill) => skill.name === name) ? null : h(Badge, { tone: 'danger' }, 'missing'),
            )),
      ),
    ),
    h('div', { style: { ...S.row, marginTop: 8 } },
      h('button', { style: S.primary, onClick: save, disabled: busy }, busy ? '保存中…' : '保存可见性'),
      h('button', { style: S.button, onClick: () => { setSelectedMCP([]); setSelectedSkills([]) } }, '全部清空'),
    ),
    notice ? h('div', { style: { ...S.muted, marginTop: 4 } }, notice) : null,
    error ? h('div', { style: { ...S.error, marginTop: 4 } }, error) : null,
  )
}

function AgentTriggers({ agentKey, builtin }) {
  const data = usePoll(`/system/agent/triggers?key=${encodeURIComponent(agentKey)}`, 15_000, Boolean(agentKey) && !builtin)
  const tools = usePoll('/system/tools', 60_000, Boolean(agentKey) && !builtin)
  const [draft, setDraft] = useState(emptyTrigger)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const triggers = data.data?.triggers || []
  const toolKeys = (tools.data?.tools || []).map((tool) => tool.key)
  const setField = (key, value) => setDraft((current) => ({ ...current, [key]: value }))

  const resetDraft = () => {
    setEditing(null)
    setDraft(emptyTrigger())
    setNotice('')
    setError('')
  }

  const edit = (trigger) => {
    setEditing(trigger.id)
    setDraft({
      ...emptyTrigger(),
      ...trigger,
      interval_sec: String(trigger.interval_sec ?? 0),
      tool_names: Array.isArray(trigger.tool_names) ? trigger.tool_names : [],
    })
    setNotice('')
    setError('')
  }

  const save = async () => {
    if (draft.interval_sec <= 0 && !draft.on_finding && !draft.on_goal_met && !draft.on_task_timeout && !draft.on_tool_call && !draft.on_task_create) {
      return setError('至少选择一个触发条件')
    }
    if (draft.on_tool_call && draft.tool_names.length === 0) {
      return setError('on_tool_call 需要至少选择一个工具')
    }
    setBusy(true)
    setError('')
    setNotice('')
    const payload = { ...draft, key: agentKey }
    const { error: failure } = editing == null
      ? await run(() => api('/system/agent/trigger', { body: payload }))
      : await run(() => api(`/system/agent/trigger?id=${encodeURIComponent(editing)}`, { method: 'PATCH', body: payload }))
    setBusy(false)
    if (failure) return setError(failure)
    setNotice(editing == null ? '触发器已创建' : '触发器已保存')
    setEditing(null)
    setDraft(emptyTrigger())
    data.refresh()
  }

  const toggle = async (trigger) => {
    setError('')
    const { error: failure } = await run(() => api(`/system/agent/trigger?id=${encodeURIComponent(trigger.id)}`, {
      method: 'PATCH',
      body: { ...trigger, enabled: !trigger.enabled, key: agentKey },
    }))
    if (failure) setError(failure)
    else data.refresh()
  }

  const remove = async (trigger) => {
    if (!window.confirm(`删除 trigger #${trigger.id}？`)) return
    setError('')
    const { error: failure } = await run(() => api(`/system/agent/trigger?id=${encodeURIComponent(trigger.id)}`, { method: 'DELETE' }))
    if (failure) setError(failure)
    else {
      if (editing === trigger.id) resetDraft()
      data.refresh()
    }
  }

  if (builtin) {
    return h('div', { style: S.muted }, '内置 agent 不支持 trigger；请创建 custom agent。')
  }

  return h('div', null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    h('div', { style: { ...S.row, marginBottom: 6 } },
      h('button', { style: S.button, onClick: data.refresh }, '刷新'),
      h('button', { style: S.button, onClick: resetDraft }, '新建 Trigger'),
      h('span', { style: { ...S.muted, fontSize: 11 } }, `${triggers.length} 个 trigger`),
    ),
    triggers.length === 0
      ? h('div', { style: S.muted }, '还没有 trigger。')
      : triggers.map((trigger) => h('div', { key: trigger.id, style: { ...S.card, padding: 7, marginBottom: 5 } },
          h('div', { style: S.row },
            h(Badge, { tone: trigger.enabled ? undefined : 'danger' }, trigger.enabled ? 'enabled' : 'disabled'),
            h('span', { style: { flex: 1, fontSize: 11 } },
              [
                trigger.interval_sec > 0 ? `每 ${trigger.interval_sec}s` : '',
                trigger.on_finding ? 'finding' : '',
                trigger.on_goal_met ? 'goal' : '',
                trigger.on_task_timeout ? 'task timeout' : '',
                trigger.on_tool_call ? `tool: ${(trigger.tool_names || []).join(',')}` : '',
                trigger.on_task_create ? 'task create' : '',
              ].filter(Boolean).join(' · ')),
            h('button', { style: S.button, onClick: () => toggle(trigger) }, trigger.enabled ? '禁用' : '启用'),
            h('button', { style: S.button, onClick: () => edit(trigger) }, '编辑'),
            h('button', { style: S.danger, onClick: () => remove(trigger) }, '删除'),
          ),
          trigger.last_fire ? h('div', { style: { ...S.muted, fontSize: 10, marginTop: 2 } }, `last fire: ${trigger.last_fire}`) : null,
        )),
    h('div', { style: { ...S.card, marginTop: 8 } },
      h('div', { style: { fontWeight: 600, marginBottom: 4 } }, editing == null ? '新建 Trigger' : `编辑 Trigger #${editing}`),
      h('div', { style: { ...S.row, flexWrap: 'wrap', marginBottom: 4 } },
        h('label', { style: { ...S.row, fontSize: 12 } },
          h('input', { type: 'checkbox', checked: draft.enabled, onChange: (event) => setField('enabled', event.target.checked) }),
          h('span', null, 'enabled')),
        h('label', { style: { fontSize: 12 } }, '间隔秒 ',
          h('input', { type: 'number', min: 0, value: draft.interval_sec, onChange: (event) => setField('interval_sec', event.target.value), style: { ...S.input, width: 90 } })),
        h('label', { style: { ...S.row, fontSize: 12 } },
          h('input', { type: 'checkbox', checked: draft.on_finding, onChange: (event) => setField('on_finding', event.target.checked) }),
          h('span', null, 'on_finding')),
        h('label', { style: { ...S.row, fontSize: 12 } },
          h('input', { type: 'checkbox', checked: draft.on_goal_met, onChange: (event) => setField('on_goal_met', event.target.checked) }),
          h('span', null, 'on_goal_met')),
        h('label', { style: { ...S.row, fontSize: 12 } },
          h('input', { type: 'checkbox', checked: draft.on_task_timeout, onChange: (event) => setField('on_task_timeout', event.target.checked) }),
          h('span', null, 'on_task_timeout')),
        h('label', { style: { ...S.row, fontSize: 12 } },
          h('input', { type: 'checkbox', checked: draft.on_task_create, onChange: (event) => setField('on_task_create', event.target.checked) }),
          h('span', null, 'on_task_create')),
        h('label', { style: { ...S.row, fontSize: 12 } },
          h('input', { type: 'checkbox', checked: draft.on_tool_call, onChange: (event) => setField('on_tool_call', event.target.checked) }),
          h('span', null, 'on_tool_call')),
      ),
      draft.on_tool_call
        ? h('div', { style: { marginBottom: 4 } },
            h('div', { style: S.muted }, '触发工具（多选，Ctrl/⌘ + 点击）'),
            h('select', {
              multiple: true,
              size: 6,
              value: draft.tool_names,
              onChange: (event) => setField('tool_names', Array.from(event.target.selectedOptions).map((option) => option.value)),
              style: { ...S.input, width: '100%' },
            }, toolKeys.map((key) => h('option', { key, value: key }, key))),
          )
        : null,
      TRIGGER_MESSAGES.map(([condition, field, label]) => {
        const active = condition === 'interval'
          ? Number(draft.interval_sec) > 0
          : condition === 'finding' ? draft.on_finding
            : condition === 'goal' ? draft.on_goal_met
              : condition === 'task_timeout' ? draft.on_task_timeout
                : condition === 'tool_call' ? draft.on_tool_call
                  : draft.on_task_create
        return active
          ? h('label', { key: field, style: { display: 'block', marginBottom: 4 } },
              h('div', { style: S.muted }, label),
              h('input', {
                value: draft[field],
                onChange: (event) => setField(field, event.target.value),
                placeholder: '发给 agent 的消息（空 = 使用内置默认）',
                style: S.input,
              }),
            )
          : null
      }),
      h('div', { style: S.row },
        h('button', { style: S.primary, onClick: save, disabled: busy }, busy ? '保存中…' : editing == null ? '创建 Trigger' : '保存 Trigger'),
        editing == null ? null : h('button', { style: S.button, onClick: resetDraft }, '取消编辑'),
      ),
      notice ? h('div', { style: { ...S.muted, marginTop: 4 } }, notice) : null,
      error ? h('div', { style: { ...S.error, marginTop: 4 } }, error) : null,
    ),
  )
}

function SystemAgents() {
  const data = usePoll('/system/agents', 15_000)
  const [selectedKey, setSelectedKey] = useState('')
  const [detail, setDetail] = useState(null)
  const [template, setTemplate] = useState('')
  const [note, setNote] = useState('')
  const [tab, setTab] = useState('prompt')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ key: '', name: '', description: '' })
  const [renaming, setRenaming] = useState(false)
  const [renameForm, setRenameForm] = useState({ name: '', description: '' })
  const agents = data.data?.agents || []
  const currentAgent = detail?.agent || agents.find((agent) => agent.key === selectedKey) || null
  const builtin = Boolean(currentAgent?.builtin)

  const open = async (agent) => {
    setSelectedKey(agent.key)
    setDetail(null)
    setTab('prompt')
    setError('')
    setNotice('')
    setRenaming(false)
    const { result, error: failure } = await run(() => api(`/system/agent?key=${encodeURIComponent(agent.key)}`))
    if (failure) setError(failure)
    else {
      setDetail(result)
      setTemplate(typeof result?.prompt === 'string' ? result.prompt : (result?.prompt?.template || ''))
      setRenameForm({ name: result?.agent?.name || '', description: result?.agent?.description || '' })
    }
  }

  const refreshDetail = async () => {
    if (!selectedKey) return
    const { result } = await run(() => api(`/system/agent?key=${encodeURIComponent(selectedKey)}`))
    if (result) setDetail(result)
    data.refresh()
  }

  const create = async () => {
    if (!createForm.key.trim() || !createForm.name.trim()) return setError('key 和 name 必填')
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/system/agent', {
      body: { key: createForm.key.trim(), name: createForm.name.trim(), description: createForm.description.trim() },
    }))
    setBusy(false)
    if (failure) return setError(failure)
    setShowCreate(false)
    const key = createForm.key.trim()
    setCreateForm({ key: '', name: '', description: '' })
    setNotice(`agent ${key} 已创建`)
    data.refresh()
    open({ key })
  }

  const saveRename = async () => {
    if (!selectedKey || !renameForm.name.trim()) return setError('name 不能为空')
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api(`/system/agent?key=${encodeURIComponent(selectedKey)}`, {
      method: 'PATCH',
      body: { name: renameForm.name.trim(), description: renameForm.description.trim() },
    }))
    setBusy(false)
    if (failure) return setError(failure)
    setRenaming(false)
    setNotice('名称/描述已保存')
    refreshDetail()
  }

  const removeAgent = async () => {
    if (!selectedKey || builtin) return
    if (!window.confirm(`删除 custom agent ${selectedKey}？prompt/triggers 一并删除。`)) return
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api(`/system/agent?key=${encodeURIComponent(selectedKey)}`, { method: 'DELETE' }))
    setBusy(false)
    if (failure) return setError(failure)
    setNotice(`agent ${selectedKey} 已删除`)
    setSelectedKey('')
    setDetail(null)
    data.refresh()
  }

  const save = async () => {
    if (!selectedKey) return
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/system/agent/prompt', {
      body: { key: selectedKey, template, note },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else setNotice(`${selectedKey} prompt 已保存（新版本）`)
  }

  const reset = async () => {
    if (!selectedKey) return
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/system/agent/prompt/reset', { body: { key: selectedKey } }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setNotice(`${selectedKey} 已恢复内置默认 prompt`)
      open({ key: selectedKey })
    }
  }

  return h('div', null,
    h('div', { style: { ...S.row, marginBottom: 6 } },
      h('button', { style: S.button, onClick: data.refresh }, '刷新'),
      h('button', { style: S.primary, onClick: () => setShowCreate((value) => !value) }, showCreate ? '取消新建' : '新建 Agent'),
      h('span', { style: { ...S.muted, fontSize: 11 } }, `${agents.length} 个 agent`),
    ),
    showCreate
      ? h('div', { style: { ...S.card, marginBottom: 8 } },
          h('div', { style: { ...S.row, marginBottom: 4 } },
            h('input', { value: createForm.key, onChange: (event) => setCreateForm((current) => ({ ...current, key: event.target.value })), placeholder: 'key（lowercase_underscore）', style: { ...S.input, flex: 1 } }),
            h('input', { value: createForm.name, onChange: (event) => setCreateForm((current) => ({ ...current, name: event.target.value })), placeholder: 'name', style: { ...S.input, flex: 1 } }),
          ),
          h('input', { value: createForm.description, onChange: (event) => setCreateForm((current) => ({ ...current, description: event.target.value })), placeholder: 'description（可选）', style: { ...S.input, marginBottom: 4 } }),
          h('button', { style: S.primary, onClick: create, disabled: busy }, busy ? '创建中…' : '创建 custom agent'),
        )
      : null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    error ? h('div', { style: S.error }, error) : null,
    h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
      h('thead', null, h('tr', null, ['key', 'name', 'role', 'enabled', 'tools', 'skills'].map((label) => h('th', {
        key: label,
        style: { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--dsw-alias-border-l1, #e5e7eb)' },
      }, label)))),
      h('tbody', null, agents.map((agent) => h('tr', {
        key: agent.key,
        onClick: () => open(agent),
        style: {
          borderBottom: '1px solid var(--dsw-alias-border-l1, #e5e7eb)',
          cursor: 'pointer',
          background: selectedKey === agent.key ? 'var(--dsw-alias-bg-layer-2, #f3f4f6)' : 'transparent',
        },
      },
        h('td', { style: { padding: '4px 6px' } }, agent.key),
        h('td', { style: { padding: '4px 6px' } }, agent.name),
        h('td', { style: { padding: '4px 6px' } }, agent.role),
        h('td', { style: { padding: '4px 6px' } }, agent.enabled ? 'yes' : 'no'),
        h('td', { style: { padding: '4px 6px' } }, agent.tool_count ?? ''),
        h('td', { style: { padding: '4px 6px' } }, agent.skill_count ?? ''),
      ))),
    ),
    detail
      ? h('div', { style: { ...S.card, marginTop: 10 } },
          h('div', { style: { ...S.row, marginBottom: 4, flexWrap: 'wrap' } },
            h('strong', null, selectedKey),
            h('span', { style: { ...S.muted, fontSize: 11 } }, currentAgent?.name || ''),
            h(Badge, { tone: builtin ? undefined : 'danger' }, builtin ? 'builtin' : 'custom'),
            h('span', { style: { flex: 1 } }),
            builtin ? null : h('button', { style: S.button, onClick: () => setRenaming((value) => !value) }, renaming ? '取消改名' : '改名'),
            builtin ? null : h('button', { style: S.danger, onClick: removeAgent, disabled: busy }, '删除 agent'),
          ),
          renaming
            ? h('div', { style: { ...S.card, padding: 6, marginBottom: 6 } },
                h('input', { value: renameForm.name, onChange: (event) => setRenameForm((current) => ({ ...current, name: event.target.value })), placeholder: 'name', style: { ...S.input, marginBottom: 4 } }),
                h('input', { value: renameForm.description, onChange: (event) => setRenameForm((current) => ({ ...current, description: event.target.value })), placeholder: 'description', style: { ...S.input, marginBottom: 4 } }),
                h('button', { style: S.primary, onClick: saveRename, disabled: busy }, '保存名称'),
              )
            : null,
          h('div', { style: { ...S.row, marginBottom: 6 } },
            ['prompt', 'config', 'tools', 'triggers', 'visibility'].map((id) => h('button', {
              key: id,
              style: { ...S.tab, ...(tab === id ? S.tabActive : {}) },
              onClick: () => setTab(id),
            }, id)),
          ),
          notice ? h('div', { style: { ...S.muted, fontSize: 11 } }, notice) : null,
          error ? h('div', { style: S.error }, error) : null,
          tab === 'prompt'
            ? h('div', null,
                h('div', { style: { ...S.row, marginBottom: 4 } },
                  h('span', { style: { ...S.muted, fontSize: 11 } }, detail?.prompt?.version ? `v${detail.prompt.version}` : 'current'),
                  h('span', { style: { flex: 1 } }),
                  h('button', { style: S.button, onClick: reset, disabled: busy }, '恢复默认'),
                  h('button', { style: S.primary, onClick: save, disabled: busy }, busy ? '保存中…' : '保存 prompt'),
                ),
                h('textarea', {
                  value: template,
                  onChange: (event) => setTemplate(event.target.value),
                  rows: 16,
                  style: { ...S.input, resize: 'vertical', fontFamily: 'ui-monospace, Consolas, monospace' },
                }),
                h('input', {
                  value: note,
                  onChange: (event) => setNote(event.target.value),
                  placeholder: '版本备注（可选）',
                  style: { ...S.input, marginTop: 4 },
                }),
              )
            : tab === 'config'
              ? h(AgentConfig, { detail, onSaved: refreshDetail })
              : tab === 'tools'
                ? h(AgentTools, { agentKey: selectedKey })
                : tab === 'triggers'
                  ? h(AgentTriggers, { agentKey: selectedKey, builtin })
                  : h(AgentVisibility, { agentKey: selectedKey }),
        )
      : h('div', { style: { ...S.muted, marginTop: 6, fontSize: 11 } }, '点击 agent 行查看/编辑 prompt、config、工具绑定与触发器。'),
  )
}

function SystemTools() {
  const data = usePoll('/system/tools', 15_000)
  const tools = (data.data?.tools || []).filter((tool) => !tool.system)
  const [form, setForm] = useState({
    key: '', description: '', kind: 'command', enabled: true, deferred: false, agents: '', schema: '{}', exec: '{}',
  })
  const [editing, setEditing] = useState('')
  const [busy, setBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [testOutput, setTestOutput] = useState('')
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const pick = (tool) => {
    setEditing(tool.key)
    setError('')
    setNotice('')
    setTestOutput('')
    setForm({
      key: tool.key,
      description: tool.description || '',
      kind: tool.kind || 'command',
      enabled: Boolean(tool.enabled),
      deferred: Boolean(tool.deferred),
      agents: (tool.agents || []).join(','),
      schema: JSON.stringify(tool.schema || {}, null, 2),
      exec: JSON.stringify(tool.exec || {}, null, 2),
    })
  }

  const save = async () => {
    if (!form.key.trim()) return setError('key 必填')
    let schema
    let exec
    try {
      schema = form.schema.trim() ? JSON.parse(form.schema) : {}
      exec = form.exec.trim() ? JSON.parse(form.exec) : {}
    } catch {
      return setError('schema / exec 必须是合法 JSON')
    }
    setBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/system/tool', {
      body: {
        key: form.key.trim(),
        description: form.description,
        kind: form.kind,
        enabled: form.enabled,
        deferred: form.deferred,
        agents: form.agents.split(',').map((value) => value.trim()).filter(Boolean),
        schema,
        exec,
        update: Boolean(editing),
      },
    }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setNotice(`custom tool ${form.key} 已保存`)
      setEditing(form.key.trim())
      data.refresh()
    }
  }

  const test = async () => {
    let exec
    try {
      exec = form.exec.trim() ? JSON.parse(form.exec) : {}
    } catch {
      return setError('exec 必须是合法 JSON')
    }
    setTestBusy(true)
    setError('')
    setTestOutput('')
    const { result, error: failure } = await run(() => api('/system/tool/test', {
      body: { key: form.key, kind: form.kind, exec, params: {} },
    }))
    setTestBusy(false)
    if (failure) setError(failure)
    else setTestOutput(`${result?.result?.is_error ? 'ERROR' : 'OK'}\n${result?.result?.output || ''}`)
  }

  const remove = async (tool) => {
    if (!window.confirm(`删除 custom tool ${tool.key}？`)) return
    setError('')
    const { error: failure } = await run(() => api(`/system/tool?key=${encodeURIComponent(tool.key)}`, { method: 'DELETE' }))
    if (failure) setError(failure)
    else {
      setNotice(`已删除 ${tool.key}`)
      if (editing === tool.key) {
        setEditing('')
        setForm({ key: '', description: '', kind: 'command', enabled: true, deferred: false, agents: '', schema: '{}', exec: '{}' })
      }
    }
    data.refresh()
  }

  return h('div', null,
    h('div', { style: { ...S.row, marginBottom: 8 } },
      h('button', { style: S.button, onClick: data.refresh }, '刷新'),
      h('button', {
        style: S.button,
        onClick: () => {
          setEditing('')
          setForm({ key: '', description: '', kind: 'command', enabled: true, deferred: false, agents: '', schema: '{}', exec: '{}' })
          setNotice('')
          setError('')
          setTestOutput('')
        },
      }, '新建'),
      h('span', { style: { ...S.muted, fontSize: 11 } }, `${tools.length} 个 custom tool`),
    ),
    notice ? h('div', { style: { ...S.muted, marginBottom: 4 } }, notice) : null,
    error ? h('div', { style: { ...S.error, marginBottom: 4 } }, error) : null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    h('div', { style: { ...S.card, marginBottom: 8 } },
      h('div', { style: { fontWeight: 600, marginBottom: 4 } }, editing ? `编辑 ${editing}` : '新建 Custom Tool'),
      h('div', { style: { ...S.row, marginBottom: 4 } },
        h('input', { value: form.key, onChange: (event) => setField('key', event.target.value), placeholder: 'key（lowercase_underscore）', style: { ...S.input, flex: 1 } }),
        h('select', { value: form.kind, onChange: (event) => setField('kind', event.target.value), style: { ...S.input, width: 130, flex: '0 0 auto' } },
          ['command', 'script', 'http', 'shell'].map((value) => h('option', { key: value, value }, value))),
      ),
      h('input', { value: form.description, onChange: (event) => setField('description', event.target.value), placeholder: 'description（模型何时用）', style: { ...S.input, marginBottom: 4 } }),
      h('div', { style: { ...S.row, marginBottom: 4 } },
        h('input', { value: form.agents, onChange: (event) => setField('agents', event.target.value), placeholder: 'agents（逗号分隔，空=全部）', style: { ...S.input, flex: 1 } }),
        h('label', { style: { ...S.row, gap: 4, fontSize: 12 } },
          h('input', { type: 'checkbox', checked: form.enabled, onChange: (event) => setField('enabled', event.target.checked) }),
          h('span', null, 'enabled'),
        ),
        h('label', { style: { ...S.row, gap: 4, fontSize: 12 } },
          h('input', { type: 'checkbox', checked: form.deferred, onChange: (event) => setField('deferred', event.target.checked) }),
          h('span', null, 'deferred'),
        ),
      ),
      h('div', { style: S.muted }, 'schema JSON'),
      h('textarea', { value: form.schema, onChange: (event) => setField('schema', event.target.value), rows: 4, style: { ...S.input, resize: 'vertical' } }),
      h('div', { style: { ...S.muted, marginTop: 4 } }, 'exec JSON'),
      h('textarea', { value: form.exec, onChange: (event) => setField('exec', event.target.value), rows: 6, style: { ...S.input, resize: 'vertical' } }),
      h('div', { style: { ...S.row, marginTop: 4 } },
        h('button', { style: S.primary, onClick: save, disabled: busy }, busy ? '保存中…' : '保存'),
        h('button', { style: S.button, onClick: test, disabled: testBusy }, testBusy ? '测试中…' : '测试 exec'),
      ),
      testOutput ? h('pre', { style: { ...S.pre, maxHeight: 220 } }, testOutput) : null,
    ),
    tools.length === 0
      ? h('div', { style: S.muted }, '没有 custom tool。')
      : tools.map((tool) => h('div', { key: tool.key, style: S.card },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('div', { style: S.row },
              h('strong', null, tool.key),
              h(Badge, null, tool.kind || '?'),
              h(Badge, { tone: tool.enabled ? undefined : 'danger' }, tool.enabled ? 'enabled' : 'disabled'),
              h(Badge, null, `${tool.calls || 0} calls`),
            ),
            h('div', { style: S.row },
              h('button', { style: S.button, onClick: () => pick(tool) }, '编辑'),
              h('button', { style: S.danger, onClick: () => remove(tool) }, '删除'),
            ),
          ),
          h('div', { style: { ...S.muted, fontSize: 11, marginTop: 2 } }, tool.description || ''),
        )),
  )
}

function NotifyDeliveries({ channels }) {
  const [state, setState] = useState('')
  const [eventKind, setEventKind] = useState('')
  const [channelId, setChannelId] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const query = new URLSearchParams({
    state, event_kind: eventKind, channel_id: channelId,
    page: String(page), page_size: String(pageSize),
  })
  const data = usePoll(`/system/notify/deliveries?${query}`, 20_000)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const deliveries = data.data?.deliveries || []
  const total = Number(data.data?.total || 0)

  const retry = async (delivery) => {
    setNotice('')
    setError('')
    const { error: failure } = await run(() => api('/system/notify/delivery/retry', { body: { id: delivery.id } }))
    if (failure) setError(failure)
    else {
      setNotice(`delivery #${delivery.id} 已重新入队`)
      data.refresh()
    }
  }

  return h('div', { style: { ...S.card, marginTop: 8 } },
    h('div', { style: { ...S.row, marginBottom: 6 } },
      h('strong', null, '投递记录'),
      h('select', { value: state, onChange: (event) => { setState(event.target.value); setPage(1) }, style: { ...S.input, width: 110 } },
        h('option', { value: '' }, 'all states'),
        ['pending', 'sending', 'sent', 'failed', 'skipped'].map((value) => h('option', { key: value, value }, value))),
      h('input', { value: eventKind, onChange: (event) => { setEventKind(event.target.value); setPage(1) }, placeholder: 'event_kind', style: { ...S.input, width: 130 } }),
      h('select', { value: channelId, onChange: (event) => { setChannelId(event.target.value); setPage(1) }, style: { ...S.input, width: 160 } },
        h('option', { value: '' }, 'all channels'),
        (channels || []).map((channel) => h('option', { key: channel.id, value: String(channel.id) }, channel.name))),
      h('button', { style: S.button, onClick: data.refresh }, '刷新'),
      h('span', { style: { ...S.muted, fontSize: 11 } }, `${total} 条`),
    ),
    notice ? h('div', { style: { ...S.muted, fontSize: 11 } }, notice) : null,
    error ? h('div', { style: S.error }, error) : null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    deliveries.length === 0
      ? h('div', { style: S.muted }, '暂无投递记录。')
      : deliveries.map((delivery) => h('div', { key: delivery.id, style: { ...S.card, padding: 7, marginBottom: 4 } },
          h('div', { style: S.row },
            h(Badge, { tone: ['failed', 'skipped'].includes(delivery.state) ? 'danger' : undefined }, delivery.state),
            h(Badge, { tone: delivery.severity === 'critical' || delivery.severity === 'high' ? 'danger' : undefined }, delivery.severity || '?'),
            h('strong', { style: { fontSize: 12 } }, delivery.title || `delivery #${delivery.id}`),
            h('span', { style: { flex: 1 } }),
            h('span', { style: { ...S.muted, fontSize: 10 } }, `${delivery.channel_name || delivery.channel_id} · ${delivery.event_kind || ''} · attempts ${delivery.attempts ?? 0}`),
            ['pending', 'failed', 'skipped'].includes(delivery.state)
              ? h('button', { style: S.button, onClick: () => retry(delivery) }, '重试')
              : null,
          ),
          delivery.last_error ? h('div', { style: { ...S.error, fontSize: 11, marginTop: 2, wordBreak: 'break-all' } }, delivery.last_error) : null,
          h('div', { style: { ...S.muted, fontSize: 10, marginTop: 2 } },
            `finding ${delivery.finding_id || '?'} · created ${String(delivery.created_at || '').replace('T', ' ').slice(0, 19)}${delivery.sent_at ? ` · sent ${String(delivery.sent_at).replace('T', ' ').slice(0, 19)}` : ''}`),
        )),
    h('div', { style: { ...S.row, marginTop: 6 } },
      h('button', { style: S.button, disabled: page <= 1, onClick: () => setPage(Math.max(1, page - 1)) }, '上一页'),
      h('span', { style: S.muted }, `第 ${page} 页`),
      h('button', { style: S.button, disabled: page * pageSize >= total, onClick: () => setPage(page + 1) }, '下一页'),
    ),
  )
}

function emptyNotifyForm() {
  return {
    name: '', kind: 'dingtalk', enabled: true, mode: 'realtime', rate_per_min: '', config: '{}',
    min_severity: '', task_ids: '', asset_ids: '', vulnclass_include: '', vulnclass_exclude: '', on_status_change: false,
  }
}

function idList(value) {
  return String(value || '').split(/[,\s]+/).map(Number).filter((item) => Number.isFinite(item) && item > 0)
}

function SystemNotify() {
  const data = usePoll('/system/notify', 20_000)
  const channels = data.data?.channels || []
  const [form, setForm] = useState(emptyNotifyForm)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const open = (channel) => {
    setEditing(channel.id)
    const filter = channel.filter || {}
    setForm({
      name: channel.name || '',
      kind: channel.kind || 'dingtalk',
      enabled: channel.enabled !== false,
      mode: channel.mode || 'realtime',
      rate_per_min: String(channel.rate_per_min ?? ''),
      config: JSON.stringify(channel.config || {}, null, 2),
      min_severity: filter.min_severity || '',
      task_ids: (filter.task_ids || []).join(','),
      asset_ids: (filter.asset_ids || []).join(','),
      vulnclass_include: (filter.vulnclass_include || []).join(','),
      vulnclass_exclude: (filter.vulnclass_exclude || []).join(','),
      on_status_change: Boolean(filter.on_status_change),
    })
    setNotice('')
    setError('')
  }

  const reset = () => {
    setEditing(null)
    setForm(emptyNotifyForm())
    setNotice('')
    setError('')
  }

  const save = async () => {
    if (!form.name.trim()) return setError('channel name 必填')
    let config
    try {
      config = form.config.trim() ? JSON.parse(form.config) : {}
    } catch {
      return setError('config 必须是合法 JSON')
    }
    setBusy(true)
    setError('')
    setNotice('')
    const body = {
      name: form.name.trim(),
      kind: form.kind,
      enabled: form.enabled,
      mode: form.mode,
      config,
      filter: {
        min_severity: form.min_severity,
        task_ids: idList(form.task_ids),
        asset_ids: idList(form.asset_ids),
        vulnclass_include: form.vulnclass_include.split(',').map((value) => value.trim()).filter(Boolean),
        vulnclass_exclude: form.vulnclass_exclude.split(',').map((value) => value.trim()).filter(Boolean),
        on_status_change: form.on_status_change,
      },
    }
    if (form.rate_per_min !== '') body.rate_per_min = Number(form.rate_per_min)
    const { error: failure } = editing == null
      ? await run(() => api('/system/notify', { body }))
      : await run(() => api(`/system/notify?id=${encodeURIComponent(editing)}`, { method: 'PATCH', body }))
    setBusy(false)
    if (failure) return setError(failure)
    setNotice(editing == null ? 'channel 已创建' : 'channel 已保存')
    reset()
    data.refresh()
  }

  const test = async (channel) => {
    setError('')
    setNotice('')
    const { error: failure } = await run(() => api('/system/notify/test', { body: { id: channel.id } }))
    if (failure) setError(failure)
    else setNotice(`测试消息已发送：${channel.name}`)
  }

  const remove = async (channel) => {
    if (!window.confirm(`删除 notification channel ${channel.name}？`)) return
    setError('')
    const { error: failure } = await run(() => api(`/system/notify?id=${encodeURIComponent(channel.id)}`, { method: 'DELETE' }))
    if (failure) setError(failure)
    else {
      if (editing === channel.id) reset()
      setNotice(`已删除 ${channel.name}`)
      data.refresh()
    }
  }

  const filterSummary = (filter = {}) => {
    const parts = []
    if (filter.min_severity) parts.push(`≥${filter.min_severity}`)
    if ((filter.task_ids || []).length) parts.push(`tasks ${filter.task_ids.join(',')}`)
    if ((filter.asset_ids || []).length) parts.push(`assets ${filter.asset_ids.join(',')}`)
    if ((filter.vulnclass_include || []).length) parts.push(`include ${filter.vulnclass_include.join('|')}`)
    if ((filter.vulnclass_exclude || []).length) parts.push(`exclude ${filter.vulnclass_exclude.join('|')}`)
    if (filter.on_status_change) parts.push('status changes')
    return parts.length ? parts.join(' · ') : '无过滤（全部推送）'
  }

  return h('div', null,
    h('div', { style: { ...S.row, marginBottom: 6 } },
      h('button', { style: S.button, onClick: data.refresh }, '刷新'),
      h('button', { style: S.button, onClick: reset }, '新建'),
      h('span', { style: { ...S.muted, fontSize: 11 } }, `${channels.length} 个 channel`),
    ),
    notice ? h('div', { style: { ...S.muted, marginBottom: 4 } }, notice) : null,
    error ? h('div', { style: { ...S.error, marginBottom: 4 } }, error) : null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    h('div', { style: { ...S.card, marginBottom: 8 } },
      h('div', { style: { fontWeight: 600, marginBottom: 4 } }, editing == null ? '新建 Notification Channel' : `编辑 Channel #${editing}`),
      h('div', { style: { ...S.row, marginBottom: 4 } },
        h('input', { value: form.name, onChange: (event) => setField('name', event.target.value), placeholder: 'name', style: { ...S.input, flex: 1 } }),
        h('select', { value: form.kind, onChange: (event) => setField('kind', event.target.value), style: { ...S.input, width: 140, flex: '0 0 auto' } },
          ['dingtalk', 'feishu', 'wecom', 'webhook', 'telegram', 'email'].map((value) => h('option', { key: value, value }, value))),
      ),
      h('div', { style: { ...S.row, flexWrap: 'wrap', marginBottom: 4 } },
        h('label', { style: { fontSize: 12 } }, '模式 ',
          h('select', { value: form.mode, onChange: (event) => setField('mode', event.target.value), style: { ...S.input, width: 110 } },
            h('option', { value: 'realtime' }, 'realtime'),
            h('option', { value: 'digest' }, 'digest'),
          )),
        h('label', { style: { fontSize: 12 } }, '每分钟上限 ',
          h('input', { type: 'number', min: 0, value: form.rate_per_min, onChange: (event) => setField('rate_per_min', event.target.value), placeholder: '默认', style: { ...S.input, width: 90 } })),
        h('label', { style: { ...S.row, fontSize: 12 } },
          h('input', { type: 'checkbox', checked: form.enabled, onChange: (event) => setField('enabled', event.target.checked) }),
          h('span', null, '启用')),
      ),
      h('div', { style: S.muted }, 'config JSON（按 channel 类型填写 token/url/smtp 等；密钥字段回传掩码表示保持不变）'),
      h('textarea', { value: form.config, onChange: (event) => setField('config', event.target.value), rows: 6, style: { ...S.input, resize: 'vertical' } }),
      h('div', { style: { ...S.muted, marginTop: 6, fontWeight: 600 } }, '过滤器（任一字段留空 = 不限制）'),
      h('div', { style: { ...S.row, flexWrap: 'wrap', marginBottom: 4 } },
        h('label', { style: { fontSize: 12 } }, '最低严重级 ',
          h('select', { value: form.min_severity, onChange: (event) => setField('min_severity', event.target.value), style: { ...S.input, width: 110 } },
            h('option', { value: '' }, '（不限）'),
            ['low', 'medium', 'high', 'critical'].map((value) => h('option', { key: value, value }, value)),
          )),
        h('label', { style: { fontSize: 12, flex: '1 1 180px' } }, 'task_ids（逗号分隔）',
          h('input', { value: form.task_ids, onChange: (event) => setField('task_ids', event.target.value), placeholder: '12,34', style: S.input })),
        h('label', { style: { fontSize: 12, flex: '1 1 180px' } }, 'asset_ids（逗号分隔）',
          h('input', { value: form.asset_ids, onChange: (event) => setField('asset_ids', event.target.value), placeholder: '7,8', style: S.input })),
      ),
      h('div', { style: { ...S.row, flexWrap: 'wrap', marginBottom: 4 } },
        h('label', { style: { fontSize: 12, flex: '1 1 220px' } }, 'vulnclass include（逗号分隔）',
          h('input', { value: form.vulnclass_include, onChange: (event) => setField('vulnclass_include', event.target.value), placeholder: 'sqli,xss', style: S.input })),
        h('label', { style: { fontSize: 12, flex: '1 1 220px' } }, 'vulnclass exclude（逗号分隔）',
          h('input', { value: form.vulnclass_exclude, onChange: (event) => setField('vulnclass_exclude', event.target.value), placeholder: 'info,low', style: S.input })),
        h('label', { style: { ...S.row, fontSize: 12 } },
          h('input', { type: 'checkbox', checked: form.on_status_change, onChange: (event) => setField('on_status_change', event.target.checked) }),
          h('span', null, 'status 变更也推送')),
      ),
      h('div', { style: S.row },
        h('button', { style: S.primary, onClick: save, disabled: busy }, busy ? '保存中…' : editing == null ? '创建' : '保存修改'),
        editing == null ? null : h('button', { style: S.button, onClick: reset, disabled: busy }, '取消编辑'),
      ),
    ),
    channels.length === 0
      ? h('div', { style: S.muted }, '没有 notification channel。')
      : channels.map((channel) => h('div', { key: channel.id, style: S.card },
          h('div', { style: { ...S.row, justifyContent: 'space-between' } },
            h('div', { style: S.row, flexWrap: 'wrap' },
              h('strong', null, channel.name || `Channel ${channel.id}`),
              h(Badge, null, channel.kind || channel.type || '?'),
              h(Badge, null, channel.mode || 'realtime'),
              h(Badge, { tone: channel.enabled === false ? 'danger' : undefined }, channel.enabled === false ? 'disabled' : 'enabled'),
            ),
            h('div', { style: S.row },
              h('button', { style: S.button, onClick: () => open(channel) }, '编辑'),
              h('button', { style: S.button, onClick: () => test(channel) }, '测试'),
              h('button', { style: S.danger, onClick: () => remove(channel) }, '删除'),
            ),
          ),
          h('div', { style: { ...S.muted, fontSize: 11, marginTop: 2 } },
            `${filterSummary(channel.filter)} · rate ${channel.rate_per_min ?? 'default'}/min`),
          h('pre', { style: { ...S.pre, maxHeight: 160 } }, JSON.stringify(channel.config || {}, null, 2)),
        )),
    h(NotifyDeliveries, { channels }),
  )
}

function SystemLogs() {
  const data = usePoll('/system/logs?limit=300', 5_000)
  const lines = (data.data?.items || []).map((item) => {
    const ts = item.ts ? String(item.ts).replace('T', ' ').slice(0, 19) : ''
    return `${ts} ${String(item.level || '').toUpperCase().padEnd(5)} ${item.tag ? `[${item.tag}] ` : ''}${item.text || ''}`
  })
  return h('div', null,
    h('div', { style: { ...S.row, marginBottom: 6 } },
      h('button', { style: S.button, onClick: data.refresh }, '刷新'),
      h('span', { style: { ...S.muted, fontSize: 11 } }, `${lines.length} 行 · 5s 自动刷新`),
    ),
    data.error ? h('div', { style: S.error }, data.error) : null,
    h('pre', { style: { ...S.pre, maxHeight: 520 } }, lines.join('\n')),
  )
}

function SystemWorkspace() {
  const [path, setPath] = useState('')
  const data = usePoll(`/system/workspace?path=${encodeURIComponent(path)}`, 15_000)
  const [file, setFile] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [fileBusy, setFileBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const entries = data.data?.entries || []

  const open = async (entry) => {
    setError('')
    if (entry.dir) {
      setPath(entry.path)
      setFile(null)
      return
    }
    const { result, error: failure } = await run(() => api(`/system/workspace/read?path=${encodeURIComponent(entry.path)}`))
    if (failure) setError(failure)
    else {
      setFile(result)
      setEditContent(result?.content || '')
      setNotice('')
    }
  }

  const save = async () => {
    if (!file?.path) return
    setFileBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/system/workspace/write', {
      body: { path: file.path, content: editContent },
    }))
    setFileBusy(false)
    if (failure) setError(failure)
    else setNotice(`${file.path} 已保存`)
  }

  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  return h('div', null,
    h('div', { style: { ...S.row, marginBottom: 6 } },
      h('span', { style: S.muted }, `/${path}`),
      h('button', { style: S.button, onClick: () => { setPath(parent); setFile(null) }, disabled: !path }, '上一级'),
      h('button', { style: S.button, onClick: data.refresh }, '刷新'),
    ),
    error ? h('div', { style: { ...S.error, marginBottom: 4 } }, error) : null,
    data.error ? h('div', { style: S.error }, data.error) : null,
    entries.length === 0
      ? h('div', { style: S.muted }, '目录为空。')
      : entries.map((entry) => h('button', {
          key: entry.path,
          style: { ...S.button, display: 'block', width: '100%', textAlign: 'left', marginBottom: 3 },
          onClick: () => open(entry),
        }, `${entry.dir ? '📁' : '📄'} ${entry.name}${entry.dir ? '' : ` (${entry.size} B)`}`)),
    file
      ? h('div', { style: { marginTop: 8 } },
          h('div', { style: { ...S.muted, fontSize: 11 } }, file.path),
          file.too_large
            ? h('div', { style: S.muted }, '文件过大，无法内联预览。')
            : file.binary
              ? h('div', { style: S.muted }, '二进制文件，无法预览。')
              : h('div', null,
                  h('textarea', {
                    value: editContent,
                    onChange: (event) => setEditContent(event.target.value),
                    rows: 12,
                    style: { ...S.input, resize: 'vertical' },
                  }),
                  h('div', { style: { ...S.row, marginTop: 4 } },
                    h('button', { style: S.primary, onClick: save, disabled: fileBusy }, fileBusy ? '保存中…' : '保存文件'),
                    notice ? h('span', { style: { ...S.muted, fontSize: 11 } }, notice) : null,
                  ),
                ),
        )
      : null,
  )
}

function SystemSettings() {
  const data = usePoll('/system/settings', 15_000)
  const settings = data.data?.settings || null
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const initialized = useRef(false)

  useEffect(() => {
    if (settings && !initialized.current) {
      initialized.current = true
      setDraft({ ...settings })
    }
  }, [settings])

  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }))

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    const patch = {
      noise_profile: draft.noise_profile || 'off',
      workers: Number(draft.workers) || 3,
      task_concurrency_enabled: Boolean(draft.task_concurrency_enabled),
      task_concurrency_limit: Number(draft.task_concurrency_limit) || 5,
      traffic_capture: Boolean(draft.traffic_capture),
      agent_traffic_binding: Boolean(draft.agent_traffic_binding),
      llm_record: Boolean(draft.llm_record),
      constraints_inject_planner: Boolean(draft.constraints_inject_planner),
      constraints_inject_worker: Boolean(draft.constraints_inject_worker),
      noa_compaction: Boolean(draft.noa_compaction),
      notify_enabled: Boolean(draft.notify_enabled),
    }
    const { result, error: failure } = await run(() => api('/system/settings', { body: patch }))
    setBusy(false)
    if (failure) setError(failure)
    else {
      setDraft({ ...(result?.settings || draft) })
      setNotice('已保存。workers / 约束注入等设置对之后启动的 run 生效。')
      data.refresh()
    }
  }

  if (!settings) return h('div', { style: S.muted }, data.error || '加载设置…')

  return h('div', null,
    data.error ? h('div', { style: S.error, marginBottom: 4 }, data.error) : null,
    notice ? h('div', { style: { ...S.muted, marginBottom: 4 } }, notice) : null,
    error ? h('div', { style: { ...S.error, marginBottom: 4 } }, error) : null,
    h('div', { style: S.card },
      h('div', { style: { fontWeight: 600, marginBottom: 6 } }, 'Target / runtime'),
      h('label', { style: { display: 'block', marginBottom: 8 } },
        h('div', { style: S.muted }, 'noise_profile'),
        h('select', { value: draft.noise_profile || 'off', onChange: (event) => set('noise_profile', event.target.value), style: S.input },
          ['off', 'quiet', 'balanced', 'aggressive'].map((value) => h('option', { key: value, value }, value))),
      ),
      h('label', { style: { display: 'block', marginBottom: 8 } },
        h('div', { style: S.muted }, 'workers（每任务并发 worker 数）'),
        h('input', { type: 'number', min: 1, max: 32, value: draft.workers ?? 3, onChange: (event) => set('workers', event.target.value), style: S.input }),
      ),
      h('label', { style: { ...S.row, marginBottom: 6 } },
        h('input', { type: 'checkbox', checked: Boolean(draft.task_concurrency_enabled), onChange: (event) => set('task_concurrency_enabled', event.target.checked) }),
        h('span', null, '限制同时运行的任务数'),
        h('input', { type: 'number', min: 1, value: draft.task_concurrency_limit ?? 5, onChange: (event) => set('task_concurrency_limit', event.target.value), style: { ...S.input, width: 80 } }),
      ),
    ),
    h('div', { style: S.card },
      h('div', { style: { fontWeight: 600, marginBottom: 6 } }, 'Capture / recording'),
      h('label', { style: { ...S.row, marginBottom: 4 } },
        h('input', { type: 'checkbox', checked: Boolean(draft.traffic_capture), onChange: (event) => set('traffic_capture', event.target.checked) }),
        h('span', null, 'traffic_capture（录制工具流量）'),
      ),
      h('label', { style: { ...S.row, marginBottom: 4 } },
        h('input', { type: 'checkbox', checked: Boolean(draft.agent_traffic_binding), onChange: (event) => set('agent_traffic_binding', event.target.checked) }),
        h('span', null, 'agent_traffic_binding（自动绑定证据）'),
      ),
      h('label', { style: { ...S.row, marginBottom: 4 } },
        h('input', { type: 'checkbox', checked: Boolean(draft.llm_record), onChange: (event) => set('llm_record', event.target.checked) }),
        h('span', null, 'llm_record（记录 LLM 请求）'),
      ),
    ),
    h('div', { style: S.card },
      h('div', { style: { fontWeight: 600, marginBottom: 6 } }, 'Agents'),
      h('label', { style: { ...S.row, marginBottom: 4 } },
        h('input', { type: 'checkbox', checked: Boolean(draft.constraints_inject_planner), onChange: (event) => set('constraints_inject_planner', event.target.checked) }),
        h('span', null, 'planner 注入 operation constraints'),
      ),
      h('label', { style: { ...S.row, marginBottom: 4 } },
        h('input', { type: 'checkbox', checked: Boolean(draft.constraints_inject_worker), onChange: (event) => set('constraints_inject_worker', event.target.checked) }),
        h('span', null, 'worker 注入 operation constraints'),
      ),
      h('label', { style: { ...S.row, marginBottom: 4 } },
        h('input', { type: 'checkbox', checked: Boolean(draft.noa_compaction), onChange: (event) => set('noa_compaction', event.target.checked) }),
        h('span', null, 'noa compaction（实验）'),
      ),
      h('label', { style: { ...S.row } },
        h('input', { type: 'checkbox', checked: Boolean(draft.notify_enabled), onChange: (event) => set('notify_enabled', event.target.checked) }),
        h('span', null, 'notify_enabled'),
      ),
    ),
    h('button', { style: S.primary, onClick: save, disabled: busy }, busy ? '保存中…' : '保存 ARTEX 设置'),
  )
}

function System() {
  const [view, setView] = useState('mcp')
  const views = [
    ['mcp', 'MCP'],
    ['tools', 'Tools'],
    ['skills', 'Skills'],
    ['agents', 'Agents'],
    ['notify', 'Notify'],
    ['logs', 'Logs'],
    ['workspace', 'Workspace'],
    ['settings', 'Settings'],
  ]
  return h('div', null,
    h('div', { style: { ...S.row, marginBottom: 8 } },
      views.map(([id, label]) => h('button', {
        key: id,
        style: { ...S.tab, ...(view === id ? S.tabActive : {}) },
        onClick: () => setView(id),
      }, label)),
    ),
    view === 'mcp'
      ? h(SystemMCP)
      : view === 'tools'
        ? h(SystemTools)
        : view === 'skills'
        ? h(SystemSkills)
        : view === 'agents'
          ? h(SystemAgents)
          : view === 'notify'
            ? h(SystemNotify)
            : view === 'logs'
              ? h(SystemLogs)
              : view === 'workspace'
                ? h(SystemWorkspace)
                : h(SystemSettings),
  )
}

// ---------------------------------------------------------------------------
// Assets / coverage
// ---------------------------------------------------------------------------
const ASSET_TYPES = ['', 'root_domain', 'subdomain', 'ip', 'service', 'app', 'endpoint']
const assetLabel = (asset) => {
  if (!asset) return '?'
  if (asset.type === 'endpoint' || asset.type === 'service') {
    return asset.url || asset.service_name || asset.domain || `#${asset.id ?? '?'}`
  }
  return asset.domain || asset.root_domain || asset.ip || asset.url
    || asset.app_name || asset.bundle_id || `#${asset.id ?? '?'}`
}

function Assets() {
  const tasks = usePoll('/tasks', 10_000)
  const [taskId, setTaskId] = useState('')
  const [type, setType] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 100
  const taskList = tasks.data?.tasks || []

  useEffect(() => {
    if (taskList.length === 0) {
      if (taskId) setTaskId('')
      return
    }
    if (!taskList.some((task) => task.id === taskId)) {
      const preferred = taskList.find((task) => ['running', 'done'].includes(task.status)) || taskList[0]
      setTaskId(preferred.id)
    }
  }, [tasks.data, taskId])

  useEffect(() => { setOffset(0) }, [taskId, type])

  const assets = usePoll(
    `/assets?task_id=${encodeURIComponent(taskId || '')}&type=${encodeURIComponent(type)}&limit=${limit}&offset=${offset}`,
    10_000,
    Boolean(taskId),
  )
  const coverage = usePoll(`/coverage?task=${encodeURIComponent(taskId || '')}`, 15_000, Boolean(taskId))
  const rows = assets.data?.assets || []
  const total = Number(assets.data?.total || 0)
  const cov = coverage.data || null

  return h('div', null,
    h('div', { style: { ...S.row, marginBottom: 8 } },
      h('span', { style: S.muted }, '任务'),
      h('select', {
        value: taskId,
        onChange: (event) => setTaskId(event.target.value),
        style: { ...S.input, width: 240, flex: '0 0 auto' },
      }, taskList.map((task) => h('option', { key: task.id, value: task.id },
        `${task.id} · ${task.name || task.goal.slice(0, 36)} (${task.status})`))),
      h('select', {
        value: type,
        onChange: (event) => setType(event.target.value),
        style: { ...S.input, width: 140, flex: '0 0 auto' },
      }, ASSET_TYPES.map((value) => h('option', { key: value || 'all', value }, value || 'all types'))),
      h('button', { style: S.button, onClick: () => { assets.refresh(); coverage.refresh() } }, '刷新'),
      h('span', { style: { flex: 1 } }),
      h('span', { style: { ...S.muted, fontSize: 11 } }, `${total} assets`),
    ),
    assets.error ? h('div', { style: S.error }, assets.error) : null,
    !taskId
      ? h('div', { style: S.muted }, '先选择一个任务。')
      : cov
        ? h('div', { style: { ...S.card, marginBottom: 8 } },
            h('div', { style: { fontWeight: 600, marginBottom: 4 } }, 'Coverage'),
            cov.enabled
              ? h('div', { style: S.row },
                  h(Badge, null, `${cov.tested}/${cov.denominator} tested`),
                  h(Badge, null, `${cov.pct === null || cov.pct === undefined ? '—' : Math.round(cov.pct * 100) + '%'}`),
                  h(Badge, null, `scope rows ${cov.scope_rows}`),
                )
              : h('div', { style: S.muted }, '该任务未启用 asset coverage。'),
            cov.enabled && cov.by_type?.length
              ? h('div', { style: { ...S.muted, marginTop: 4, fontSize: 11 } },
                  cov.by_type.map((item) => `${item.type} ${item.tested}/${item.total}`).join(' · '))
              : null,
          )
        : null,
    rows.length === 0
      ? h('div', { style: S.muted }, assets.loading ? '加载资产…' : '没有匹配的资产。这不是错误。')
      : h('div', { style: { overflowX: 'auto' } },
          h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
            h('thead', null, h('tr', null, ['类型', '资产', '端口/状态', '任务', '额外'].map((label) => h('th', {
              key: label,
              style: {
                textAlign: 'left',
                padding: '4px 6px',
                borderBottom: '1px solid var(--dsw-alias-border-l1, #e5e7eb)',
                color: 'var(--dsw-alias-label-tertiary, #6e7781)',
                fontWeight: 500,
              },
            }, label)))),
            h('tbody', null, rows.map((asset) => h('tr', {
              key: asset.id,
              style: { borderBottom: '1px solid var(--dsw-alias-border-l1, #e5e7eb)' },
            },
              h('td', { style: { padding: '4px 6px' } }, asset.type),
              h('td', { style: { padding: '4px 6px', wordBreak: 'break-all' } }, assetLabel(asset)),
              h('td', { style: { padding: '4px 6px' } }, [asset.port, asset.status_code].filter((v) => v !== undefined && v !== null && v !== '').join(' / ')),
              h('td', { style: { padding: '4px 6px' } }, (asset.task_ids || []).join(',')),
              h('td', { style: { padding: '4px 6px', ...S.muted } }, asset.service_name || asset.page_title || asset.record_type || ''),
            ))),
          ),
        ),
    h('div', { style: { ...S.row, marginTop: 8 } },
      h('button', { style: S.button, disabled: offset === 0, onClick: () => setOffset(Math.max(0, offset - limit)) }, '上一页'),
      h('span', { style: S.muted }, `${Math.floor(offset / limit) + 1} 页`),
      h('button', { style: S.button, disabled: offset + limit >= total, onClick: () => setOffset(offset + limit) }, '下一页'),
    ),
  )
}

// ---------------------------------------------------------------------------
// Exploration graph (dual-graph: goals/intents/facts/findings)
// ---------------------------------------------------------------------------
const NODE_COLORS = {
  begin: '#2da44e',
  goal: '#8250df',
  intent: '#0969da',
  hint: '#bf8700',
  fact: '#6e7781',
  digest: '#1b7c83',
  finding: '#cf222e',
}
const EDGE_COLORS = {
  spawns: '#8250df',
  derived_from: '#8c959f',
  yields: '#0969da',
  proves: '#cf222e',
  covers: '#2da44e',
}
const shortText = (text, max = 28) => {
  const value = String(text || '')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function Graph() {
  const tasks = usePoll('/tasks', 10_000)
  const [taskId, setTaskId] = useState('')
  const [selected, setSelected] = useState('')
  const taskList = tasks.data?.tasks || []

  useEffect(() => {
    if (taskList.length === 0) {
      if (taskId) setTaskId('')
      return
    }
    if (!taskList.some((task) => task.id === taskId)) {
      const preferred = taskList.find((task) => ['running', 'done'].includes(task.status)) || taskList[0]
      setTaskId(preferred.id)
    }
  }, [tasks.data, taskId])

  useEffect(() => {
    setSelected('')
  }, [taskId])

  const graph = usePoll(`/graph?task=${encodeURIComponent(taskId || '')}`, 15_000, Boolean(taskId))
  const layout = useMemo(
    () => layoutGraph(graph.data?.nodes, graph.data?.edges),
    [graph.data],
  )
  const selectedNode = selected ? layout.byId.get(selected) : null
  const selectedPayload = selectedNode ? payloadOf(selectedNode) : {}

  return h('div', null,
    h('div', { style: { ...S.row, marginBottom: 8 } },
      h('span', { style: S.muted }, '任务'),
      h('select', {
        value: taskId,
        onChange: (event) => setTaskId(event.target.value),
        style: { ...S.input, width: 260, flex: '0 0 auto' },
      },
        taskList.map((task) => h('option', { key: task.id, value: task.id },
          `${task.id} · ${task.name || task.goal.slice(0, 40)} (${task.status})`)),
      ),
      h('button', { style: S.button, onClick: graph.refresh, disabled: !taskId }, '刷新图'),
      h('span', { style: { flex: 1 } }),
      h('span', { style: { ...S.muted, fontSize: 11 } },
        `${layout.nodes.length} nodes · ${layout.edges.length} edges`),
    ),
    tasks.error ? h('div', { style: S.error }, tasks.error) : null,
    graph.error ? h('div', { style: S.error }, graph.error) : null,
    !taskId
      ? h('div', { style: S.muted }, '还没有任务；先创建一个任务再查看探索图。')
      : layout.nodes.length === 0
        ? h('div', { style: S.muted }, graph.loading ? '加载探索图…' : '该任务还没有探索图节点。')
        : h('div', null,
            h('div', { style: { ...S.row, marginBottom: 6, gap: 10, fontSize: 11 } },
              Object.entries(NODE_COLORS).map(([type, color]) => h('span', { key: type, style: { ...S.row, gap: 4 } },
                h('span', { style: { width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block' } }),
                h('span', { style: S.muted }, type),
              )),
            ),
            h('div', {
              style: {
                overflow: 'auto',
                border: '1px solid var(--dsw-alias-border-l1, #e5e7eb)',
                borderRadius: 8,
                background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
              },
            },
              h('svg', {
                viewBox: `0 0 ${layout.width} ${layout.height}`,
                style: { width: '100%', minWidth: 720, height: 'auto', display: 'block' },
                role: 'img',
                'aria-label': 'ARTEX exploration graph',
              },
                h('defs', null,
                  h('marker', {
                    id: 'artex-arrow',
                    viewBox: '0 0 8 8',
                    refX: 8,
                    refY: 4,
                    markerWidth: 6,
                    markerHeight: 6,
                    orient: 'auto',
                  }, h('path', { d: 'M0,0 L8,4 L0,8 z', fill: 'var(--dsw-alias-label-tertiary, #6e7781)' })),
                ),
                layout.edges.map((edge) => h('line', {
                  key: `${edge.src}-${edge.dst}-${edge.rel}`,
                  x1: edge.from.x,
                  y1: edge.from.y,
                  x2: edge.to.x,
                  y2: edge.to.y,
                  stroke: EDGE_COLORS[edge.rel] || 'var(--dsw-alias-border-l3, #8c959f)',
                  strokeWidth: 1.2,
                  opacity: 0.65,
                  markerEnd: 'url(#artex-arrow)',
                })),
                layout.nodes.map((node) => h('g', {
                  key: node.id,
                  onClick: () => setSelected(String(node.id)),
                  style: { cursor: 'pointer' },
                },
                  h('circle', {
                    cx: node.x,
                    cy: node.y,
                    r: selected === String(node.id) ? 11 : 8,
                    fill: NODE_COLORS[node.type] || '#8c959f',
                    stroke: selected === String(node.id) ? '#ffffff' : 'none',
                    strokeWidth: 2,
                  }),
                  h('text', {
                    x: node.layer >= 3 ? node.x - 13 : node.x + 13,
                    y: node.y + 4,
                    textAnchor: node.layer >= 3 ? 'end' : 'start',
                    fontSize: 10,
                    fill: 'var(--dsw-alias-label-primary, #1f2328)',
                  }, shortText(node.label, node.layer >= 3 ? 26 : 30)),
                )),
              ),
            ),
            selectedNode
              ? h('div', { style: { ...S.card, marginTop: 10 } },
                  h('div', { style: { ...S.row, marginBottom: 4 } },
                    h(Badge, null, selectedNode.type),
                    h(Badge, null, selectedNode.state || '?'),
                    h('strong', null, selectedNode.label || `node ${selectedNode.id}`),
                  ),
                  h('div', { style: { ...S.muted, fontSize: 11, marginBottom: 4 } },
                    `id ${selectedNode.id} · layer ${selectedNode.layer} · ${selectedNode.inherited ? 'inherited' : 'local'}`),
                  h('pre', { style: { ...S.pre, maxHeight: 260 } }, JSON.stringify(selectedPayload, null, 2)),
                  h('div', { style: { ...S.muted, fontSize: 11, marginTop: 4 } },
                    `edges: ${layout.edges.filter((edge) => String(edge.src) === String(selectedNode.id) || String(edge.dst) === String(selectedNode.id)).length}`),
                )
              : h('div', { style: { ...S.muted, marginTop: 6 } }, '点击节点查看 payload 与关联边。'),
          ),
  )
}

// ---------------------------------------------------------------------------
// Traffic (global capture; not task-scoped)
// ---------------------------------------------------------------------------
function Traffic() {
  const [host, setHost] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState({ host: '', q: '' })
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState('')
  const [captureBusy, setCaptureBusy] = useState(false)
  const [bindFinding, setBindFinding] = useState('')
  const [bindRole, setBindRole] = useState('proof')
  const [bindNote, setBindNote] = useState('')
  const [bindBusy, setBindBusy] = useState(false)
  const [bindNotice, setBindNotice] = useState('')
  const [bindError, setBindError] = useState('')
  const [purgeBusy, setPurgeBusy] = useState(false)
  const [purgeConfirm, setPurgeConfirm] = useState('')
  const [notice, setNotice] = useState('')
  const settings = usePoll('/settings', 30_000)
  const capture = Boolean(settings.data?.settings?.traffic_capture)

  useEffect(() => {
    setBindNotice('')
    setBindError('')
  }, [selected])

  const bind = async () => {
    if (!selected || !bindFinding.trim()) return
    setBindBusy(true)
    setBindNotice('')
    setBindError('')
    const { error: failure } = await run(() => api('/finding/bind', {
      body: {
        finding_id: bindFinding.trim(),
        refs: [{
          traffic_id: selected,
          role: bindRole,
          note: bindNote.trim() || 'bound from dsh-artex traffic view',
        }],
      },
    }))
    setBindBusy(false)
    if (failure) setBindError(failure)
    else {
      setBindNotice(`已绑定到 finding ${bindFinding.trim()}（${bindRole}）。`)
      setBindNote('')
    }
  }

  const purge = async (mode) => {
    const targetHost = (query.host || host).trim()
    if (mode === 'host' && !targetHost) {
      setError('先填写 host 过滤条件，或使用“清空全部”')
      return
    }
    if (purgeConfirm !== mode) {
      setPurgeConfirm(mode)
      setError(`再次点击确认${mode === 'all' ? '清空全部流量' : `删除 host 包含 "${targetHost}" 的流量`}`)
      return
    }
    setPurgeBusy(true)
    setError('')
    setNotice('')
    const { result, error: failure } = await run(() => api('/traffic/purge', {
      body: mode === 'all' ? { all: true, confirm: true } : { host: targetHost, confirm: true },
    }))
    setPurgeBusy(false)
    setPurgeConfirm('')
    if (failure) setError(failure)
    else {
      setNotice(`已删除 ${result?.data?.deleted ?? 0} 条流量`)
      load()
    }
  }

  const toggleCapture = async (enabled) => {
    setCaptureBusy(true)
    setError('')
    const { error: failure } = await run(() => api('/settings', { body: { traffic_capture: enabled } }))
    setCaptureBusy(false)
    if (failure) setError(failure)
    settings.refresh()
    load()
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        host: query.host,
        q: query.q,
        page: String(page),
        size: '50',
      })
      const next = await api(`/traffic?${params}`)
      setData(next)
      setError('')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setLoading(false)
    }
  }, [query.host, query.q, page])

  useEffect(() => { load() }, [load])

  const search = (event) => {
    event?.preventDefault?.()
    setPage(0)
    setQuery({ host: host.trim(), q: q.trim() })
  }

  const open = async (id) => {
    setSelected(id)
    setDetail(null)
    setDetailError('')
    try {
      setDetail(await api(`/exchange?id=${encodeURIComponent(id)}`))
    } catch (failure) {
      setDetailError(failure.message)
    }
  }

  const rows = data?.exchanges || []
  const total = Number(data?.total || 0)
  const size = Number(data?.size || 50)
  const hasNext = (page + 1) * size < total

  return h('div', null,
    h('form', { onSubmit: search, style: { ...S.row, marginBottom: 8 } },
      h('input', {
        value: host,
        onChange: (event) => setHost(event.target.value),
        placeholder: 'host 过滤（子串）',
        style: { ...S.input, width: 180, flex: '0 0 auto' },
      }),
      h('input', {
        value: q,
        onChange: (event) => setQ(event.target.value),
        placeholder: '全文/路径/请求体关键词',
        style: { ...S.input, flex: 1, minWidth: 180 },
      }),
      h('button', { type: 'submit', style: S.primary }, '搜索'),
      h('button', { type: 'button', style: S.button, onClick: load, disabled: loading }, loading ? '加载中…' : '刷新'),
      h('label', { style: { ...S.row, gap: 4, cursor: captureBusy ? 'wait' : 'pointer', fontSize: 12 } },
        h('input', {
          type: 'checkbox',
          checked: capture,
          disabled: captureBusy,
          onChange: (event) => toggleCapture(event.target.checked),
        }),
        h('span', null, captureBusy ? 'capture…' : 'capture'),
      ),
      h('button', { style: S.danger, onClick: () => purge('host'), disabled: purgeBusy }, purgeConfirm === 'host' ? '确认删除 host' : '删除 host'),
      h('button', { style: S.danger, onClick: () => purge('all'), disabled: purgeBusy }, purgeConfirm === 'all' ? '确认清空全部' : '清空全部'),
    ),
    notice ? h('div', { style: { ...S.muted, marginBottom: 6 } }, notice) : null,
    data
      ? h('div', { style: { ...S.muted, marginBottom: 6, fontSize: 11 } },
          `${capture ? 'capture 开启' : 'capture 关闭'} · proxy ${data.proxy || '-'} · 全局 ${data.count ?? 0} 条 · 匹配 ${data.total ?? 0} 条 · 第 ${(data.page ?? 0) + 1} 页`)
      : null,
    data?.enabled === false
      ? h('div', { style: { ...S.error, marginBottom: 6 } }, 'ARTEX traffic capture 关闭；请在 Console → System settings 打开 capture。')
      : null,
    error ? h('div', { style: { ...S.error, marginBottom: 6 } }, error) : null,
    rows.length === 0
      ? h('div', { style: S.muted }, loading ? '加载流量…' : '没有匹配的流量记录。这不是错误。')
      : h('div', { style: { overflowX: 'auto' } },
          h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
            h('thead', null,
              h('tr', null, ['时间', '方法', '状态', 'Host', 'URL', '大小'].map((label) => h('th', {
                key: label,
                style: {
                  textAlign: 'left',
                  padding: '4px 6px',
                  borderBottom: '1px solid var(--dsw-alias-border-l1, #e5e7eb)',
                  color: 'var(--dsw-alias-label-tertiary, #6e7781)',
                  fontWeight: 500,
                },
              }, label)))),
            h('tbody', null, rows.map((row) => h('tr', {
              key: row.id,
              onClick: () => open(row.id),
              style: {
                cursor: 'pointer',
                borderBottom: '1px solid var(--dsw-alias-border-l1, #e5e7eb)',
                background: selected === row.id ? 'var(--dsw-alias-bg-layer-2, #f3f4f6)' : 'transparent',
              },
            },
              h('td', { style: { padding: '4px 6px', whiteSpace: 'nowrap' } }, row.ts ? new Date(row.ts).toLocaleTimeString() : ''),
              h('td', { style: { padding: '4px 6px' } }, row.method),
              h('td', {
                style: {
                  padding: '4px 6px',
                  color: Number(row.status) >= 400 ? 'var(--dsw-alias-label-error, #cf222e)' : undefined,
                },
              }, row.status || ''),
              h('td', { style: { padding: '4px 6px' } }, row.host),
              h('td', { style: { padding: '4px 6px', wordBreak: 'break-all' } }, row.url),
              h('td', { style: { padding: '4px 6px', whiteSpace: 'nowrap' } }, row.resp_len),
            ))),
          ),
        ),
    h('div', { style: { ...S.row, marginTop: 8 } },
      h('button', {
        style: S.button,
        disabled: page === 0 || loading,
        onClick: () => setPage((value) => Math.max(0, value - 1)),
      }, '上一页'),
      h('span', { style: S.muted }, `第 ${page + 1} 页`),
      h('button', {
        style: S.button,
        disabled: !hasNext || loading,
        onClick: () => setPage((value) => value + 1),
      }, '下一页'),
    ),
    detailError ? h('div', { style: { ...S.error, marginTop: 8 } }, detailError) : null,
    detail
      ? h('div', { style: { ...S.card, marginTop: 10 } },
          h('div', { style: { fontWeight: 600, marginBottom: 4 } }, `Exchange ${selected}`),
          h('div', { style: { ...S.muted, marginBottom: 2 } }, '请求'),
          h('pre', { style: { ...S.pre, maxHeight: 260 } }, detail.req || ''),
          h('div', { style: { ...S.muted, marginTop: 6, marginBottom: 2 } }, '响应'),
          h('pre', { style: { ...S.pre, maxHeight: 360 } }, detail.resp || ''),
          h('div', { style: { ...S.card, marginTop: 8, background: 'transparent' } },
            h('div', { style: { fontWeight: 600, marginBottom: 2 } }, '绑定为 finding 证据'),
            h('div', { style: { ...S.muted, marginBottom: 6, fontSize: 11 } },
              '流量是全局的；finding id 来自 Tasks → Findings。'),
            h('div', { style: S.row },
              h('input', {
                value: bindFinding,
                onChange: (event) => setBindFinding(event.target.value),
                placeholder: 'finding id',
                style: { ...S.input, width: 110, flex: '0 0 auto' },
              }),
              h('select', {
                value: bindRole,
                onChange: (event) => setBindRole(event.target.value),
                style: { ...S.input, width: 150, flex: '0 0 auto' },
              },
                h('option', { value: 'proof' }, 'proof'),
                h('option', { value: 'verification' }, 'verification'),
                h('option', { value: 'baseline' }, 'baseline'),
                h('option', { value: 'supporting' }, 'supporting'),
              ),
              h('input', {
                value: bindNote,
                onChange: (event) => setBindNote(event.target.value),
                placeholder: 'note（可选）',
                style: { ...S.input, flex: 1, minWidth: 160 },
              }),
              h('button', {
                style: S.primary,
                onClick: bind,
                disabled: bindBusy || !bindFinding.trim(),
              }, bindBusy ? '绑定中…' : '绑定'),
            ),
            bindNotice ? h('div', { style: { ...S.muted, marginTop: 4 } }, bindNotice) : null,
            bindError ? h('div', { style: { ...S.error, marginTop: 4 } }, bindError) : null,
          ),
        )
      : null,
  )
}

function PendingToast({ openPanel }) {
  const count = usePendingBadge()
  const [dismissed, setDismissed] = useState(0)
  if (!count || dismissed >= count) return null
  return h('div', {
    role: 'status',
    style: {
      position: 'fixed',
      right: 18,
      bottom: 18,
      zIndex: 50,
      maxWidth: 320,
      padding: '10px 12px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-label-error, #cf222e)',
      background: 'var(--dsw-alias-bg-overlay, #ffffff)',
      color: 'var(--dsw-alias-label-primary, #1f2328)',
      boxShadow: '0 6px 24px rgba(0,0,0,.18)',
      fontSize: 12,
    },
  },
    h('div', { style: { fontWeight: 600, marginBottom: 4 } }, `ARTEX 有 ${count} 条待审批`),
    h('div', { style: { ...S.muted, marginBottom: 8 } }, 'worker 正在等待审批；不处理会一直阻塞。'),
    h('div', { style: S.row },
      h('button', {
        style: S.primary,
        onClick: () => {
          setPanelTab('approvals')
          openPanel?.()
        },
      }, '去审批'),
      h('button', { style: S.button, onClick: () => setDismissed(count) }, '稍后'),
    ),
  )
}

// ---------------------------------------------------------------------------
// Panel shell
// ---------------------------------------------------------------------------
function Panel() {
  const tab = usePanelTab()
  const setTab = setPanelTab
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const config = usePoll('/config', 30_000)
  const health = usePoll('/health', 5_000)
  const pendingBadge = usePendingBadge()

  const start = useCallback(async () => {
    setStarting(true)
    setStartError('')
    const { error } = await run(() => api('/start', { body: {} }))
    if (error) setStartError(error)
    setStarting(false)
    config.refresh()
    health.refresh()
  }, [config, health])

  const tabs = [
    ['console', 'Console'],
    ['tasks', 'Tasks'],
    ['chat', 'Chat'],
    ['graph', 'Graph'],
    ['assets', 'Assets'],
    ['llm', 'LLM'],
    ['system', 'System'],
    ['traffic', 'Traffic'],
    ['approvals', pendingBadge > 0 ? `Approvals (${pendingBadge})` : 'Approvals'],
  ]

  return h('div', { style: S.root },
    h('div', { style: S.tabbar },
      tabs.map(([id, label]) => h('button', {
        key: id,
        style: { ...S.tab, ...(tab === id ? S.tabActive : {}) },
        onClick: () => setTab(id),
      }, label)),
      h('span', { style: { flex: 1 } }),
      h('span', { style: S.muted },
        health.data?.artex?.ok
          ? `● ${health.data.artex.version || 'online'}${health.data.pending ? ` · ${health.data.pending} pending` : ''}`
          : health.loading ? '…' : '○ offline'),
    ),
    h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
      tab === 'console'
        ? h(Console, {
            config: config.data,
            health: health.data,
            onStart: start,
            starting,
            startError,
          })
        : h('div', { style: S.body },
            tab === 'tasks'
              ? h(Tasks, { health: health.data, onStart: start, starting })
              : tab === 'chat'
                ? h(Chat)
                : tab === 'graph'
                ? h(Graph)
                : tab === 'assets'
                  ? h(Assets)
                  : tab === 'llm'
                    ? h(LLM)
                    : tab === 'system'
                      ? h(System)
                      : tab === 'traffic'
                    ? h(Traffic)
                    : h(Approvals, { health: health.data, onStart: start, starting }),
          ),
    ),
  )
}

function ArtexIcon(props) {
  return h('svg', {
    width: props?.size || 24,
    height: props?.size || 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true,
  },
    h('path', {
      d: 'M12 3l7 3v5c0 4.4-2.9 8.2-7 10-4.1-1.8-7-5.6-7-10V6l7-3z',
      stroke: 'currentColor',
      'stroke-width': 1.6,
      'stroke-linejoin': 'round',
    }),
    h('path', {
      d: 'M9 12.2l2.1 2.1L15.4 10',
      stroke: 'currentColor',
      'stroke-width': 1.7,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  )
}

function PendingCount() {
  const count = usePendingBadge()
  if (!count) return null
  return h('span', { style: { fontSize: 10, fontWeight: 700, color: 'var(--dsw-alias-label-error, #cf222e)' } }, String(count))
}

function apply(ctx) {
  // Sidebar badge: poll pending approvals once, independent of the open tab.
  ctx.effect(() => {
    let alive = true
    let timer = null
    const poll = async () => {
      try {
        const data = await api('/pending')
        if (alive) setPendingBadge((data.pending || []).length)
      } catch {
        if (alive) setPendingBadge(0)
      }
    }
    poll()
    timer = setInterval(poll, 3_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, 'dsh-artex: approval badge')

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => 'ARTEX' },
    ArtexIcon,
  ))

  ctx.slots.inject('sidebar.panellist.trailing', () => ctx.slots.register(
    { name: 'sidebar.panellist.trailing', id: PANEL_ID },
    PendingCount,
  ))

  ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: PANEL_ID },
    Panel,
  ))

  ctx.slots.inject('plugins.row.config', () => ctx.slots.register(
    { name: 'plugins.row.config', key: 'dsh-artex#artex' },
    ArtexSettings,
  ))

  const openArtexPanel = () => {
    try { ctx.get('layout')?.selectPanel?.(PANEL_ID) } catch {}
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'artex-approvals' },
    () => h(PendingToast, { openPanel: openArtexPanel }),
  ))
}

exports.isPlugin = true
exports.inject = ['slots']
exports.apply = apply
