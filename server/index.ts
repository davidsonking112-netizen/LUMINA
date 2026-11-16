import express from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { db, recordAudit } from './db.js'
import { actionHash, draftPlan } from './plan.js'
import type { AuditEvent, Connector, ForgeTask, MemoryEntry, Plan, PlanStep } from '../src/types.js'

const app = express()
const APPROVAL_TTL_MS = 10 * 60 * 1000
app.disable('x-powered-by')

const port = process.env.PORT ?? '8787'
const allowedHosts = new Set((process.env.FORGE_ALLOWED_HOSTS ?? `127.0.0.1:${port},localhost:${port}`)
  .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))
const allowedOrigins = new Set((process.env.FORGE_ALLOWED_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173')
  .split(',').map((value) => value.trim()).filter(Boolean))
const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

app.use('/api', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'no-store')
  const host = req.get('host')?.toLowerCase()
  if (!host || !allowedHosts.has(host)) return jsonError(res, 403, 'This host is not allowed to access Forge.')

  const origin = req.get('origin')
  if (origin && !allowedOrigins.has(origin)) return jsonError(res, 403, 'This origin is not allowed to access Forge.')
  if (!mutationMethods.has(req.method)) return next()
  if (!origin || !allowedOrigins.has(origin)) return jsonError(res, 403, 'A trusted same-origin request is required.')

  const fetchSite = req.get('sec-fetch-site')
  if (fetchSite !== 'same-origin') {
    return jsonError(res, 403, 'Cross-origin requests cannot change Forge data.')
  }
  if (req.get('x-forge-request') !== '1') return jsonError(res, 403, 'The Forge request header is required.')
  const contentType = req.get('content-type')
  if (contentType && !/^application\/json(?:\s*;|$)/i.test(contentType)) return jsonError(res, 415, 'Forge API changes require a JSON request.')
  next()
})
app.use(express.json({ limit: '32kb' }))

const requestSchema = z.object({ request: z.string().trim().min(2).max(2000) })
const editSchema = z.object({ steps: z.array(z.object({ id: z.string().uuid(), taskTitle: z.string().trim().min(2).max(120) })).min(1).max(8) })
const memorySchema = z.object({ title: z.string().trim().min(2).max(80), content: z.string().trim().min(2).max(1200) })

function loadPlan(id: string): Plan | undefined {
  const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as { id: string; request: string; generation_mode: Plan['generationMode']; status: Plan['status']; created_at: string; updated_at: string; steps_json: string } | undefined
  if (!row) return undefined
  return { id: row.id, request: row.request, generationMode: row.generation_mode, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, steps: JSON.parse(row.steps_json) as PlanStep[] }
}

function savePlan(plan: Plan) {
  db.prepare(`INSERT INTO plans (id, request, generation_mode, status, created_at, updated_at, steps_json)
    VALUES (@id, @request, @generationMode, @status, @createdAt, @updatedAt, @steps)
    ON CONFLICT(id) DO UPDATE SET generation_mode = excluded.generation_mode, status = excluded.status, updated_at = excluded.updated_at, steps_json = excluded.steps_json`)
    .run({ id: plan.id, request: plan.request, generationMode: plan.generationMode, status: plan.status, createdAt: plan.createdAt, updatedAt: plan.updatedAt, steps: JSON.stringify(plan.steps) })
}

function jsonError(res: express.Response, status: number, message: string) {
  return res.status(status).json({ error: message })
}

function planStatusFor(steps: PlanStep[]): Plan['status'] {
  if (steps.some((step) => step.status === 'failed')) return 'failed'
  if (steps.every((step) => step.status === 'done' || step.status === 'denied')) return 'completed'
  if (steps.every((step) => step.status === 'pending' || step.status === 'denied')) return 'draft'
  if (steps.some((step) => step.status === 'active')) return 'running'
  return 'in_progress'
}

function dependenciesReady(plan: Plan, step: PlanStep) {
  return (step.dependsOn ?? []).every((dependencyId) => plan.steps.some((candidate) => candidate.id === dependencyId && (candidate.status === 'done' || candidate.status === 'denied')))
}

