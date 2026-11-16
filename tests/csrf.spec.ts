import { expect, test } from '@playwright/test'

const requestText = `Create a local task to check the CSRF boundary ${Date.now()}`

test('hostile-origin forms cannot approve or execute a task through the local API', async ({ page, request }) => {
  const create = await request.post('http://127.0.0.1:5173/api/plans', {
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:5173',
      'Sec-Fetch-Site': 'same-origin',
      'X-Forge-Request': '1',
    },
    data: { request: requestText },
  })
  expect(create.ok()).toBeTruthy()
  const plan = await create.json() as { id: string; steps: Array<{ id: string; status: string }> }
  const stepId = plan.steps[0].id
  const attempts: Array<{ url: string; method: string }> = []
  const responses: Array<{ url: string; status: number; origin?: string; forgeHeader?: string }> = []
  const failures: Array<{ url: string; error: string }> = []
  page.context().on('request', (request) => {
    if (request.url().includes(`/api/plans/${plan.id}/steps/${stepId}/`)) attempts.push({ url: request.url(), method: request.method() })
  })
  page.context().on('response', (response) => {
    if (response.url().includes(`/api/plans/${plan.id}/steps/${stepId}/`)) {
      const headers = response.request().headers()
      responses.push({ url: response.url(), status: response.status(), origin: headers.origin, forgeHeader: headers['x-forge-request'] })
    }
  })
  page.context().on('requestfailed', (request) => {
    if (request.url().includes(`/api/plans/${plan.id}/steps/${stepId}/`)) failures.push({ url: request.url(), error: request.failure()?.errorText ?? 'unknown' })
  })

  const hostileOrigin = 'http://localhost:5174'
  await page.route(`${hostileOrigin}/**`, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><iframe name="sink" hidden></iframe>
      <form id="approve" method="POST" target="sink" action="http://localhost:8787/api/plans/${plan.id}/steps/${stepId}/approve"><input name="approve" value="true"></form>
      <form id="execute" method="POST" target="sink" action="http://localhost:8787/api/plans/${plan.id}/steps/${stepId}/execute"><input name="execute" value="true"></form>`,
  }))
  await page.goto(`${hostileOrigin}/attack`)
  await page.evaluate(() => (document.getElementById('approve') as HTMLFormElement).submit())
  await page.waitForTimeout(250)
  await page.evaluate(() => (document.getElementById('execute') as HTMLFormElement).submit())
  await page.waitForTimeout(500)

  expect(failures).toEqual([])
  expect(attempts.filter((item) => item.url.endsWith('/approve')).map((item) => item.method)).toEqual(['POST'])
  expect(attempts.filter((item) => item.url.endsWith('/execute')).map((item) => item.method)).toEqual(['POST'])
  expect(responses.filter((item) => item.url.endsWith('/approve')).map((item) => item.status)).toEqual([403])
  expect(responses.filter((item) => item.url.endsWith('/execute')).map((item) => item.status)).toEqual([403])
  expect(responses.every((item) => item.origin === hostileOrigin && !item.forgeHeader)).toBe(true)

  const current = await request.get(`http://127.0.0.1:5173/api/plans/${plan.id}`)
  expect((await current.json()).steps[0].status).toBe('pending')
  const tasks = await request.get('http://127.0.0.1:5173/api/tasks')
  expect(await tasks.json()).toEqual([])
  await request.delete(`http://127.0.0.1:5173/api/plans/${plan.id}`, {
    headers: { Origin: 'http://127.0.0.1:5173', 'Sec-Fetch-Site': 'same-origin', 'X-Forge-Request': '1' },
  })
})
