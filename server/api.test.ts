import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import supertest from 'supertest'
import type { PlanStep } from '../src/types.js'
import { actionMayRun, actionRegistry } from './policy.js'

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

test('Automatic mode is server-gated to explicit parser tasks and safely replays by request ID', async () => {
  const keys = ['FORGE_LLM_BASE_URL', 'FORGE_LLM_API_KEY', 'FORGE_LLM_MODEL'] as const
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  const previousFetch = globalThis.fetch
  const previousMode = (await request(app).get('/api/settings').expect(200)).body.permissionMode as string
  await request(app).delete('/api/data').expect(204)
  process.env.FORGE_LLM_BASE_URL = 'https://model.example/v1'
  process.env.FORGE_LLM_API_KEY = 'test-only-secret'
  process.env.FORGE_LLM_MODEL = 'test-model'
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    answer: 'Here is the requested answer.',
    localTasks: ['Model-invented task must not run automatically'],
  }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    assert.equal(actionRegistry.create_task.supported, true)
    assert.equal(actionRegistry.create_task.riskLevel, 'low')
    assert.equal(actionRegistry.send_email.supported, false)
    assert.equal(actionMayRun('create_task', 'automatic', true), true)
    assert.equal(actionMayRun('send_email', 'automatic', true), false)
    assert.equal(actionMayRun('unknown_action', 'automatic', true), false)

    const defaultSettings = await request(app).get('/api/settings').expect(200)
    assert.equal(defaultSettings.body.permissionMode, 'approve')
    await request(app).put('/api/settings').send({ permissionMode: 'automatic' }).expect(200)
    assert.equal((await request(app).get('/api/capabilities').expect(200)).body.currentPermissionMode, 'automatic')
    await request(app).post('/api/plans').send({ request: 'Create a local task to check the missing request ID.' }).expect(400)

    const activityBefore = (await request(app).get('/api/activity').expect(200)).body as Array<{ eventType: string }>
    for (const [requestId, prompt] of [
      ['00000000-0000-4000-8000-000000000011', 'Do not create local tasks; just explain the plan.'],
      ['00000000-0000-4000-8000-000000000012', 'Please don’t create a local task for this.'],
      ['00000000-0000-4000-8000-000000000013', 'Help me review the plan without creating a task.'],
      ['00000000-0000-4000-8000-000000000016', 'Create a local task to review the checklist, but do not actually create it.'],
      ['00000000-0000-4000-8000-000000000017', 'Create a task to review the report, without saving it.'],
      ['00000000-0000-4000-8000-000000000021', 'Create a local task to review the checklist, but do not save.'],
      ['00000000-0000-4000-8000-000000000022', 'Create a task to review the report, however do not add.'],
      ['00000000-0000-4000-8000-000000000023', 'Create a local task to review the checklist, but skip.'],
      ['00000000-0000-4000-8000-000000000024', 'Create a local task to review the checklist, but do not.'],
      ['00000000-0000-4000-8000-000000000025', 'Create a local task to review the checklist, but maybe not.'],
      ['00000000-0000-4000-8000-000000000026', 'Create a local task to review the checklist, but don’t do that.'],
      ['00000000-0000-4000-8000-000000000027', 'Create a local task to review the checklist, but don’t.'],
      ['00000000-0000-4000-8000-000000000028', 'Create a local task to review the checklist, but please don’t.'],
      ['00000000-0000-4000-8000-000000000029', 'Create a local task to review the checklist, but I changed my mind'],
      ['00000000-0000-4000-8000-000000000031', 'Create a local task to review the checklist, but I am not sure'],
      ['00000000-0000-4000-8000-000000000033', 'Create a local task to review the checklist, but I’m unsure'],
      ['00000000-0000-4000-8000-000000000034', 'Create a local task to review the checklist, but I am not sure it is needed.'],
      ['00000000-0000-4000-8000-000000000035', 'Create a local task to review the checklist, but maybe I should not.'],
      ['00000000-0000-4000-8000-000000000036', 'Create a local task to review the checklist, but I’m not sure about it'],
      ['00000000-0000-4000-8000-000000000037', 'Create a local task to review the checklist, but I changed my mind about it'],
      ['00000000-0000-4000-8000-000000000038', 'I changed my mind about creating a local task to review the checklist'],
      ['00000000-0000-4000-8000-000000000039', 'I’m unsure whether to create a local task to review the checklist'],
    ] as const) {
      const negated = await request(app).post('/api/plans').send({ request: prompt, requestId }).expect(201)
      assert.equal(negated.body.steps.length, 0, prompt)
    }
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 0)
    const activityAfterNegations = (await request(app).get('/api/activity').expect(200)).body as Array<{ eventType: string }>
    assert.equal(activityAfterNegations.filter((event) => event.eventType === 'action.auto_succeeded').length, activityBefore.filter((event) => event.eventType === 'action.auto_succeeded').length)

    const explicitRequest = { request: 'Create a local task to review the launch checklist.', requestId: '00000000-0000-4000-8000-000000000014' }
    const created = await request(app).post('/api/plans').send(explicitRequest).expect(201)
    assert.equal(created.body.steps[0].provenance, 'user_request_parser')
    assert.equal(created.body.steps[0].status, 'done')
    assert.equal(created.body.steps[0].taskTitle, 'review the launch checklist')
    const tasks = await request(app).get('/api/tasks').expect(200)
    assert.equal(tasks.body.length, 1)
    assert.equal(tasks.body[0].title, 'review the launch checklist')
    assert.notEqual(tasks.body[0].title, 'Model-invented task must not run automatically')

    const replay = await request(app).post('/api/plans').send(explicitRequest).expect(200)
    assert.equal(replay.body.id, created.body.id)
    await request(app).post('/api/plans').send({ ...explicitRequest, request: 'Create a local task to send an email.' }).expect(409)
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 1)

    const deletedPlanRequest = { request: 'Create a local task to test plan deletion replay.', requestId: '00000000-0000-4000-8000-000000000018' }
    const deletedPlan = await request(app).post('/api/plans').send(deletedPlanRequest).expect(201)
    await request(app).delete(`/api/plans/${deletedPlan.body.id}`).expect(204)
    await request(app).post('/api/plans').send(deletedPlanRequest).expect(410)
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 1)

    const unrelatedProhibition = await request(app).post('/api/plans').send({
      request: "Create a local task to review the checklist, but don't email the team",
      requestId: '00000000-0000-4000-8000-000000000032',
    }).expect(201)
    assert.equal(unrelatedProhibition.body.steps[0].status, 'done')
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 2)
    const unrelatedAndProhibition = await request(app).post('/api/plans').send({
      request: "Create a local task to review the checklist and don't email the team",
      requestId: '00000000-0000-4000-8000-000000000040',
    }).expect(201)
    assert.equal(unrelatedAndProhibition.body.steps[0].status, 'done')
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 3)
    const unrelatedReasonProhibition = await request(app).post('/api/plans').send({
      request: "Create a local task to review the checklist, but don't email the team because this is private.",
      requestId: '00000000-0000-4000-8000-000000000041',
    }).expect(201)
    assert.equal(unrelatedReasonProhibition.body.steps[0].status, 'done')
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 4)
    const unrelatedPrivacyConstraint = await request(app).post('/api/plans').send({
      request: 'Create a local task to review the checklist, but keep the checklist confidential.',
      requestId: '00000000-0000-4000-8000-000000000042',
    }).expect(201)
    assert.equal(unrelatedPrivacyConstraint.body.steps[0].status, 'done')
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 5)
    const unrelatedEmailStorageConstraint = await request(app).post('/api/plans').send({
      request: "Create a local task to review the checklist, but I don't want the email saved.",
      requestId: '00000000-0000-4000-8000-000000000043',
    }).expect(201)
    assert.equal(unrelatedEmailStorageConstraint.body.steps[0].status, 'done')
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 6)

    const clearedRequest = { request: 'Create a local task to test data-clear replay.', requestId: '00000000-0000-4000-8000-000000000019' }
    await request(app).post('/api/plans').send(clearedRequest).expect(201)
    await request(app).delete('/api/data').expect(204)
    await request(app).post('/api/plans').send(clearedRequest).expect(410)
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 0)

    await request(app).put('/api/settings').send({ permissionMode: 'suggest' }).expect(200)
    const suggested = await request(app).post('/api/plans').send({ request: 'Create a local task to review the next release.', requestId: '00000000-0000-4000-8000-000000000020' }).expect(201)
    assert.equal(suggested.body.steps[0].status, 'pending')
    await request(app).post(`/api/plans/${suggested.body.id}/steps/${suggested.body.steps[0].id}/approve`).expect(403)
    await request(app).post(`/api/plans/${suggested.body.id}/steps/${suggested.body.steps[0].id}/execute`).expect(403)
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 0)
  } finally {
    globalThis.fetch = previousFetch
    for (const key of keys) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await request(app).put('/api/settings').send({ permissionMode: previousMode }).expect(200)
    await request(app).delete('/api/data').expect(204)
  }
})

