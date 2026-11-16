import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const requestText = `Create local tasks to prepare a browser flow check ${Date.now()}; review the generated local task`

test('plan review, exact approval, task execution, export and deletion history work end to end', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome back, Davids' })).toBeVisible()
  const dashboardAccessibility = await new AxeBuilder({ page }).analyze()
  expect(dashboardAccessibility.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([])
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible()
  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(accessibility.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([])
  await page.getByLabel('Message Forge').fill(requestText)
  await page.getByRole('button', { name: 'Submit request' }).click()

  await expect(page.locator('.assistant-answer')).toContainText('language model hasn’t been configured')
  await expect(page.locator('.assistant-answer')).toContainText('No deliverable was created')
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toHaveCount(0)
  await expect(page.getByText('Local task actions')).toBeVisible()
  await expect(page.locator('.plan-summary')).toContainText('1 ready for review · 1 waiting on earlier steps')
  await page.getByRole('button', { name: 'Dismiss notification' }).click()
  await page.screenshot({ path: 'screenshots/chat-ui-review/no-model-capability-message.png', fullPage: true })
  const planDetails = page.locator('.plan-details')
  await expect(planDetails).not.toHaveAttribute('open')
  await page.locator('.plan-summary').click()
  await expect(planDetails).toHaveAttribute('open', '')
  await expect(page.getByTitle(requestText)).toBeVisible()
  await expect(page.getByLabel('Task status: Draft')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open task history' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start a new task' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Local task progress' })).toContainText('Waiting for you')
  await page.getByText('What this step does').first().click()
  await expect(page.getByText('This adds only a local task title to Forge on this device. It does not create the requested document or contact an external service.').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Approve task:/ })).toHaveCount(2)
  await page.getByRole('button', { name: /Approve task:/ }).first().click()
  await expect(page.getByLabel('Task status: In progress')).toBeVisible()
  await expect(page.getByText('Approved for 10 minutes. The action has not run yet.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Run task:/ })).toBeVisible()
  await page.getByRole('button', { name: /Run task:/ }).click()
  await expect(page.getByText('Task created in Forge.')).toBeVisible()
  await expect(page.getByText('Done', { exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Local task progress' })).toContainText('1 of 2 tasks created')

  await page.getByRole('button', { name: 'Open task history' }).click()
  await page.getByRole('tab', { name: 'Plans' }).click()
  await expect(page.getByText(requestText)).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  const downloadReady = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON' }).click()
  const download = await downloadReady
  expect(download.suggestedFilename()).toMatch(/^forge-data-.*\.json$/)

  await page.getByRole('button', { name: 'Task history' }).click()
  await page.getByRole('tab', { name: 'Plans' }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  const savedPlan = page.getByRole('article').filter({ hasText: requestText })
  await savedPlan.getByRole('button', { name: 'Delete plan and linked local tasks' }).click()
  await expect(page.getByText('Plan and linked local tasks deleted. Generic activity entries were retained.')).toBeVisible()
  await page.getByRole('tab', { name: 'Activity' }).click()
  await expect(page.getByText('Details removed').first()).toBeVisible()
  await expect(page.getByText(requestText)).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('generated answer and draft are the result, with separate local tasks collapsed', async ({ page }) => {
  const requestText = 'Draft a short customer portal announcement and add a separate local task to review it.'
  const generatedPlan = {
    id: 'c0d2268e-0f1c-4d18-883f-0a1a2467d533',
    request: requestText,
    generationMode: 'ai',
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assistantOutput: {
      status: 'generated',
      answer: 'Here’s a ready-to-edit announcement draft for your customer portal launch.',
      deliverables: [{ title: 'Customer portal launch announcement', content: 'Meet your new customer portal\n\nYour account, orders, and support are now together in one simple place. Sign in today to take a look.' }],
      generatedAt: new Date().toISOString(),
    },
    steps: [{
      id: 'c0d2268e-0f1c-4d18-883f-0a1a2467d534',
      title: 'Add task: Review the announcement',
      detail: 'This adds only a local task title to Forge on this device.',
      kind: 'create_task',
      taskTitle: 'Review the announcement with the product team',
      status: 'pending',
      actionHash: 'test-action-hash',
      tool: 'Local task list',
      riskLevel: 'low',
      requiresApproval: false,
      dependsOn: [],
      expectedResult: 'A local task with this exact title.',
      checkpoint: 'Confirm this local task is useful.',
    }],
  }
  await page.route('**/api/capabilities', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ permissionModes: [], inputModes: ['text'], actionKinds: ['create_task'], modelConfigured: true, streaming: false }) }))
  await page.route('**/api/plans', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(generatedPlan) })
    : route.continue())

  await page.goto('/')
  await page.getByRole('button', { name: 'New task' }).first().click()
  await page.getByLabel('Message Forge').fill(requestText)
  await page.getByRole('button', { name: 'Ask Forge' }).click()
  await expect(page.locator('.assistant-answer')).toContainText('ready-to-edit announcement draft')
  await expect(page.getByLabel('Task status: Answer ready')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Customer portal launch announcement' })).toBeVisible()
  await expect(page.locator('.deliverable-richtext')).toContainText('Your account, orders, and support')
  await expect(page.getByRole('button', { name: 'Copy draft' })).toBeVisible()
  await expect(page.getByText('Local task actions')).toBeVisible()
  await expect(page.locator('.plan-details')).not.toHaveAttribute('open')
  await expect(page.getByText('Review the announcement with the product team')).toBeHidden()
  await page.getByRole('button', { name: 'Dismiss notification' }).click()

  await page.screenshot({ path: 'screenshots/chat-ui-review/generated-answer-ui-preview.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.getByRole('button', { name: /Open new task/ }).click()
  await page.getByLabel('Message Forge').fill(requestText)
  await page.getByRole('button', { name: 'Ask Forge' }).click()
  await expect(page.getByRole('heading', { name: 'Customer portal launch announcement' })).toBeVisible()
  const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
  await page.screenshot({ path: 'screenshots/chat-ui-review/generated-answer-ui-preview-mobile.png', fullPage: true })
})
