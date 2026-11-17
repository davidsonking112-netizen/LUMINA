import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import supertest from 'supertest'
import type { PlanStep } from '../src/types.js'

const testDir = mkdtempSync(join(tmpdir(), 'forge-api-test-'))
process.env.FORGE_DB_PATH = join(testDir, 'forge.sqlite')
const { app } = await import('./index.js')
const { db } = await import('./db.js')

const sameOriginHeaders = {
  Host: '127.0.0.1:8787',
  Origin: 'http://127.0.0.1:5173',
  'Sec-Fetch-Site': 'same-origin',
}
const trustedHeaders = {
  ...sameOriginHeaders,
  'X-Forge-Request': '1',
}
const request = (target: typeof app) => ({
  get: (path: string) => supertest(target).get(path).set(trustedHeaders),
  post: (path: string) => supertest(target).post(path).set(trustedHeaders),
  put: (path: string) => supertest(target).put(path).set(trustedHeaders),
  delete: (path: string) => supertest(target).delete(path).set(trustedHeaders),
})

after(() => {
  db.close()
  rmSync(testDir, { recursive: true, force: true })
})

test('cross-origin form requests cannot approve or execute a task', async () => {
  const created = await request(app).post('/api/plans').send({ request: 'Create a local task to check the origin boundary.' }).expect(201)
  const plan = created.body as { id: string; steps: Array<{ id: string; status: string }> }
  const stepId = plan.steps[0].id
  const browserFormHeaders = {
    Host: '127.0.0.1:8787',
    Origin: 'http://attacker.example',
    'Sec-Fetch-Site': 'cross-site',
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  await supertest(app).post(`/api/plans/${plan.id}/steps/${stepId}/approve`).set(browserFormHeaders).send('approve=true').expect(403)
  await supertest(app).post(`/api/plans/${plan.id}/steps/${stepId}/execute`).set(browserFormHeaders).send('execute=true').expect(403)
  await supertest(app).post(`/api/plans/${plan.id}/steps/${stepId}/approve`).set(sameOriginHeaders).send({}).expect(403)
  await supertest(app).post(`/api/plans/${plan.id}/steps/${stepId}/approve`).set({ Host: '127.0.0.1:8787', Origin: 'http://127.0.0.1:5173', 'X-Forge-Request': '1' }).send({}).expect(403)
  await supertest(app).post(`/api/plans/${plan.id}/steps/${stepId}/approve`).set({ ...trustedHeaders, Host: 'attacker.example' }).send({}).expect(403)
  await supertest(app).post(`/api/plans/${plan.id}/steps/${stepId}/approve`).set({ Host: '127.0.0.1:8787', 'X-Forge-Request': '1' }).send({}).expect(403)

  const unchanged = await request(app).get(`/api/plans/${plan.id}`).expect(200)
  assert.equal(unchanged.body.steps[0].status, 'pending')
  assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 0)
})

test('unconnected action types cannot be approved or executed even if a saved plan is altered', async () => {
  const created = await request(app).post('/api/plans').send({ request: 'Create a local task to prepare safely.' }).expect(201)
  const plan = created.body as { id: string; steps: Array<{ id: string; status: string }> }
  const row = db.prepare('SELECT steps_json FROM plans WHERE id = ?').get(plan.id) as { steps_json: string }
  const steps = JSON.parse(row.steps_json) as PlanStep[]
  steps[0].kind = 'send_email'
  db.prepare('UPDATE plans SET steps_json = ? WHERE id = ?').run(JSON.stringify(steps), plan.id)

  await request(app).post(`/api/plans/${plan.id}/steps/${steps[0].id}/approve`).expect(403)
  await request(app).post(`/api/plans/${plan.id}/steps/${steps[0].id}/execute`).expect(403)
  const unchanged = await request(app).get(`/api/plans/${plan.id}`).expect(200)
  assert.equal(unchanged.body.steps[0].status, 'pending')
  assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 0)
})