test('explicit no-save requests are rejected before generation or persistence', async () => {
  const keys = ['FORGE_LLM_BASE_URL', 'FORGE_LLM_API_KEY', 'FORGE_LLM_MODEL'] as const
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  const previousFetch = globalThis.fetch
  const previousMode = (await request(app).get('/api/settings').expect(200)).body.permissionMode as string
  const refusedRequests = [
    { request: 'Create a local task to review the private checklist, but do not save the request.', requestId: '00000000-0000-4000-8000-000000000044' },
    { request: 'Create a local task to review the private checklist, but do not save the request because this is private.', requestId: '00000000-0000-4000-8000-000000000045' },
    { request: 'Do not save any of this', requestId: '00000000-0000-4000-8000-000000000046' },
    { request: 'Do not retain anything I tell you', requestId: '00000000-0000-4000-8000-000000000047' },
    { request: 'This is private; do not store my information', requestId: '00000000-0000-4000-8000-000000000048' },
    { request: 'Please do not store anything from this prompt', requestId: '00000000-0000-4000-8000-000000000049' },
    { request: 'Keep this out of history', requestId: '00000000-0000-4000-8000-000000000050' },
    { request: 'Keep my details out of your records.', requestId: '00000000-0000-4000-8000-000000000051' },
    { request: 'Do not persist this prompt.', requestId: '00000000-0000-4000-8000-000000000052' },
    { request: 'Do not remember my name', requestId: '00000000-0000-4000-8000-000000000053' },
    { request: 'Do not save my contact details', requestId: '00000000-0000-4000-8000-000000000054' },
    { request: 'Do not retain my address', requestId: '00000000-0000-4000-8000-000000000055' },
    { request: 'Please do not preserve this conversation', requestId: '00000000-0000-4000-8000-000000000056' },
    { request: 'Forget what I just told you', requestId: '00000000-0000-4000-8000-000000000057' },
    { request: 'This is off the record', requestId: '00000000-0000-4000-8000-000000000058' },
    { request: "Don't remember what I told you", requestId: '00000000-0000-4000-8000-000000000059' },
    { request: "Don't remember what I tell you", requestId: '00000000-0000-4000-8000-000000000060' },
    { request: "Don't remember what I said", requestId: '00000000-0000-4000-8000-000000000061' },
    { request: "Don't remember what I shared", requestId: '00000000-0000-4000-8000-000000000062' },
    { request: "Don't remember what I provided", requestId: '00000000-0000-4000-8000-000000000063' },
    { request: "Don't remember what I sent", requestId: '00000000-0000-4000-8000-000000000064' },
    { request: 'This conversation is off-record.', requestId: '00000000-0000-4000-8000-000000000065' },
    { request: "I don't want this in your history", requestId: '00000000-0000-4000-8000-000000000066' },
    { request: "I don't want this stored", requestId: '00000000-0000-4000-8000-000000000067' },
    { request: "Please don't keep a record of this", requestId: '00000000-0000-4000-8000-000000000068' },
    { request: "Don't archive this conversation", requestId: '00000000-0000-4000-8000-000000000069' },
    { request: 'Do not retain my phone number', requestId: '00000000-0000-4000-8000-000000000070' },
    { request: 'Please delete the prompt after answering', requestId: '00000000-0000-4000-8000-000000000071' },
  ]
  let modelCalls = 0

  try {
    await request(app).delete('/api/data').expect(204)
    await request(app).put('/api/settings').send({ permissionMode: 'automatic' }).expect(200)
    process.env.FORGE_LLM_BASE_URL = 'https://model.example/v1'
    process.env.FORGE_LLM_API_KEY = 'test-only-secret'
    process.env.FORGE_LLM_MODEL = 'test-model'
    globalThis.fetch = async () => {
      modelCalls += 1
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: 'Should not be generated.', localTasks: [] }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    for (const refused of refusedRequests) {
      const rejected = await request(app).post('/api/plans').send(refused).expect(400)
      assert.match(rejected.body.error, /cannot process a request that asks not to be saved/i)
      assert.equal(rejected.body.error.includes(refused.request), false)
    }
    assert.equal(modelCalls, 0)

    assert.deepEqual((await request(app).get('/api/plans').expect(200)).body, [])
    assert.deepEqual((await request(app).get('/api/tasks').expect(200)).body, [])
    assert.deepEqual((await request(app).get('/api/activity').expect(200)).body, [])
    const exported = (await request(app).get('/api/export').expect(200)).body
    assert.deepEqual(exported.plans, [])
    assert.deepEqual(exported.tasks, [])
    assert.deepEqual(exported.activity, [])
    for (const refused of refusedRequests) assert.equal(JSON.stringify(exported).includes(refused.request), false)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM plans').get() as { count: number }).count, 0)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number }).count, 0)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }).count, 0)
    for (const refused of refusedRequests) {
      assert.equal((db.prepare('SELECT COUNT(*) AS count FROM idempotency_keys WHERE request_id = ?').get(refused.requestId) as { count: number }).count, 0)
    }

    for (const requestText of ["I don't remember my name", "I can't remember my name"]) {
      const ordinaryStatement = await request(app).post('/api/plans').send({ request: requestText }).expect(201)
      assert.equal(ordinaryStatement.body.assistantOutput.status, 'generated')
    }
    assert.equal(modelCalls, 2)
  } finally {
    globalThis.fetch = previousFetch
    for (const key of keys) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await request(app).delete('/api/data').expect(204)
    await request(app).put('/api/settings').send({ permissionMode: previousMode }).expect(200)
  }
})

