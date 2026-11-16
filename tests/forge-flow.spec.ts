import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const requestText = 'Create local tasks to review the customer portal launch; collect feedback from support.'

async function markGeneratedFixture(page: Page) {
  await page.evaluate(() => {
    const badge = document.createElement('div')
    badge.setAttribute('role', 'note')
    badge.textContent = 'TEST FIXTURE · MOCKED MODEL RESPONSE · NOT LIVE AI'
    badge.style.cssText = 'padding:7px 12px;border-bottom:1px solid #d9bc84;background:#fff1d3;color:#684a22;text-align:center;font:800 10px/1.3 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em'
    document.body.insertBefore(badge, document.body.firstChild)
  })
}

test('plan review, exact approval, task execution, export and deletion history work end to end', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome back, Davids' })).toBeVisible()
  const dashboardAccessibility = await new AxeBuilder({ page }).analyze()
  expect(dashboardAccessibility.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([])
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible()
  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(accessibility.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([])
  await expect(page.locator('#composer-context-note')).toContainText('Each submission starts a separate request; include any context it needs.')
  await page.screenshot({ path: 'screenshots/task-history-actions-20261116/after-empty-chat.png', fullPage: true })
  await page.getByLabel('Message Forge').fill(requestText)
  await page.getByRole('button', { name: 'Submit request' }).click()

  await expect(page.locator('.assistant-answer')).toContainText('language model hasn’t been configured')
  await expect(page.locator('.assistant-answer')).toContainText('No deliverable was created')
  await expect(page.locator('.assistant-answer')).toContainText('Task History')
  await expect(page.getByText('No answer generated. Local task titles were saved separately for review.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toHaveCount(0)
  await expect(page.getByText('Local task actions')).toHaveCount(0)
  await expect(page.locator('.plan-details')).toHaveCount(0)
  await expect(page.locator('.right-rail')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open task details' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Dismiss notification' }).click()
  await page.screenshot({ path: 'screenshots/task-history-actions-20261116/chat-no-model-request.png', fullPage: true })
  await expect(page.locator('.conversation-kicker')).toContainText('STANDALONE REQUEST')
  await expect(page.locator('#composer-context-note')).toContainText('Each send starts a separate request; the one above isn’t included.')
  await expect(page.getByTitle(requestText)).toBeVisible()
  await expect(page.getByLabel('Task status: Draft')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open task history' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start a new task' })).toBeVisible()

  await page.getByRole('button', { name: 'Open task history' }).click()
  const savedPlan = page.locator('.plan-history-card').filter({ hasText: requestText })
  const planDetails = savedPlan.locator('.plan-details')
  await expect(planDetails).toHaveAttribute('open', '')
  await expect(planDetails.locator('.plan-summary')).toContainText('1 ready for review · 1 waiting on earlier steps')
  await page.screenshot({ path: 'screenshots/task-history-actions-20261116/desktop-history-pending-approvals.png', fullPage: true })
  await page.getByText('What this step does').first().click()
  await expect(page.getByText('This adds only a local task title to Forge on this device. It does not create the requested document or contact an external service.').first()).toBeVisible()
  await expect(savedPlan.getByRole('button', { name: /Approve task:/ })).toHaveCount(2)
  await savedPlan.getByRole('button', { name: /Approve task:/ }).first().click()
  await expect(page.getByText('Approved for 10 minutes. The action has not run yet.')).toBeVisible()
  await expect(savedPlan.getByRole('button', { name: /Run task:/ })).toBeVisible()
  await savedPlan.getByRole('button', { name: /Run task:/ }).click()
  await expect(page.getByText('Task created in Forge.')).toBeVisible()
  await expect(savedPlan.getByText('Done', { exact: true })).toBeVisible()
  await expect(savedPlan.getByRole('list', { name: 'Local task progress' })).toContainText('1 of 2 tasks created')

  await page.getByRole('button', { name: 'Task history' }).click()
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
  const planToDelete = page.getByRole('article').filter({ hasText: requestText })
  await planToDelete.getByRole('button', { name: 'Delete plan and linked local tasks' }).click()
  await expect(page.getByText('Plan and linked local tasks deleted. Generic activity entries were retained.')).toBeVisible()
  await page.getByRole('tab', { name: 'Activity' }).click()
  await expect(page.getByText('Details removed').first()).toBeVisible()
  await expect(page.getByText(requestText)).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('mobile Chat stays clear of task controls while approvals remain reachable in Task History', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'New task' }).first().click()
  await page.getByLabel('Message Forge').fill(requestText)
  await page.getByRole('button', { name: 'Submit request' }).click()

  await expect(page.locator('.assistant-answer')).toContainText('language model hasn’t been configured')
  await expect(page.locator('#composer-disclosure')).toContainText('Submitted requests are saved locally')
  await expect(page.locator('.conversation-kicker')).toContainText('STANDALONE REQUEST')
  await expect(page.locator('.plan-details')).toHaveCount(0)
  await expect(page.locator('.right-rail')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open task details' })).toHaveCount(0)
  await expect(page.locator('.composer')).toHaveCSS('position', 'sticky')
  await page.getByRole('button', { name: 'Dismiss notification' }).click()
  await page.screenshot({ path: 'screenshots/task-history-actions-20261116/mobile-chat-no-task-panel.png', fullPage: true })

  await page.getByRole('button', { name: 'Open task history' }).click()
  const savedPlan = page.locator('.plan-history-card').filter({ hasText: requestText })
  await expect(savedPlan.locator('.plan-details')).toHaveAttribute('open', '')
  await expect(savedPlan.getByRole('button', { name: /Approve task:/ })).toHaveCount(2)
  const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
  await page.screenshot({ path: 'screenshots/task-history-actions-20261116/mobile-history-pending-approvals.png', fullPage: true })

  await savedPlan.getByRole('button', { name: /Approve task:/ }).first().click()
  await expect(page.getByText('Approved for 10 minutes. The action has not run yet.')).toBeVisible()
  await expect(savedPlan.getByRole('button', { name: /Run task:/ })).toBeVisible()
  await expect(page.getByText('Task created in Forge.')).toHaveCount(0)
})