test('unconnected services stay inactive and unsupported workflows do not return success', async () => {
  const capabilities = await request(app).get('/api/capabilities').expect(200)
  assert.deepEqual(capabilities.body.inputModes, ['text'])
  assert.deepEqual(capabilities.body.actionKinds, ['create_task'])
  assert.equal(typeof capabilities.body.modelConfigured, 'boolean')
  assert.equal(capabilities.body.streaming, false)

  const previousModel = [process.env.FORGE_LLM_BASE_URL, process.env.FORGE_LLM_API_KEY, process.env.FORGE_LLM_MODEL]
  delete process.env.FORGE_LLM_BASE_URL
  delete process.env.FORGE_LLM_API_KEY
  delete process.env.FORGE_LLM_MODEL
  try {
    const unavailable = await request(app).post('/api/plans').send({ request: 'What is the capital of Ghana?' }).expect(201)
    assert.equal(unavailable.body.status, 'failed')
    assert.equal(unavailable.body.assistantOutput.status, 'unavailable')
    assert.match(unavailable.body.assistantOutput.answer, /No content or task was created/)
    assert.equal(unavailable.body.steps.length, 0)
    const saved = await request(app).get(`/api/plans/${unavailable.body.id}`).expect(200)
    assert.equal(saved.body.request, 'What is the capital of Ghana?')
    const activities = await request(app).get('/api/activity').expect(200)
    assert.ok(activities.body.some((event: { summary: string }) => event.summary === 'Answer unavailable; no content or tasks were created.'))
  } finally {
    for (const [index, key] of ['FORGE_LLM_BASE_URL', 'FORGE_LLM_API_KEY', 'FORGE_LLM_MODEL'].entries()) {
      const value = previousModel[index]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }

  const connectors = (await request(app).get('/api/connectors').expect(200)).body as Array<{ status: string; scopes: string[] }>
  assert.ok(connectors.length > 0)
  const researchConnector = connectors.find((connector) => connector.status === 'available')
  assert.deepEqual(researchConnector?.scopes, ['search_public_web', 'read_public_pages'])
  assert.ok(connectors.filter((connector) => connector !== researchConnector).every((connector) => connector.status === 'coming_soon' && connector.scopes.length === 0))
  assert.deepEqual((await request(app).get('/api/documents').expect(200)).body, [])
  assert.deepEqual((await request(app).get('/api/automations').expect(200)).body, [])

  const activityBefore = (await request(app).get('/api/activity').expect(200)).body.length
  await request(app).post('/api/automations/morning-briefing/toggle').send({ enabled: true }).expect(501)
  assert.equal((await request(app).get('/api/activity').expect(200)).body.length, activityBefore)
})

test('web research returns source excerpts and a grounded fallback without a model', async () => {
  const previousFetch = globalThis.fetch
  const previousDisable = process.env.FORGE_LLM_DISABLE
  process.env.FORGE_LLM_DISABLE = 'true'
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('r.jina.ai')) return new Response('1. ## [Example source](https://example.com/research)\nA useful result excerpt.')
    return new Response('<html><body><h1>Example source</h1><p>Reliable research evidence for the question. This longer excerpt represents the readable content returned by a public web page and gives LUMINA enough context to cite it safely.</p></body></html>')
  }
  try {
    const response = await request(app).post('/api/research').send({ question: 'What is the evidence?' }).expect(200)
    assert.equal(response.body.sources.length, 1)
    assert.equal(response.body.sources[0].url, 'https://example.com/research')
    assert.match(response.body.answer, /Example source/)
  } finally {
    globalThis.fetch = previousFetch
    if (previousDisable === undefined) delete process.env.FORGE_LLM_DISABLE
    else process.env.FORGE_LLM_DISABLE = previousDisable
  }
})

