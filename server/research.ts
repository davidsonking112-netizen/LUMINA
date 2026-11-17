import { randomUUID } from 'node:crypto'
import type { ResearchReport, ResearchSource } from '../src/types.js'

const SEARCH_LIMIT = 5
const SOURCE_LIMIT = 3
const MAX_PAGE_CHARS = 6000
const REQUEST_TIMEOUT_MS = 12_000

function cleanText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2F;|&#47;/gi, '/')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeUrl(value: string) {
  const normalized = value.startsWith('//') ? `https:${value}` : value
  try { return decodeURIComponent(normalized) } catch { return normalized }
}

function decodeSearchResult(value: string) {
  try {
    const url = new URL(value)
    const encoded = url.searchParams.get('u')
    if (encoded?.startsWith('a1')) return Buffer.from(encoded.slice(2), 'base64').toString('utf8')
  } catch { /* keep the original URL */ }
  return value
}

function isPublicHttpUrl(value: string) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    const hostname = url.hostname.toLowerCase()
    if (hostname === 'localhost' || hostname === '::1' || hostname.endsWith('.localhost')) return false
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(hostname)) return false
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false
    return true
  } catch { return false }
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'User-Agent': 'LUMINA research reader/1.0 (+https://github.com/davidsonking112-netizen/LUMINA)' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

async function discover(question: string) {
  let html = ''
  try { html = await fetchText(`https://r.jina.ai/http://www.bing.com/search?q=${encodeURIComponent(question)}`) } catch {
    html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(question)}`)
  }
  const matches = [...html.matchAll(/\]\((https?:\/\/[^)\s]+)\)/gi)]
  const results: Array<{ url: string; title: string }> = []
  for (const match of matches) {
    const url = decodeSearchResult(decodeUrl(match[1]))
    if (!isPublicHttpUrl(url) || results.some((result) => result.url === url)) continue
    if (url.includes('bing.com/ck/a')) continue
    const before = html.slice(Math.max(0, match.index! - 180), match.index)
    const title = cleanText(before.split('\n').pop() ?? '').replace(/^\d+\.\s*/, '').replace(/^#+\s*/, '')
    results.push({ url, title: title || url })
    if (results.length >= SEARCH_LIMIT) break
  }
  return results
}

async function readSource(result: { url: string; title: string }): Promise<ResearchSource | null> {
  try {
    const html = await fetchText(result.url)
    const excerpt = cleanText(html).slice(0, MAX_PAGE_CHARS)
    if (excerpt.length < 80) return null
    return {
      id: result.url,
      title: result.title,
      url: result.url,
      publisher: new URL(result.url).hostname.replace(/^www\./, ''),
      accessedAt: new Date().toISOString(),
      excerpt,
      confidence: 'medium',
    }
  } catch { return null }
}

async function synthesize(question: string, sources: ResearchSource[]) {
  const apiKey = process.env.FORGE_LLM_API_KEY ?? process.env.OPENAI_API_KEY
  const model = process.env.FORGE_LLM_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5-mini'
  const baseUrl = (process.env.FORGE_LLM_BASE_URL ?? process.env.OPENAI_API_BASE)?.replace(/\/$/, '')
  if (process.env.FORGE_LLM_DISABLE === 'true' || !apiKey || !baseUrl) return undefined
  const endpoint = new URL(baseUrl)
  const allowLocalHttp = process.env.FORGE_LLM_ALLOW_INSECURE_LOCALHOST === 'true' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && allowLocalHttp)) throw new Error('The configured model endpoint must use HTTPS.')
  const context = sources.map((source, index) => `[${index + 1}] ${source.title}\nURL: ${source.url}\nExcerpt: ${source.excerpt}`).join('\n\n')
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.2, max_tokens: 3500, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: 'You are LUMINA Research. Answer only from the supplied web excerpts. Cite claims inline as [1], [2], etc. If sources disagree, say so. Do not invent facts, URLs, quotations, or citations. Return JSON only: {"answer":"...","assumptions":["..."]}. Keep the answer concise but useful.' },
      { role: 'user', content: `Question: ${question}\n\nWeb sources:\n${context}` },
    ] }),
  })
  if (!response.ok) throw new Error(`The configured model returned HTTP ${response.status}.`)
  const body = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> }
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new Error('The configured model returned an empty research answer.')
  const parsed = JSON.parse(content) as { answer?: string; assumptions?: string[] }
  if (!parsed.answer?.trim()) throw new Error('The configured model returned an unsupported research answer.')
  return { answer: parsed.answer.trim(), assumptions: (parsed.assumptions ?? []).slice(0, 4) }
}

export async function researchWeb(question: string): Promise<ResearchReport> {
  const results = await discover(question)
  const sources = (await Promise.all(results.slice(0, SOURCE_LIMIT + 2).map(readSource)))
    .filter((source): source is ResearchSource => Boolean(source)).slice(0, SOURCE_LIMIT)
  if (!sources.length) throw new Error('No readable web sources were found for that question.')
  const generated = await synthesize(question, sources)
  const answer = generated?.answer ?? `I found ${sources.length} sources. Review the excerpts below for a source-grounded answer.\n\n${sources.map((source, index) => `[${index + 1}] ${source.title}: ${source.excerpt.slice(0, 500)}…`).join('\n\n')}`
  return { id: randomUUID(), question, answer, sources, assumptions: generated?.assumptions ?? ['The answer was not synthesized because no LUMINA model is configured.'], createdAt: new Date().toISOString() }
}
