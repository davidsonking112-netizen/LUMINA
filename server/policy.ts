import type { ActionKind, PermissionMode, RiskLevel } from '../src/types.js'

export interface RegisteredAction {
  supported: boolean
  riskLevel: RiskLevel
  requiresApproval: boolean
  automaticEligible: boolean
  tool: string
}

export const actionRegistry: Readonly<Record<ActionKind, RegisteredAction>> = Object.freeze({
  create_task: { supported: true, riskLevel: 'low', requiresApproval: true, automaticEligible: true, tool: 'Local task list' },
  send_email: { supported: false, riskLevel: 'high', requiresApproval: true, automaticEligible: false, tool: 'Email' },
  calendar_change: { supported: false, riskLevel: 'high', requiresApproval: true, automaticEligible: false, tool: 'Calendar' },
  file_operation: { supported: false, riskLevel: 'high', requiresApproval: true, automaticEligible: false, tool: 'Local files' },
  publish_content: { supported: false, riskLevel: 'high', requiresApproval: true, automaticEligible: false, tool: 'Publishing' },
  record_update: { supported: false, riskLevel: 'high', requiresApproval: true, automaticEligible: false, tool: 'External records' },
  web_research: { supported: false, riskLevel: 'medium', requiresApproval: true, automaticEligible: false, tool: 'Web research' },
  document_transform: { supported: false, riskLevel: 'medium', requiresApproval: true, automaticEligible: false, tool: 'Document tools' },
})

export function registeredAction(kind: string): RegisteredAction | undefined {
  return Object.prototype.hasOwnProperty.call(actionRegistry, kind) ? actionRegistry[kind as ActionKind] : undefined
}

export function actionMayRun(kind: string, mode: PermissionMode, automatic = false) {
  const policy = registeredAction(kind)
  if (!policy?.supported || mode === 'suggest') return false
  if (!automatic) return true
  return mode === 'automatic' && policy.automaticEligible && policy.riskLevel === 'low'
}
