import assert from 'node:assert/strict'
import test from 'node:test'
import { actionHash, asksForExplicitLocalTasks, draftPlan } from './plan.js'

test('without a model, Forge does not fabricate an answer and only creates task suggestions when asked', async () => {
  const plan = await draftPlan('What is the capital of Ghana?')
  assert.equal(plan.generationMode, 'local_parser')
  assert.equal(plan.assistantOutput?.status, 'unavailable')
  assert.match(plan.assistantOutput?.answer ?? '', /language model hasn’t been configured/)
  assert.equal(plan.steps.length, 0)
  const taskPlan = await draftPlan('Create local tasks to review the customer portal launch; collect feedback from support.')
  assert.match(taskPlan.assistantOutput?.answer ?? '', /Task History/)
  assert.doesNotMatch(taskPlan.assistantOutput?.answer ?? '', /below/)
  assert.equal(taskPlan.steps.length, 2)
})

test('local-task intent requires an explicit creation request and fails closed on negation', async () => {
  for (const prompt of [
    'Create a local task to review the launch checklist.',
    'Add a task to my task list for the customer call.',
    'Please save this to my to-do list.',
  ]) assert.equal(asksForExplicitLocalTasks(prompt), true, prompt)

  for (const prompt of [
    'Do not create local tasks; just explain the plan.',
    'Please don’t create a local task for this.',
    'I do not want you to add a task to my list.',
    'No need to create a task; provide the answer only.',
    'Do not add tasks to my to-do list.',
    'Help me review the plan without creating a task.',
  ]) {
    assert.equal(asksForExplicitLocalTasks(prompt), false, prompt)
    assert.equal((await draftPlan(prompt)).steps.length, 0, prompt)
  }
})

test('configured model returns a useful answer and deliverable independently from local tasks', async () => {
  const keys = ['FORGE_LLM_BASE_URL', 'FORGE_LLM_API_KEY', 'FORGE_LLM_MODEL'] as const
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  const previousFetch = globalThis.fetch
  process.env.FORGE_LLM_BASE_URL = 'https://model.example/v1'
  process.env.FORGE_LLM_API_KEY = 'test-only-secret'
  process.env.FORGE_LLM_MODEL = 'test-model'
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    answer: 'Here’s a concise launch announcement draft you can adapt.',
    deliverables: [{ title: 'Launch announcement', content: 'We’re excited to introduce the new customer portal. It brings your account, orders, and support into one simple place.' }],
    localTasks: ['Review the announcement with the launch team'],
    assumptions: ['The portal is ready to launch.'],
  }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    const plan = await draftPlan('Draft a launch announcement and create a local task to review it.')
    assert.equal(plan.generationMode, 'ai')
    assert.equal(plan.assistantOutput?.status, 'generated')
    assert.match(plan.assistantOutput?.answer ?? '', /announcement draft/)
    assert.equal(plan.assistantOutput?.deliverables?.[0].title, 'Launch announcement')
    assert.match(plan.assistantOutput?.deliverables?.[0].content ?? '', /customer portal/)
    assert.equal(plan.steps.length, 1)
    assert.equal(plan.steps[0].taskTitle, 'Review the announcement with the launch team')
    assert.equal(plan.steps[0].status, 'pending')
    assert.equal(plan.steps[0].actionHash, actionHash(plan.id, plan.steps[0]))
    const contentOnly = await draftPlan('Draft a launch announcement.')
    assert.equal(contentOnly.assistantOutput?.status, 'generated')
    assert.equal(contentOnly.steps.length, 0)
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      answer: 'Ready.',
      deliverables: [
        { title: 'First long draft', content: 'x'.repeat(3500) },
        { title: 'Second long draft', content: 'y'.repeat(3500) },
      ],
      localTasks: [],
      assumptions: [],
    }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    await assert.rejects(() => draftPlan('Draft two long pieces.'), /unsupported format/)
  } finally {
    globalThis.fetch = previousFetch
    for (const key of keys) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('action hash changes when the approved task changes', async () => {
  const plan = await draftPlan('Create a local task to track the short report.')
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
