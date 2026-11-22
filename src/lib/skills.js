// Bundled skill provider: exposes skills/artex-pentest to the DSH model.
// A user-installed skill with the same name wins because this provider ranks
// after user sources.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true }

function parse(file) {
  const text = readFileSync(file, 'utf8')
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return null
  const field = (key) => (match[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || [])[1]
    ?.trim()
    .replace(/^(["'])(.*)\1$/, '$2')
  const name = field('name')
  const description = field('description')
  return name && description ? { name, description, body: text.slice(match[0].length) } : null
}

export function readSkills(dirs) {
  return [].concat(dirs).flatMap((dir) => {
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')))
      .map((entry) => ({
        dir: join(dir, entry.name),
        file: join(dir, entry.name, 'SKILL.md'),
        ...parse(join(dir, entry.name, 'SKILL.md')),
      }))
      .filter((skill) => skill.name)
  })
}

function addendum(skill) {
  return [
    '',
    '---',
    '',
    '## 在 dsh-artex 插件（DSH）里使用',
    '',
    `- 本 skill 的目录是 \`${skill.dir}\`；这是插件随包快照，不要尝试更新或从网络重装。`,
    '- ARTEX 平台由 dsh-artex 插件托管：先用 `artex_status` 看状态；需要时 `artex_status action=start`。',
    '- 模型侧入口是 `artex_task` / `artex_observe` / `artex_wait` / `artex_findings` / `artex_approval` / `artex_chat`。',
    '- 用户侧入口是 DSH 侧栏的 ARTEX 面板：Console（完整 ARTEX UI）、Tasks、Approvals。',
    '- ARTEX 的数据在它自己的 Docker 卷里（data / keys / pgdata），不在 `$DSH_HOME`；卸载插件不会删除。',
    '',
  ].join('\n')
}

export function createSkillProvider(dirs, pluginRoot) {
  const candidate = (skill) => ({
    name: skill.name,
    description: skill.description,
    path: skill.file,
    invocation: INVOCATION,
    source: 'bundled',
    provider: 'dsh-artex',
    rank: RANK,
    locator: skill.dir,
    resourceBase: { kind: 'directory', path: skill.dir },
  })

  return {
    name: 'dsh-artex',
    async list() {
      return readSkills(dirs).map(candidate)
    },
    async get(found) {
      const skill = readSkills(dirs).find((item) => item.dir === found.locator && item.name === found.name)
      if (!skill) return undefined
      const content = skill.body
        .replaceAll('<SKILL_ROOT>', skill.dir)
        .replaceAll('<PLUGIN_ROOT>', pluginRoot) + addendum(skill)
      const { rank, locator, ...summary } = candidate(skill)
      return { ...summary, content }
    },
  }
}
