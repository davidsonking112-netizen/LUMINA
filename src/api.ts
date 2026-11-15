import type { AuditEvent, ForgeTask, MemoryEntry, Plan } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
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