test('clearing workspace data cancels an in-flight plan before it can persist', async () => {
  const keys = ['FORGE_LLM_BASE_URL', 'FORGE_LLM_API_KEY', 'FORGE_LLM_MODEL'] as const
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  const previousFetch = globalThis.fetch
  const previousMode = (await request(app).get('/api/settings').expect(200)).body.permissionMode as string
  let releaseModel = () => {}
  let markModelStarted = () => {}
  let inFlight: Promise<unknown> | undefined
  const modelStarted = new Promise<void>((resolve) => { markModelStarted = resolve })
  const modelGate = new Promise<void>((resolve) => { releaseModel = resolve })

  try {
    await request(app).delete('/api/data').expect(204)
    await request(app).put('/api/settings').send({ permissionMode: 'automatic' }).expect(200)
    const generationBeforeClear = (db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get('dataGeneration') as { value: string }).value
    process.env.FORGE_LLM_BASE_URL = 'https://model.example/v1'
    process.env.FORGE_LLM_API_KEY = 'test-only-secret'
    process.env.FORGE_LLM_MODEL = 'test-model'
    globalThis.fetch = async () => {
      markModelStarted()
      await modelGate
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: 'The request was completed.', localTasks: [] }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const pendingRequest = request(app).post('/api/plans').send({
      request: 'Create a local task to review the launch checklist.',
      requestId: '00000000-0000-4000-8000-000000000030',
    }).expect(409).then((response) => response)
    inFlight = pendingRequest
    await modelStarted
    await request(app).delete('/api/data').expect(204)
    assert.equal((await request(app).get('/api/settings').expect(200)).body.permissionMode, 'approve')
    const generationAfterClear = (db.prepare('SELECT value FROM workspace_settings WHERE key = ?').get('dataGeneration') as { value: string }).value
    assert.notEqual(generationAfterClear, generationBeforeClear)
    releaseModel()

    const result = await pendingRequest
    assert.match(result.body.error, /workspace data was cleared/i)
    assert.deepEqual((await request(app).get('/api/plans').expect(200)).body, [])
    assert.deepEqual((await request(app).get('/api/tasks').expect(200)).body, [])
    assert.deepEqual((await request(app).get('/api/activity').expect(200)).body, [])
  } finally {
    releaseModel()
    await inFlight?.catch(() => undefined)
    globalThis.fetch = previousFetch
    for (const key of keys) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await request(app).put('/api/settings').send({ permissionMode: previousMode }).expect(200)
    await request(app).delete('/api/data').expect(204)
  }
})

