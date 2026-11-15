import type { AuditEvent, Automation, Connector, DocumentAsset, ForgeTask, MemoryEntry, Plan, ResearchReport } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Forge-Request': '1', ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed (${response.status}).`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  health: () => request<{ ok: boolean; mode: string }>('/api/health'),
  exportWorkspace: () => request<Record<string, unknown>>('/api/export'),
  clearWorkspace: () => request<void>('/api/data', { method: 'DELETE' }),
  tasks: () => request<ForgeTask[]>('/api/tasks'),
  plans: () => request<Plan[]>('/api/plans'),
  activity: () => request<AuditEvent[]>('/api/activity'),
  memories: () => request<MemoryEntry[]>('/api/memories'),
  capabilities: () => request<{ permissionModes: Array<{ id: string; label: string; description: string }>; inputModes: string[]; actionKinds: string[] }>('/api/capabilities'),
  automations: () => request<Automation[]>('/api/automations'),
  toggleAutomation: (id: string, enabled: boolean) => request<Automation>(`/api/automations/${id}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  documents: () => request<DocumentAsset[]>('/api/documents'),
  connectors: () => request<Connector[]>('/api/connectors'),
  research: (question: string) => request<ResearchReport>('/api/research', { method: 'POST', body: JSON.stringify({ question }) }),
  draftPlan: (text: string) => request<Plan>('/api/plans', { method: 'POST', body: JSON.stringify({ request: text }) }),
  updatePlan: (id: string, steps: Array<{ id: string; taskTitle: string }>) => request<Plan>(`/api/plans/${id}`, { method: 'PUT', body: JSON.stringify({ steps }) }),
  deletePlan: (id: string) => request<void>(`/api/plans/${id}`, { method: 'DELETE' }),
  approve: (planId: string, stepId: string) => request<Plan>(`/api/plans/${planId}/steps/${stepId}/approve`, { method: 'POST' }),
  deny: (planId: string, stepId: string) => request<Plan>(`/api/plans/${planId}/steps/${stepId}/deny`, { method: 'POST' }),
  execute: (planId: string, stepId: string) => request<{ plan: Plan; taskId?: string; replayed?: boolean; approvalReset?: boolean }>(`/api/plans/${planId}/steps/${stepId}/execute`, { method: 'POST' }),
  deleteTask: (id: string) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
  createMemory: (title: string, content: string) => request<MemoryEntry>('/api/memories', { method: 'POST', body: JSON.stringify({ title, content }) }),
  updateMemory: (id: string, title: string, content: string) => request<MemoryEntry>(`/api/memories/${id}`, { method: 'PUT', body: JSON.stringify({ title, content }) }),
  deleteMemory: (id: string) => request<void>(`/api/memories/${id}`, { method: 'DELETE' }),
}
