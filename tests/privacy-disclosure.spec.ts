import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

const csrfAppUrl = process.env.CSRF_APP_URL?.replace(/\/$/, '')
if (!csrfAppUrl) throw new Error('The privacy disclosure browser regression requires the isolated app endpoint.')
const csrfAppOrigin = new URL(csrfAppUrl).origin
const trustedHeaders = {
  Origin: csrfAppOrigin,
  'Sec-Fetch-Site': 'same-origin',
  'X-Forge-Request': '1',
}

test('Settings explains replay-protection data retained when clearing workspace records', async ({ page }) => {
  let clearRequests = 0
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && new URL(request.url()).pathname === '/api/data') clearRequests += 1
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Manage local data' })).toBeVisible()
  await expect(page.getByText(/Clear removes those records and activity content, resets permission mode to approval, and retains request UUIDs and creation\/deletion timestamps plus an opaque workspace-generation marker and its update timestamp for replay protection; request text, hashes, and plan links are removed\./)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear workspace data' })).toBeVisible()

  const [dialog] = await Promise.all([
    page.waitForEvent('dialog').then(async (dialog) => {
      await dialog.dismiss()
      return dialog
    }),
    page.getByRole('button', { name: 'Clear workspace data' }).click(),
  ])
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toContain('Permission mode resets to approval')
  expect(dialog.message()).toContain('Replay protection retains request UUIDs and creation/deletion timestamps, plus an opaque workspace-generation marker and its update timestamp')
  expect(dialog.message()).toContain('request text, hashes and plan links are removed')

  expect(clearRequests).toBe(0)
})

test('single-plan deletion explains replay metadata retained before and after deletion', async ({ page, request }) => {
  const requestText = 'Create a local task to review the deletion disclosure.'
  const requestId = randomUUID()
  const create = await request.post(`${csrfAppUrl}/api/plans`, {
    headers: { 'Content-Type': 'application/json', ...trustedHeaders },
    data: { request: requestText, requestId },
  })
  expect(create.status()).toBe(201)
  const plan = await create.json() as { id: string }

  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Task history', exact: true }).click()
    await page.getByRole('tab', { name: 'Plans' }).click()
    const planCard = page.locator('.plan-history-card').filter({ hasText: requestText })
    await expect(planCard).toBeVisible()
    const deleteButton = planCard.getByRole('button', { name: 'Delete plan and linked local tasks' })

    const [dismissedDialog] = await Promise.all([
      page.waitForEvent('dialog').then(async (dialog) => {
        await dialog.dismiss()
        return dialog
      }),
      deleteButton.click(),
    ])
    expect(dismissedDialog.type()).toBe('confirm')
    expect(dismissedDialog.message()).toContain('Replay protection retains this request’s UUID and creation/deletion timestamps')
    expect(dismissedDialog.message()).toContain('the request hash and plan link are removed')
    expect(dismissedDialog.message()).toContain('generic approval and outcome entries remain in Activity')
    await expect(planCard).toBeVisible()

    const [acceptedDialog] = await Promise.all([
      page.waitForEvent('dialog').then(async (dialog) => {
        await dialog.accept()
        return dialog
      }),
      deleteButton.click(),
    ])
    expect(acceptedDialog.type()).toBe('confirm')
    await expect(page.getByText(/Plan and linked local tasks deleted\. Generic Activity entries and this request’s UUID\/creation\/deletion timestamps remain/)).toBeVisible()
    await expect(page.locator('.plan-history-card').filter({ hasText: requestText })).toHaveCount(0)
    expect((await request.get(`${csrfAppUrl}/api/plans/${plan.id}`)).status()).toBe(404)
  } finally {
    await request.delete(`${csrfAppUrl}/api/plans/${plan.id}`, { headers: trustedHeaders }).catch(() => undefined)
  }
})