test('permission mode changes revoke existing approvals and require a fresh review', async () => {
  const keys = ['FORGE_LLM_BASE_URL', 'FORGE_LLM_API_KEY', 'FORGE_LLM_MODEL'] as const
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  const previousMode = (await request(app).get('/api/settings').expect(200)).body.permissionMode as string
  for (const key of keys) delete process.env[key]
  await request(app).delete('/api/data').expect(204)
  try {
    await request(app).put('/api/settings').send({ permissionMode: 'approve' }).expect(200)
    const created = await request(app).post('/api/plans').send({ request: 'Create a local task to review the current release.' }).expect(201)
    const planId = created.body.id as string
    const stepId = created.body.steps[0].id as string
    const approved = await request(app).post(`/api/plans/${planId}/steps/${stepId}/approve`).expect(200)
    assert.equal(approved.body.steps[0].status, 'approved')
    assert.ok(approved.body.steps[0].approvalId)

    await request(app).put('/api/settings').send({ permissionMode: 'suggest' }).expect(200)
    const afterSuggest = await request(app).get(`/api/plans/${planId}`).expect(200)
    assert.equal(afterSuggest.body.steps[0].status, 'pending')
    assert.equal(afterSuggest.body.steps[0].approvalId, undefined)
    assert.equal(afterSuggest.body.steps[0].expiresAt, undefined)

    await request(app).put('/api/settings').send({ permissionMode: 'approve' }).expect(200)
    const afterReturn = await request(app).get(`/api/plans/${planId}`).expect(200)
    assert.equal(afterReturn.body.steps[0].status, 'pending')
    await request(app).post(`/api/plans/${planId}/steps/${stepId}/execute`).expect(403)
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 0)

    await request(app).post(`/api/plans/${planId}/steps/${stepId}/approve`).expect(200)
    const executed = await request(app).post(`/api/plans/${planId}/steps/${stepId}/execute`).expect(200)
    assert.equal(executed.body.plan.steps[0].status, 'done')
    assert.equal((await request(app).get('/api/tasks').expect(200)).body.length, 1)
  } finally {
    for (const key of keys) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await request(app).put('/api/settings').send({ permissionMode: previousMode }).expect(200)
    await request(app).delete('/api/data').expect(204)
  }
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
  assert.ok(connectors.every((connector) => connector.status === 'coming_soon' && connector.scopes.length === 0))
  assert.deepEqual((await request(app).get('/api/documents').expect(200)).body, [])
  assert.deepEqual((await request(app).get('/api/automations').expect(200)).body, [])

  const activityBefore = (await request(app).get('/api/activity').expect(200)).body.length
  await request(app).post('/api/automations/morning-briefing/toggle').send({ enabled: true }).expect(501)
  await request(app).post('/api/research').send({ question: 'Compare recent market trends.' }).expect(501)
  assert.equal((await request(app).get('/api/activity').expect(200)).body.length, activityBefore)
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
