export type StepStatus = 'pending' | 'approved' | 'active' | 'done' | 'denied' | 'failed'
export type PermissionMode = 'suggest' | 'approve' | 'automatic'
export type ActionKind = 'create_task' | 'send_email' | 'calendar_change' | 'file_operation' | 'publish_content' | 'record_update' | 'web_research' | 'document_transform'
export type RiskLevel = 'low' | 'medium' | 'high'

export interface AssistantOutput {
  status: 'generated' | 'unavailable'
  answer: string
  deliverables?: Array<{ title: string; content: string }>
  generatedAt?: string
}

export interface PlanStep {
  id: string
  title: string
  detail: string
  kind: ActionKind
  taskTitle: string
  status: StepStatus
  actionHash: string
  approvalId?: string
  expiresAt?: string
  resultTaskId?: string
  tool?: string
  riskLevel?: RiskLevel
  requiresApproval?: boolean
  dependsOn?: string[]
  provenance?: 'user_request_parser' | 'model_suggestion'
  expectedResult?: string
  checkpoint?: string
  output?: string
  startedAt?: string
  completedAt?: string
  error?: string
}

export interface Plan {
  id: string
  request: string
  generationMode: 'local_parser' | 'ai'
  status: 'draft' | 'in_progress' | 'running' | 'completed' | 'failed'
  createdAt: string
  updatedAt: string
  steps: PlanStep[]
  assistantOutput?: AssistantOutput
  assumptions?: string[]
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
  category?: 'preference' | 'contact' | 'routine' | 'goal' | 'document' | 'decision' | 'context'
  createdAt: string
  updatedAt: string
}

export interface Automation {
  id: string
  name: string
  description: string
  trigger: string
  schedule?: string
  permissionMode: PermissionMode
  enabled: boolean
  lastRunAt?: string
  nextRunAt?: string
  actionSummary: string
}

export interface DocumentAsset {
  id: string
  name: string
  type: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'audio' | 'csv' | 'text'
  size: string
  status: 'ready' | 'processing' | 'needs_attention'
  updatedAt: string
  capabilities: string[]
}

export interface ResearchSource {
  id: string
  title: string
  url: string
  publisher: string
  accessedAt: string
  excerpt: string
  confidence: 'high' | 'medium' | 'low'
}

export interface ResearchReport {
  id: string
  question: string
  answer: string
  sources: ResearchSource[]
  assumptions: string[]
  createdAt: string
}

export interface Connector {
  id: string
  name: string
  category: string
  description: string
  status: 'available' | 'connected' | 'coming_soon'
  scopes: string[]
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
  tool?: string
  filesAccessed?: string[]
  requiresAttention?: boolean
}