test('generated answer and draft persist separately from local task actions', async () => {
  const keys = ['FORGE_LLM_BASE_URL', 'FORGE_LLM_API_KEY', 'FORGE_LLM_MODEL'] as const
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  const previousFetch = globalThis.fetch
  process.env.FORGE_LLM_BASE_URL = 'https://model.example/v1'
  process.env.FORGE_LLM_API_KEY = 'test-only-secret'
  process.env.FORGE_LLM_MODEL = 'test-model'
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    answer: 'Here is the draft you asked for.',
    deliverables: [{ title: 'Announcement', content: 'Your new portal is ready. Sign in to see all your account details in one place.' }],
    localTasks: ['Review announcement before publishing'],
  }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    const created = await request(app).post('/api/plans').send({ request: 'Draft an announcement and create a separate local task to review it.' }).expect(201)
    assert.equal(created.body.assistantOutput.status, 'generated')
    assert.equal(created.body.assistantOutput.deliverables[0].title, 'Announcement')
    assert.equal(created.body.steps.length, 1)
    assert.equal(created.body.steps[0].taskTitle, 'Review announcement before publishing')
    assert.equal((await request(app).get(`/api/plans/${created.body.id}`).expect(200)).body.assistantOutput.deliverables[0].content, 'Your new portal is ready. Sign in to see all your account details in one place.')
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 0)
  } finally {
    globalThis.fetch = previousFetch
    for (const key of keys) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('approval is required, edits invalidate it, and retries never create duplicate tasks', async () => {
  const created = await request(app).post('/api/plans').send({ request: 'Create local tasks to prepare proposal; review final copy.' }).expect(201)
  const plan = created.body as { id: string; request: string; generationMode: string; status: string; steps: Array<{ id: string; taskTitle: string; status: string; expiresAt?: string; approvalId?: string }> }
  assert.equal(plan.generationMode, 'local_parser')
  assert.equal(plan.steps.length, 2)

  await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[0].id}/execute`).expect(403)
  assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 0)

  const approved = await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[0].id}/approve`).expect(200)
  assert.equal(approved.body.steps[0].status, 'approved')
  assert.ok(approved.body.steps[0].expiresAt)

  const changedSteps = plan.steps.map((step, index) => ({ id: step.id, taskTitle: index === 0 ? 'Prepare the revised proposal' : step.taskTitle }))
  const updated = await request(app).put(`/api/plans/${plan.id}`).send({ steps: changedSteps }).expect(200)
  assert.equal(updated.body.steps[0].status, 'pending')
  await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[0].id}/execute`).expect(403)
  assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 0)

  await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[0].id}/approve`).expect(200)
  const firstRun = await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[0].id}/execute`).expect(200)
  assert.equal(firstRun.body.replayed, false)
  assert.equal(firstRun.body.plan.steps[0].status, 'done')
  const retry = await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[0].id}/execute`).expect(200)
  assert.equal(retry.body.replayed, true)
  assert.equal(retry.body.taskId, firstRun.body.taskId)
  assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 1)

  await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[0].id}/deny`).expect(409)
  await request(app).put(`/api/plans/${plan.id}`).send({ steps: plan.steps.map((step, index) => ({ id: step.id, taskTitle: index === 0 ? 'Change a completed task' : step.taskTitle })) }).expect(409)
  assert.equal((await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[0].id}/execute`).expect(200)).body.replayed, true)

  await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[1].id}/deny`).expect(200)
  const resolvedPlan = await request(app).get(`/api/plans/${plan.id}`).expect(200)
  assert.equal(resolvedPlan.body.status, 'completed')
  assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 1)
  const activity = (await request(app).get('/api/activity').expect(200)).body as Array<{ summary: string }>
  assert.ok(activity.some((event) => event.summary.includes('earlier approvals were invalidated')))
  assert.ok(activity.every((event) => !event.summary.includes('Prepare the revised proposal')))
  const liveActivity = (await request(app).get('/api/activity').expect(200)).body as Array<{ summary: string; context?: string }>
  assert.ok(liveActivity.some((event) => event.summary === 'Approved local task-creation action completed.' && event.context === 'Prepare the revised proposal'))

  await request(app).delete(`/api/plans/${plan.id}`).expect(204)
  assert.equal((await request(app).get('/api/plans').expect(200)).body.some((item: { id: string }) => item.id === plan.id), false)
  assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 0)
  const afterDelete = (await request(app).get('/api/activity').expect(200)).body as Array<{ summary: string; context?: string; detailsRemoved?: boolean }>
  assert.ok(afterDelete.some((event) => event.summary === 'Approved local task-creation action completed.' && event.detailsRemoved === true && !event.context))
  assert.ok(afterDelete.some((event) => event.summary.includes('request and task details were removed.')))
  const exportAfterDelete = await request(app).get('/api/export').expect(200)
  assert.equal(JSON.stringify(exportAfterDelete.body).includes(plan.request), false)
  assert.ok(JSON.stringify(exportAfterDelete.body).includes('Approved local task-creation action completed.'))
})

test('expired approvals return to pending and can be reviewed again without running the task', async () => {
  const created = await request(app).post('/api/plans').send({ request: 'Create a local task to review the quarterly report.' }).expect(201)
  const plan = created.body as { id: string; steps: Array<{ id: string; status: string; approvalId?: string }> }
  const step = plan.steps[0]
  const approved = await request(app).post(`/api/plans/${plan.id}/steps/${step.id}/approve`).expect(200)
  const approvalId = approved.body.steps[0].approvalId as string
  db.prepare('UPDATE approvals SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), approvalId)

  const result = await request(app).post(`/api/plans/${plan.id}/steps/${step.id}/execute`).expect(200)
  assert.equal(result.body.approvalReset, true)
  assert.equal(result.body.plan.steps[0].status, 'pending')
  assert.equal(result.body.plan.steps[0].approvalId, undefined)
  assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 0)
  await request(app).post(`/api/plans/${plan.id}/steps/${step.id}/approve`).expect(200)
  const executed = await request(app).post(`/api/plans/${plan.id}/steps/${step.id}/execute`).expect(200)
  assert.equal(executed.body.plan.steps[0].status, 'done')
})

test('multi-step plans enforce dependencies and report completed step output', async () => {
  const created = await request(app).post('/api/plans').send({ request: 'Create local tasks to review the latest sales report; add a follow-up task.' }).expect(201)
  const plan = created.body as { id: string; steps: Array<{ id: string; status: string }> }
  assert.equal(plan.steps.length, 2)
  await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[1].id}/approve`).expect(409)
  await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[0].id}/approve`).expect(200)
  const executed = await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[0].id}/execute`).expect(200)
  assert.equal(executed.body.plan.steps[0].status, 'done')
  assert.equal(executed.body.plan.steps[0].output, 'Created the approved local task.')
  await request(app).post(`/api/plans/${plan.id}/steps/${plan.steps[1].id}/approve`).expect(200)
})