test('generated answer stays in Chat while local task review lives in Task History', async ({ page }) => {
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
  await expect(page.locator('#composer-disclosure')).toContainText('Your prompt is sent to the configured external AI provider')
  await expect(page.locator('#composer-context-note')).toContainText('Each send starts a separate request; the one above isn’t included.')
  await expect(page.locator('.assistant-answer')).toContainText('ready-to-edit announcement draft')
  await expect(page.getByLabel('Task status: Answer ready')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Customer portal launch announcement' })).toBeVisible()
  await expect(page.locator('.deliverable-richtext')).toContainText('Your account, orders, and support')
  await expect(page.getByRole('button', { name: 'Copy draft' })).toBeVisible()
  await expect(page.getByText('Local task actions')).toHaveCount(0)
  await expect(page.locator('.plan-details')).toHaveCount(0)
  await expect(page.getByText('Review the announcement with the product team')).toHaveCount(0)
  await page.getByRole('button', { name: 'Dismiss notification' }).click()

  await markGeneratedFixture(page)
  await page.screenshot({ path: 'screenshots/task-history-actions-20261116/desktop-generated-answer-chat.png', fullPage: true })
  await page.getByRole('button', { name: 'Open task history' }).click()
  const generatedPlanHistory = page.locator('.plan-history-card').filter({ hasText: requestText })
  await expect(generatedPlanHistory.getByRole('button', { name: /Approve task:/ })).toBeVisible()
  await expect(generatedPlanHistory.getByLabel('Task title for step 1')).toHaveValue('Review the announcement with the product team')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.getByRole('button', { name: /Open new task/ }).click()
  await page.getByLabel('Message Forge').fill(requestText)
  await page.getByRole('button', { name: 'Ask Forge' }).click()
  await expect(page.getByRole('heading', { name: 'Customer portal launch announcement' })).toBeVisible()
  const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
  await markGeneratedFixture(page)
  await expect(page.locator('.plan-details')).toHaveCount(0)
  await page.screenshot({ path: 'screenshots/task-history-actions-20261116/mobile-generated-answer-chat.png', fullPage: true })
})

test('a no-model question is saved locally with honest feedback', async ({ page }) => {
  const requestText = 'What is the capital of Ghana?'
  await page.goto('/')
  await page.getByRole('button', { name: 'New task' }).first().click()
  await expect(page.locator('#composer-disclosure')).toContainText('Submitted requests are saved locally')
  await expect(page.locator('#composer-context-note')).toContainText('Each submission starts a separate request; include any context it needs.')
  await page.getByLabel('Message Forge').fill(requestText)
  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByText('No answer generated. Your request was saved locally; no content or task was created.')).toBeVisible()
  await expect(page.locator('.assistant-answer')).toContainText('No content or task was created')
  await page.getByRole('button', { name: 'Task history', exact: true }).click()
  await page.getByRole('tab', { name: 'Plans' }).click()
  await expect(page.getByText(requestText)).toBeVisible()
})