function resetApprovalForReview(plan: Plan, step: PlanStep, eventType: string, summary: string) {
  const now = new Date().toISOString()
  if (step.approvalId) db.prepare('UPDATE approvals SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, step.approvalId)
  step.status = 'pending'
  step.approvalId = undefined
  step.expiresAt = undefined
  plan.updatedAt = now
  plan.status = planStatusFor(plan.steps)
  savePlan(plan)
  recordAudit(eventType, 'plan_step', step.id, summary)
}

app.get('/api/health', (_req, res) => res.json({ ok: true, mode: 'local-prototype' }))

app.get('/api/capabilities', (_req, res) => res.json({
  permissionModes: [{ id: 'approve', label: 'Review every action', description: 'Each local task waits for explicit approval before it is added.' }],
  inputModes: ['text'],
  actionKinds: ['create_task'],
  streaming: false,
}))

app.get('/api/connectors', (_req, res) => {
  const connectors: Connector[] = [
    { id: 'local-files', name: 'Local files', category: 'Workspace', description: 'File access is not wired into this prototype.', status: 'coming_soon', scopes: [] },
    { id: 'web-research', name: 'Web research', category: 'Research', description: 'Live web retrieval is not wired into this prototype.', status: 'coming_soon', scopes: [] },
    { id: 'gmail', name: 'Gmail', category: 'Communication', description: 'Email access is not wired into this prototype.', status: 'coming_soon', scopes: [] },
    { id: 'calendar', name: 'Calendar', category: 'Planning', description: 'Calendar access is not wired into this prototype.', status: 'coming_soon', scopes: [] },
    { id: 'slack', name: 'Slack', category: 'Communication', description: 'Messaging access is not wired into this prototype.', status: 'coming_soon', scopes: [] },
  ]
  res.json(connectors)
})

app.get('/api/automations', (_req, res) => res.json([]))

app.post('/api/automations/:id/toggle', (_req, res) => jsonError(res, 501, 'Automations are not available in this prototype. No workflow was changed.'))

app.get('/api/documents', (_req, res) => res.json([]))

app.post('/api/research', (_req, res) => jsonError(res, 501, 'Live web research is not available in this prototype. No research report was created.'))

app.get('/api/tasks', (_req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as Array<{ id: string; title: string; created_at: string; source_plan_id: string; source_step_id: string }>
  res.json(tasks.map((row): ForgeTask => ({ id: row.id, title: row.title, createdAt: row.created_at, sourcePlanId: row.source_plan_id, sourceStepId: row.source_step_id })))
})

app.get('/api/plans', (_req, res) => {
  const rows = db.prepare('SELECT id FROM plans ORDER BY updated_at DESC').all() as Array<{ id: string }>
  res.json(rows.map((row) => loadPlan(row.id)).filter((plan): plan is Plan => Boolean(plan)))
})

app.get('/api/export', (_req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all()
  const planRows = db.prepare('SELECT id FROM plans ORDER BY created_at DESC').all() as Array<{ id: string }>
  const memories = db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all()
  const activity = db.prepare('SELECT * FROM audit_events ORDER BY occurred_at DESC').all()
  res.json({ formatVersion: 1, exportedAt: new Date().toISOString(), plans: planRows.map((row) => loadPlan(row.id)).filter(Boolean), tasks, memories, activity })
})

app.delete('/api/data', (_req, res) => {
  db.transaction(() => {
    db.prepare('DELETE FROM approvals').run()
    db.prepare('DELETE FROM tasks').run()
    db.prepare('DELETE FROM plans').run()
    db.prepare('DELETE FROM memories').run()
    db.prepare('DELETE FROM audit_events').run()
  })()
  res.status(204).end()
})

app.post('/api/plans', async (req, res) => {
  const parsed = requestSchema.safeParse(req.body)
  if (!parsed.success) return jsonError(res, 400, 'Enter a request between 2 and 2,000 characters.')
  let plan: Plan
  try {
    plan = await draftPlan(parsed.data.request)
  } catch {
    return jsonError(res, 502, 'Forge could not draft a plan with the configured model. Nothing was saved or executed.')
  }
  savePlan(plan)
  recordAudit('plan.created', 'plan', plan.id, 'Draft plan created; no action has run.')
  res.status(201).json(plan)
})

app.get('/api/plans/:id', (req, res) => {
  const plan = loadPlan(req.params.id)
  if (!plan) return jsonError(res, 404, 'Plan not found.')
  res.json(plan)
})

app.delete('/api/plans/:id', (req, res) => {
  const plan = loadPlan(req.params.id)
  if (!plan) return jsonError(res, 404, 'Plan not found.')
  db.transaction(() => {
    db.prepare('DELETE FROM tasks WHERE source_plan_id = ?').run(plan.id)
    db.prepare('DELETE FROM plans WHERE id = ?').run(plan.id)
    recordAudit('plan.deleted', 'plan', plan.id, 'Plan and associated local task records were deleted; request and task details were removed.')
  })()
  res.status(204).end()
})

app.put('/api/plans/:id', (req, res) => {
  const parsed = editSchema.safeParse(req.body)
  if (!parsed.success) return jsonError(res, 400, 'Plan edits need valid task titles.')
  const plan = loadPlan(req.params.id)
  if (!plan) return jsonError(res, 404, 'Plan not found.')
  const edits = new Map(parsed.data.steps.map((item) => [item.id, item.taskTitle]))
  if (parsed.data.steps.some((item) => !plan.steps.some((step) => step.id === item.id))) return jsonError(res, 400, 'This plan changed. Reload it before editing.')
  if (plan.steps.some((step) => step.status === 'done' && edits.has(step.id) && edits.get(step.id) !== step.taskTitle)) return jsonError(res, 409, 'A completed step cannot be changed.')
  const now = new Date().toISOString()
  plan.steps = plan.steps.map((step) => {
    const nextTitle = edits.get(step.id) ?? step.taskTitle
    const status: PlanStep['status'] = step.status === 'done' ? 'done' : 'pending'
    const updated: PlanStep = { ...step, taskTitle: nextTitle, title: `Add task: ${nextTitle}`, status, approvalId: undefined, expiresAt: undefined }
    updated.actionHash = actionHash(plan.id, updated)
    return updated
  })
  plan.updatedAt = now
  plan.status = planStatusFor(plan.steps)
  db.prepare('UPDATE approvals SET revoked_at = ? WHERE plan_id = ? AND revoked_at IS NULL').run(now, plan.id)
  savePlan(plan)
  recordAudit('plan.edited', 'plan', plan.id, 'Plan edited; earlier approvals were invalidated.')
  res.json(plan)
})

app.post('/api/plans/:id/steps/:stepId/approve', (req, res) => {
  const plan = loadPlan(req.params.id)
  if (!plan) return jsonError(res, 404, 'Plan not found.')
  const step = plan.steps.find((item) => item.id === req.params.stepId)
  if (!step) return jsonError(res, 404, 'Plan step not found.')
  if (step.kind !== 'create_task') return jsonError(res, 403, 'This action type is not connected in this prototype.')
  if (step.status === 'done') return jsonError(res, 409, 'This step has already been completed.')
  if (!dependenciesReady(plan, step)) return jsonError(res, 409, 'Complete the earlier step before approving this one.')
  if (step.actionHash !== actionHash(plan.id, step)) return jsonError(res, 409, 'The action changed. Review the updated details before approving it.')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS).toISOString()
  const approvalId = randomUUID()
  db.prepare('UPDATE approvals SET revoked_at = ? WHERE plan_id = ? AND step_id = ? AND revoked_at IS NULL').run(now.toISOString(), plan.id, step.id)
  db.prepare('INSERT INTO approvals (id, plan_id, step_id, action_hash, approved_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(approvalId, plan.id, step.id, step.actionHash, now.toISOString(), expiresAt)
  step.status = 'approved'
  step.approvalId = approvalId
  step.expiresAt = expiresAt
  plan.status = 'in_progress'
  plan.updatedAt = now.toISOString()
  savePlan(plan)
  recordAudit('action.approved', 'plan_step', step.id, 'Owner approved one exact local task-creation action; approval expires in 10 minutes.')
  res.json(plan)
})

app.post('/api/plans/:id/steps/:stepId/deny', (req, res) => {
  const plan = loadPlan(req.params.id)
  if (!plan) return jsonError(res, 404, 'Plan not found.')
  const step = plan.steps.find((item) => item.id === req.params.stepId)
  if (!step) return jsonError(res, 404, 'Plan step not found.')
  if (step.status === 'done') return jsonError(res, 409, 'A completed step cannot be declined.')
  if (step.status === 'denied') return res.json(plan)
  const now = new Date().toISOString()
  if (step.approvalId) db.prepare('UPDATE approvals SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, step.approvalId)
  step.status = 'denied'
  step.approvalId = undefined
  step.expiresAt = undefined
  plan.updatedAt = now
  plan.status = planStatusFor(plan.steps)
  savePlan(plan)
  recordAudit('action.denied', 'plan_step', step.id, 'Owner declined the local task-creation action.')
  res.json(plan)
})

app.post('/api/plans/:id/steps/:stepId/execute', (req, res) => {
  const plan = loadPlan(req.params.id)
  if (!plan) return jsonError(res, 404, 'Plan not found.')
  const step = plan.steps.find((item) => item.id === req.params.stepId)
  if (!step) return jsonError(res, 404, 'Plan step not found.')
  if (step.kind !== 'create_task') return jsonError(res, 403, 'This action type is not connected in this prototype.')
  if (!dependenciesReady(plan, step)) return jsonError(res, 409, 'This step is waiting for an earlier step to complete.')
  const existing = db.prepare('SELECT id, title FROM tasks WHERE source_plan_id = ? AND source_step_id = ?').get(plan.id, step.id) as { id: string; title: string } | undefined
  if (existing) {
    if (step.status === 'done' && step.resultTaskId === existing.id && step.actionHash === actionHash(plan.id, step) && existing.title === step.taskTitle) {
      return res.json({ plan, taskId: existing.id, replayed: true })
    }
    return jsonError(res, 409, 'A task already exists for a different or unfinished step state. No replay was recorded.')
  }
  if (step.status !== 'approved') return jsonError(res, 403, 'Approve this exact action before it can run.')
  if (!step.approvalId || !step.expiresAt) {
    resetApprovalForReview(plan, step, 'approval.invalidated', 'Approval details were incomplete; owner review is required again.')
    return res.json({ plan, approvalReset: true })
  }
  const now = new Date().toISOString()
  const approval = db.prepare('SELECT * FROM approvals WHERE id = ? AND plan_id = ? AND step_id = ? AND revoked_at IS NULL').get(step.approvalId, plan.id, step.id) as { action_hash: string; expires_at: string } | undefined
  if (!approval || approval.action_hash !== step.actionHash || step.actionHash !== actionHash(plan.id, step)) {
    resetApprovalForReview(plan, step, 'approval.invalidated', 'Approval no longer matched the exact action; owner review is required again.')
    return res.json({ plan, approvalReset: true })
  }
  if (Date.parse(approval.expires_at) <= Date.now()) {
    resetApprovalForReview(plan, step, 'approval.expired', 'Approval expired before execution; owner review is required again.')
    return res.json({ plan, approvalReset: true })
  }

  const approvalId = step.approvalId
  step.status = 'active'
  step.startedAt = now
  plan.status = 'running'
  savePlan(plan)
  recordAudit('step.started', 'plan_step', step.id, 'Started an approved plan step; execution is in progress.')
  const execute = db.transaction(() => {
    const id = randomUUID()
    db.prepare('INSERT INTO tasks (id, title, created_at, source_plan_id, source_step_id) VALUES (?, ?, ?, ?, ?)')
      .run(id, step.taskTitle, now, plan.id, step.id)
    step.status = 'done'
    step.completedAt = now
    step.output = 'Created the approved local task.'
    step.error = undefined
    step.resultTaskId = id
    step.approvalId = undefined
    step.expiresAt = undefined
    plan.updatedAt = now
    plan.status = planStatusFor(plan.steps)
    savePlan(plan)
    db.prepare('UPDATE approvals SET revoked_at = ? WHERE id = ?').run(now, approvalId)
    recordAudit('action.succeeded', 'plan_step', step.id, 'Approved local task-creation action completed.')
    return id
  })
  try {
    const taskId = execute()
    res.json({ plan, taskId, replayed: false })
  } catch {
    const persistedPlan = loadPlan(plan.id)
    const persistedStep = persistedPlan?.steps.find((item) => item.id === step.id)
    const task = db.prepare('SELECT id, title FROM tasks WHERE source_plan_id = ? AND source_step_id = ?').get(plan.id, step.id) as { id: string; title: string } | undefined
    if (persistedPlan && persistedStep?.status === 'done' && task && persistedStep.resultTaskId === task.id && persistedStep.taskTitle === task.title && persistedStep.actionHash === actionHash(persistedPlan.id, persistedStep)) {
      return res.json({ plan: persistedPlan, taskId: task.id, replayed: true })
    }
    step.status = 'failed'
    step.error = 'Execution failed before a verified result was recorded.'
    step.completedAt = new Date().toISOString()
    plan.status = 'failed'
    savePlan(plan)
    recordAudit('action.failed', 'plan_step', step.id, 'Approved local action failed; no success was recorded.')
    jsonError(res, 500, 'The action failed. No success was recorded; you can retry safely.')
  }
})

app.delete('/api/tasks/:id', (req, res) => {
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id)
  if (result.changes === 0) return jsonError(res, 404, 'Task not found.')
  recordAudit('task.deleted', 'task', req.params.id, 'Owner deleted a local task.')
  res.status(204).end()
})

app.get('/api/memories', (_req, res) => {
  const rows = db.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all() as Array<{ id: string; title: string; content: string; source: 'owner'; created_at: string; updated_at: string }>
  res.json(rows.map((row): MemoryEntry => ({ id: row.id, title: row.title, content: row.content, source: row.source, createdAt: row.created_at, updatedAt: row.updated_at })))
})

app.post('/api/memories', (req, res) => {
  const parsed = memorySchema.safeParse(req.body)
  if (!parsed.success) return jsonError(res, 400, 'Add a title and content for this memory.')
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare('INSERT INTO memories (id, title, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, parsed.data.title, parsed.data.content, 'owner', now, now)
  recordAudit('memory.created', 'memory', id, 'Owner created an explicit memory.')
  res.status(201).json({ id, title: parsed.data.title, content: parsed.data.content, source: 'owner', createdAt: now, updatedAt: now })
})

app.put('/api/memories/:id', (req, res) => {
  const parsed = memorySchema.safeParse(req.body)
  if (!parsed.success) return jsonError(res, 400, 'Add a title and content for this memory.')
  const now = new Date().toISOString()
  const result = db.prepare('UPDATE memories SET title = ?, content = ?, updated_at = ? WHERE id = ?').run(parsed.data.title, parsed.data.content, now, req.params.id)
  if (!result.changes) return jsonError(res, 404, 'Memory not found.')
  const row = db.prepare('SELECT created_at FROM memories WHERE id = ?').get(req.params.id) as { created_at: string }
  recordAudit('memory.updated', 'memory', req.params.id, 'Owner edited an explicit memory.')
  res.json({ id: req.params.id, title: parsed.data.title, content: parsed.data.content, source: 'owner', createdAt: row.created_at, updatedAt: now })
})

app.delete('/api/memories/:id', (req, res) => {
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(req.params.id)
  if (!result.changes) return jsonError(res, 404, 'Memory not found.')
  recordAudit('memory.deleted', 'memory', req.params.id, 'Owner deleted an explicit memory; content was removed.')
  res.status(204).end()
})

app.get('/api/activity', (_req, res) => {
  const rows = db.prepare('SELECT * FROM audit_events ORDER BY occurred_at DESC').all() as Array<{ id: string; occurred_at: string; event_type: string; entity_type: string; entity_id: string; summary: string }>
  const planRows = db.prepare('SELECT id FROM plans').all() as Array<{ id: string }>
  const planRequests = new Map<string, string>()
  const stepTitles = new Map<string, string>()
  const taskTitles = new Map<string, string>()
  for (const row of planRows) {
    const plan = loadPlan(row.id)
    if (!plan) continue
    planRequests.set(plan.id, plan.request)
    for (const step of plan.steps) {
      stepTitles.set(step.id, step.taskTitle)
      if (step.resultTaskId) taskTitles.set(step.resultTaskId, step.taskTitle)
    }
  }
  const memoryRows = db.prepare('SELECT id, title FROM memories').all() as Array<{ id: string; title: string }>
  const memoryTitles = new Map(memoryRows.map((row) => [row.id, row.title]))
  res.json(rows.map((row): AuditEvent => {
    const context = row.entity_type === 'plan' ? planRequests.get(row.entity_id)
      : row.entity_type === 'plan_step' ? stepTitles.get(row.entity_id)
        : row.entity_type === 'task' ? taskTitles.get(row.entity_id)
          : row.entity_type === 'memory' ? memoryTitles.get(row.entity_id)
            : undefined
    const hasContextType = ['plan', 'plan_step', 'task', 'memory'].includes(row.entity_type)
    return { id: row.id, occurredAt: row.occurred_at, eventType: row.event_type, entityType: row.entity_type, entityId: row.entity_id, summary: row.summary, context, detailsRemoved: hasContextType && !context }
  }))
})

app.use((_req, res) => jsonError(res, 404, 'That Forge endpoint does not exist.'))

export { app }
