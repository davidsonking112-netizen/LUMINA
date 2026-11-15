export type StepStatus = 'pending' | 'approved' | 'done' | 'denied'

export interface PlanStep {
  id: string
  title: string
  detail: string
  kind: 'create_task'
  taskTitle: string
  status: StepStatus
  actionHash: string
  approvalId?: string
  expiresAt?: string
  resultTaskId?: string
}

export interface Plan {
  id: string
  request: string
  generationMode: 'local_parser' | 'ai'
  status: 'draft' | 'in_progress' | 'completed'
  createdAt: string
  updatedAt: string
  steps: PlanStep[]
}

export interface ForgeTask {
  id: string
  title: string
  createdAt: string
  sourcePlanId: string
  sourceStepId: string
}

export interface MemoryEntry {
  id: string
  title: string
  content: string
  source: 'owner'
  createdAt: string
  updatedAt: string
}

export interface AuditEvent {
  id: string
  occurredAt: string
  eventType: string
  entityType: string
  entityId: string
  summary: string
  context?: string
  detailsRemoved?: boolean
}
