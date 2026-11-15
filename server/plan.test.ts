import assert from 'node:assert/strict'
import test from 'node:test'
import { actionHash, draftPlan } from './plan.js'

test('local plan drafting is bounded, local-only and labels its generation source', async () => {
  const plan = await draftPlan('Prepare proposal; review final copy.')
  assert.equal(plan.generationMode, 'local_parser')
  assert.equal(plan.steps.length, 2)
  assert.equal(plan.steps[0].taskTitle, 'Prepare proposal')
  assert.equal(plan.steps[1].taskTitle, 'review final copy')
  assert.equal(plan.steps[0].status, 'pending')
  assert.ok(plan.steps.every((step) => step.kind === 'create_task'))
  assert.equal(plan.steps[0].actionHash, actionHash(plan.id, plan.steps[0]))
})

test('action hash changes when the approved task changes', async () => {
  const plan = await draftPlan('Draft a short report.')
  const step = plan.steps[0]
  const original = actionHash(plan.id, step)
  assert.notEqual(original, actionHash(plan.id, { ...step, taskTitle: 'Send a report to a client' }))
})

test('configured model credentials require HTTPS and cannot be embedded in the URL', async () => {
  const keys = ['FORGE_LLM_BASE_URL', 'FORGE_LLM_API_KEY', 'FORGE_LLM_MODEL', 'FORGE_LLM_ALLOW_INSECURE_LOCALHOST'] as const
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  process.env.FORGE_LLM_API_KEY = 'test-only-secret'
  process.env.FORGE_LLM_MODEL = 'test-model'
  process.env.FORGE_LLM_BASE_URL = 'http://example.test/v1'
  delete process.env.FORGE_LLM_ALLOW_INSECURE_LOCALHOST
  try {
    await assert.rejects(() => draftPlan('Draft a summary.'), /must use HTTPS/)
    process.env.FORGE_LLM_BASE_URL = 'https://user:password@example.test/v1'
    await assert.rejects(() => draftPlan('Draft a summary.'), /must not be embedded/)
  } finally {
    for (const key of keys) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
