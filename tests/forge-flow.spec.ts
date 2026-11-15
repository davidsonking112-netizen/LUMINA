import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const requestText = `Browser flow check ${Date.now()}; review the generated local task`

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
  await page.getByRole('button', { name: 'Plan it' }).click()

  await expect(page.getByText('BASIC LOCAL DRAFT')).toBeVisible()
  await expect(page.getByTitle(requestText)).toBeVisible()
  await expect(page.getByLabel('Task status: Draft')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open task history' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start a new task' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Local task progress' })).toContainText('Waiting for you')
  await page.getByText('What this step does').first().click()
  await expect(page.getByText('Running this step only adds a task to Forge on this device. It won’t contact an external service.').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(2)
  await page.getByRole('button', { name: 'Approve' }).first().click()
  await expect(page.getByLabel('Task status: In progress')).toBeVisible()
  await expect(page.getByText('Approved for 10 minutes. The action has not run yet.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run task' })).toBeVisible()
  await page.getByRole('button', { name: 'Run task' }).click()
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