test('owner-added memories can be edited and deleted without copying their content into audit summaries', async () => {
  const created = await request(app).post('/api/memories').send({ title: 'Writing style', content: 'Keep notes concise.' }).expect(201)
  const memory = created.body as { id: string; createdAt: string }
  assert.equal(created.body.source, 'owner')

  const edited = await request(app).put(`/api/memories/${memory.id}`).send({ title: 'Writing style', content: 'Use concise, direct notes.' }).expect(200)
  assert.equal(edited.body.createdAt, memory.createdAt)
  assert.equal(edited.body.content, 'Use concise, direct notes.')
  await request(app).delete(`/api/memories/${memory.id}`).expect(204)
  assert.equal((await request(app).get('/api/memories').expect(200)).body.length, 0)

  const activity = (await request(app).get('/api/activity').expect(200)).body as Array<{ summary: string }>
  assert.ok(activity.some((event) => event.summary === 'Owner deleted an explicit memory; content was removed.'))
  assert.ok(activity.every((event) => !event.summary.includes('concise')))
})

test('workspace export includes saved data and the owner can clear all local records', async () => {
  await request(app).post('/api/plans').send({ request: 'Keep an exportable local record.' }).expect(201)
  await request(app).post('/api/memories').send({ title: 'Preference', content: 'Short summaries.' }).expect(201)
  const exported = await request(app).get('/api/export').expect(200)
  assert.ok(exported.body.plans.length > 0)
  assert.ok(exported.body.memories.length > 0)
  assert.equal(exported.body.formatVersion, 1)

  await request(app).delete('/api/data').expect(204)
  assert.equal((await request(app).get('/api/plans').expect(200)).body.length, 0)
  assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 0)
  assert.equal((await request(app).get('/api/memories').expect(200)).body.length, 0)
  assert.equal((await request(app).get('/api/activity').expect(200)).body.length, 0)
})
