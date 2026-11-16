import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const navigationItems = [
  ['Inbox', 'Inbox'],
  ['Projects', 'Projects'],
  ['Automations', 'Automations'],
  ['Memory', 'Memory'],
  ['Connected Apps', 'Connected Apps'],
  ['Files', 'Files'],
  ['Task history', 'Task history'],
  ['Settings', 'Settings'],
] as const

test('desktop navigation collapses, expands and opens each requested workspace screen', async ({ page }) => {
  await page.goto('/')
  const sidebar = page.getByLabel('Main navigation')
  await expect(sidebar).toHaveCSS('width', '244px')
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(sidebar).toHaveClass(/sidebar-collapsed/)
  await expect(sidebar).toHaveCSS('width', '72px')
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(sidebar).toHaveCSS('width', '244px')

  for (const [label, heading] of navigationItems) {
    await page.getByRole('button', { name: label }).click()
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    const accessibility = await new AxeBuilder({ page }).analyze()
    expect(accessibility.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([])
  }

  await page.getByRole('button', { name: 'Connected Apps' }).click()
  await expect(page.getByText('No apps connected', { exact: true })).toBeVisible()
  await expect(page.getByText('Not connected', { exact: true })).toHaveCount(4)
})

test('mobile sidebar and task-details rail open as drawers, close with Escape and fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const menuToggle = page.getByRole('button', { name: 'Open navigation' })
  await menuToggle.click()
  const sidebar = page.getByLabel('Main navigation')
  await expect(sidebar).toHaveClass(/sidebar-open/)
  await expect(page.locator('main.main-shell')).toHaveAttribute('aria-hidden', 'true')
  await expect(sidebar.getByRole('button', { name: 'Close navigation' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(sidebar.getByRole('button', { name: 'Settings' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(sidebar.getByRole('button', { name: 'Close navigation' })).toBeFocused()
  await page.getByRole('button', { name: 'Projects' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(sidebar).not.toHaveClass(/sidebar-open/)
  await expect(sidebar).toHaveAttribute('aria-hidden', 'true')
  await expect(menuToggle).toBeFocused()

  await page.keyboard.press('Control+k')
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible()
  await expect(page.getByLabel('Message Forge')).toBeFocused()
  await page.getByRole('button', { name: 'Open task details' }).click()
  const context = page.getByRole('dialog', { name: 'Task details' })
  await expect(context).toHaveClass(/context-open/)
  await expect(page.locator('header.topbar')).toHaveAttribute('aria-hidden', 'true')
  await expect(context.getByRole('button', { name: 'Close task details' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(context.getByRole('button', { name: 'View activity' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(context.getByRole('button', { name: 'Close task details' })).toBeFocused()
  await page.keyboard.press('Escape')
  const closedContext = page.locator('.right-rail')
  await expect(closedContext).not.toHaveClass(/context-open/)
  await expect(closedContext).toHaveAttribute('aria-hidden', 'true')
  await expect(page.getByRole('button', { name: 'Open task details' })).toBeFocused()

  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }))
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
})

test('Home quick starts prefill a request but wait for the user to submit it', async ({ page }) => {
  await page.goto('/')
  const prompt = 'Break my top priority this week into small next steps'
  await page.getByRole('button', { name: new RegExp(prompt) }).click()
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible()
  await expect(page.getByLabel('Message Forge')).toHaveValue(prompt)
  await expect(page.getByRole('button', { name: 'Submit request' })).toBeEnabled()
  await expect(page.getByText('BASIC LOCAL DRAFT')).toHaveCount(0)
})
