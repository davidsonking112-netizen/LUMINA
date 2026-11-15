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
  const created = await request(app).post('/api/plans').send({ request: 'Check the origin boundary.' }).expect(201)
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
  const created = await request(app).post('/api/plans').send({ request: 'Prepare a safe local task.' }).expect(201)
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

test('approval is required, edits invalidate it, and retries never create duplicate tasks', async () => {
  const created = await request(app).post('/api/plans').send({ request: 'Prepare proposal; review final copy.' }).expect(201)
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
  const created = await request(app).post('/api/plans').send({ request: 'Review quarterly report.' }).expect(201)
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
