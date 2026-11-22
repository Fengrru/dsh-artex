// DSH tool gate policy for high-impact ARTEX actions.
//
// Returning an `ask` decision routes the call through DSH's approval UI; the
// tool body never runs until a human allows it. Pure and testable.

import { cv } from './config.js'

const CREATE_REASON = {
  en: 'Creating an ARTEX task starts an authorized penetration-test run against the declared scope.',
  zh: '创建 ARTEX 任务会按已声明的 scope 启动一次授权渗透测试。',
}

const RETEST_REASON = {
  en: 'Starting an ARTEX finding retest runs the retester agent and calls the LLM again.',
  zh: '启动 finding 复测会运行 retester agent 并再次调用 LLM。',
}

const START_REASON = {
  en: 'Starting the managed ARTEX runtime launches a local service and may build a Docker image.',
  zh: '启动 ARTEX 托管运行时会在本机启动服务，并可能构建 Docker 镜像。',
}

export function toolGateDecision(config, exec) {
  const name = exec?.name
  const args = exec?.arguments
  if (!name || !args || typeof args !== 'object') return null

  if (name === 'artex_task' && args.action === 'create' && cv(config.confirmTaskCreation, true)) {
    return {
      kind: 'ask',
      reason: 'Confirm the ARTEX task creation and its declared scope.',
      displayReason: CREATE_REASON,
    }
  }
  if (name === 'artex_findings' && args.action === 'retest' && cv(config.confirmRetest, true)) {
    return {
      kind: 'ask',
      reason: 'Confirm the ARTEX finding retest.',
      displayReason: RETEST_REASON,
    }
  }
  if (name === 'artex_status' && args.action === 'start' && cv(config.confirmRuntimeStart, false)) {
    return {
      kind: 'ask',
      reason: 'Confirm starting the managed ARTEX runtime.',
      displayReason: START_REASON,
    }
  }
  return null
}
