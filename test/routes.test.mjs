// Hermetic test for the settings routes: mounts them on a throwaway HTTP server,
// points DSH_HOME at a temp directory so the real settings file is untouched,
// and deliberately leaves the token unreadable so no live kernel is contacted.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'siyuan-notes-'))
process.env.DSH_HOME = home
process.env.SIYUAN_TOKEN = ''
process.env.SIYUAN_CONF = ''

const { __internal } = await import('../index.js')

const row = {
  baseUrl: 'http://127.0.0.1:6806',
  tokenFile: join(home, 'no-such-conf.json'),
  notebook: '',
  timeoutMs: 20000,
}

const routes = __internal.makeRoutes(row)
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  const route = routes.find((candidate) => candidate.path === path)
  if (!route) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('no route')
    return
  }
  await route.handler(req, res)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

async function call(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: JSON.parse(text) }
}

try {
  assert.equal(__internal.settingsPath(), join(home, 'siyuan-notes', 'settings.json'))

  const initial = await call('GET', '/api/siyuan-notes/state')
  assert.equal(initial.status, 200)
  assert.deepEqual(initial.body.overrides, [])
  assert.equal(initial.body.settings.notebook, '')
  assert.equal(initial.body.row.tokenFile, row.tokenFile)
  assert.equal(initial.body.token.ok, false)
  assert.equal(initial.body.kernel.ok, false)
  assert.equal(initial.body.notebook.ok, false)
  // No token means no connection, so the page gets an actionable onboarding hint
  // instead of a bare error.
  assert.equal(typeof initial.body.hint, 'string')
  assert.ok(initial.body.hint.length > 0)
  assert.equal(typeof initial.body.app.found, 'boolean')
  assert.equal(initial.body.recommendation.ok, false)

  const badUrl = await call('POST', '/api/siyuan-notes/settings', { baseUrl: 'ftp://nope' })
  assert.equal(badUrl.status, 400)
  assert.match(badUrl.body.error, /http/)

  const badTimeout = await call('POST', '/api/siyuan-notes/settings', { timeoutMs: 10 })
  assert.equal(badTimeout.status, 400)

  const empty = await call('POST', '/api/siyuan-notes/settings', {})
  assert.equal(empty.status, 400)

  const saved = await call('POST', '/api/siyuan-notes/settings', {
    notebook: '20261030080350-tzt4pwi',
    timeoutMs: '45000',
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.settings.notebook, '20261030080350-tzt4pwi')
  assert.equal(saved.body.settings.timeoutMs, 45000)
  assert.deepEqual(saved.body.overrides.sort(), ['notebook', 'timeoutMs'])

  const onDisk = JSON.parse(readFileSync(join(home, 'siyuan-notes', 'settings.json'), 'utf8'))
  assert.equal(onDisk.notebook, '20261030080350-tzt4pwi')

  // Values from the file win over the bundle row.
  const reread = await call('GET', '/api/siyuan-notes/state')
  assert.equal(reread.body.settings.notebook, '20261030080350-tzt4pwi')
  assert.equal(reread.body.row.notebook, '')

  // The pre-0.3 field name still lands on `notebook`.
  const legacy = await call('POST', '/api/siyuan-notes/settings', { defaultNotebook: '20261008113024-3u3eikl' })
  assert.equal(legacy.status, 200)
  assert.equal(legacy.body.settings.notebook, '20261008113024-3u3eikl')

  // An empty string drops the override and falls back to the row.
  const cleared = await call('POST', '/api/siyuan-notes/settings', { notebook: '' })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.body.settings.notebook, '')
  assert.ok(!cleared.body.overrides.includes('notebook'))

  // Same rule for connection fields: "" means "use the deployment default".
  const badPort = await call('POST', '/api/siyuan-notes/settings', { baseUrl: 'http://127.0.0.1:6999' })
  assert.equal(badPort.body.settings.baseUrl, 'http://127.0.0.1:6999')
  const portCleared = await call('POST', '/api/siyuan-notes/settings', { baseUrl: '' })
  assert.equal(portCleared.status, 200)
  assert.equal(portCleared.body.settings.baseUrl, row.baseUrl)
  assert.ok(!portCleared.body.overrides.includes('baseUrl'))

  const badJson = await fetch(base + '/api/siyuan-notes/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  })
  assert.equal(badJson.status, 400)

  const wrongMethod = await call('GET', '/api/siyuan-notes/settings')
  assert.equal(wrongMethod.status, 405)

  const reset = await call('POST', '/api/siyuan-notes/settings', { reset: true })
  assert.equal(reset.status, 200)
  assert.deepEqual(reset.body.overrides, [])

  // Ranking: the notebook written to most recently wins; without recency data an
  // inbox-style name outranks a big library, and the reason stays explainable.
  const rankingBooks = [
    { id: 'a', name: '工作', closed: false, docCount: 3 },
    { id: 'b', name: '收集箱', closed: false, docCount: 4 },
    { id: 'c', name: '学习', closed: false, docCount: 402 },
    { id: 'd', name: '已关闭', closed: true, docCount: 9 },
  ]
  const openBooks = rankingBooks.filter((book) => !book.closed)
  const byRecency = __internal.rankNotebooks(openBooks, new Map([['a', '20261126020119'], ['b', '20260101000000']]))
  assert.equal(byRecency[0].id, 'a')
  assert.match(byRecency[0].reason, /最近有写入/)
  assert.equal(byRecency.length, 3)
  const byName = __internal.rankNotebooks(openBooks, new Map())
  assert.equal(byName[0].name, '收集箱')
  assert.match(byName[0].reason, /收集箱/)
  assert.ok(__internal.startSiYuanHint('').includes('启动'))
  assert.equal(typeof __internal.discoverSiYuanApp(), 'string')

  console.log('routes.test.mjs OK')
} finally {
  server.close()
  rmSync(home, { recursive: true, force: true })
}
