/**
 * SiYuan (思源笔记) tool set for DeepSeek Harness.
 *
 * Registers a small, curated set of write-oriented tools that talk to the local
 * SiYuan kernel over its REST API (`/api/*`) with the workspace API token.
 * The token is read from `tokenFile` at call time and never printed, logged, or
 * returned in tool output.
 *
 * The whole notebook is writable: documents may be created at any path inside
 * the target notebook, and any document or block id can be appended to or
 * rewritten. There is no confined sub-folder.
 *
 * Settings live in two layers:
 *   1. the bundle row config (`cordis.patch.yml`) — deployment defaults;
 *   2. `<DSH_HOME>/siyuan-notes/settings.json` — this device's per-user values,
 *      written by the Settings page this plugin contributes to the Web UI. The
 *      page only asks for the target notebook; connection details come from the
 *      row config or are discovered automatically (SIYUAN_TOKEN, SIYUAN_CONF,
 *      `~/SiYuan/<workspace>/conf/conf.json`).
 * The file wins over the bundle row, so users can retarget the notebook per
 * device without editing profile YAML.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'siyuan-notes-for-dsh'
export const inject = ['tools']

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:6806',
  tokenFile: '',
  notebook: '',
  defaultDocId: '',
  timeoutMs: 20000,
}

/** Fields the Settings page may persist; anything else in the file is ignored. */
const EDITABLE = ['notebook', 'baseUrl', 'tokenFile', 'defaultDocId', 'timeoutMs']

const ROUTES = {
  state: '/api/siyuan-notes/state',
  settings: '/api/siyuan-notes/settings',
}

// ---------------------------------------------------------------------------
// Configuration layers
// ---------------------------------------------------------------------------

function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const baseUrl = String(input.baseUrl ?? DEFAULTS.baseUrl).trim().replace(/\/+$/, '')
  const timeout = Number(input.timeoutMs)
  return {
    baseUrl: baseUrl || DEFAULTS.baseUrl,
    tokenFile: String(input.tokenFile ?? DEFAULTS.tokenFile).trim(),
    // `defaultNotebook` is the pre-0.3 name, still accepted from older settings files.
    notebook: String(input.notebook ?? input.defaultNotebook ?? DEFAULTS.notebook).trim(),
    defaultDocId: String(input.defaultDocId ?? DEFAULTS.defaultDocId).trim(),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 120000) : DEFAULTS.timeoutMs,
  }
}

function settingsDir() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME.trim() : join(homedir(), '.dsh')
  return join(home, 'siyuan-notes')
}

function settingsPath() {
  return join(settingsDir(), 'settings.json')
}

/** User overrides saved by the Settings page; `{}` when absent or unreadable. */
function readSettingsFile() {
  let text
  try {
    text = readFileSync(settingsPath(), 'utf8')
  } catch {
    return {}
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const cleaned = {}
  for (const key of EDITABLE) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim() !== '') cleaned[key] = value.trim()
    else if (key === 'timeoutMs' && Number.isFinite(Number(value)) && Number(value) > 0) cleaned.timeoutMs = Number(value)
  }
  return cleaned
}

/** Merge the bundle row with this device's overrides; overrides win. */
function resolveConfig(rawConfig) {
  const row = normalizeConfig(rawConfig)
  const saved = readSettingsFile()
  return { cfg: normalizeConfig({ ...row, ...saved }), row, saved }
}

/** Persist one patch of overrides; an empty string removes that override. */
function saveSettings(patch) {
  const next = { ...readSettingsFile() }
  for (const key of EDITABLE) {
    if (!Object.hasOwn(patch, key)) continue
    const value = patch[key]
    if (value === null || value === '') {
      delete next[key]
      continue
    }
    next[key] = typeof value === 'string' ? value.trim() : value
  }
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  return next
}

// ---------------------------------------------------------------------------
// SiYuan kernel access
// ---------------------------------------------------------------------------

/** Candidate `conf/conf.json` paths: explicit setting or row, env, then discovered workspaces. */
function candidateTokenFiles(cfg) {
  const files = []
  const push = (value) => {
    const path = String(value ?? '').trim()
    if (path && !files.includes(path)) files.push(path)
  }
  push(cfg.tokenFile)
  push(process.env.SIYUAN_CONF)
  for (const root of [join(homedir(), 'SiYuan'), join(homedir(), 'Documents', 'SiYuan')]) {
    let entries
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) push(join(root, entry.name, 'conf', 'conf.json'))
    }
  }
  return files
}

function tokenFromFile(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    throw new Error(`读不到思源配置文件 ${file}`)
  }
  let conf
  try {
    conf = JSON.parse(text)
  } catch {
    throw new Error(`思源配置文件 ${file} 不是合法 JSON`)
  }
  const token = conf?.api?.token
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`配置 ${file} 里没有 api.token（请在思源「设置 → 关于」里打开 API token）`)
  }
  return token
}

/**
 * The API token, resolved at call time and never returned to the model:
 * `SIYUAN_TOKEN` → the configured `conf/conf.json` → discoverable workspaces.
 */
function readToken(cfg) {
  const fromEnv = String(process.env.SIYUAN_TOKEN ?? '').trim()
  if (fromEnv) return fromEnv
  const files = candidateTokenFiles(cfg)
  if (files.length === 0) {
    throw new Error(
      '还没有找到思源的 API token：请设置 SIYUAN_TOKEN 环境变量，或在插件配置里指定 tokenFile（工作区的 conf/conf.json）。',
    )
  }
  const failures = []
  for (const file of files) {
    try {
      return tokenFromFile(file)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(`读不到思源的 API token：${failures.join('；')}。`)
}

async function callKernel(cfg, route, payload, signal) {
  const url = cfg.baseUrl + route
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('timeout'))
  }, cfg.timeoutMs)
  const forwardAbort = () => controller.abort(signal?.reason ?? new Error('aborted'))
  if (signal) {
    if (signal.aborted) forwardAbort()
    else signal.addEventListener('abort', forwardAbort, { once: true })
  }
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${readToken(cfg)}`,
      },
      body: JSON.stringify(payload ?? {}),
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) throw new Error(`思源内核在 ${cfg.timeoutMs} ms 内没有响应（${cfg.baseUrl}）。`)
    if (signal?.aborted) throw error
    throw new Error(`连不上思源内核（${cfg.baseUrl}）：${startSiYuanHint(discoverSiYuanApp())}`)
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', forwardAbort)
  }
  if (!response.ok) throw new Error(`思源内核返回 HTTP ${response.status}（${route}）。`)
  let body
  try {
    body = await response.json()
  } catch {
    throw new Error(`思源内核返回了无法解析的响应（${route}）。`)
  }
  if (!body || typeof body !== 'object') throw new Error(`思源内核返回了空响应（${route}）。`)
  if (body.code !== 0) {
    const message = typeof body.msg === 'string' && body.msg ? body.msg : `code ${body.code}`
    if (/metadata is not ready/i.test(message)) {
      throw new Error(
        '思源还没给这个笔记本建好索引（document metadata is not ready）：刚新建的笔记本通常要等几秒。稍后重试；一直失败就在思源界面里打开一次该笔记本，或在已有笔记本里写。',
      )
    }
    throw new Error(`思源拒绝了这次调用：${message}`)
  }
  return body.data
}

async function listNotebooks(cfg, signal) {
  const data = await callKernel(cfg, '/api/notebook/lsNotebooks', {}, signal)
  const books = Array.isArray(data?.notebooks) ? data.notebooks : []
  return books.map((book) => ({
    id: String(book.id ?? ''),
    name: String(book.name ?? ''),
    closed: Boolean(book.closed),
    docCount: Number(book.subFileCount ?? 0),
  }))
}

// `lsNotebooks` only fills `subFileCount` on some builds, so the settings page
// asks the index for real document counts. Purely cosmetic: a failure here must
// not break the page.
async function fetchDocCounts(cfg) {
  const rows = await callKernel(cfg, '/api/query/sql', {
    stmt: "SELECT box, COUNT(*) AS n FROM blocks WHERE type = 'd' GROUP BY box",
  })
  const counts = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    counts.set(String(row?.box ?? ''), Number(row?.n ?? 0))
  }
  return counts
}

// Where SiYuan's desktop app lives, so the "please start SiYuan" message can
// point at something clickable instead of describing it. Existence check only:
// the plugin never launches applications.
const SIYUAN_APP_CANDIDATES = [
  'D:/software/siyuan/SiYuan.exe',
  'C:/Program Files/SiYuan/SiYuan.exe',
  'C:/Program Files (x86)/SiYuan/SiYuan.exe',
]

function discoverSiYuanApp() {
  const fromEnv = String(process.env.SIYUAN_EXE ?? '').trim()
  const candidates = [
    fromEnv,
    ...SIYUAN_APP_CANDIDATES,
    join(homedir(), 'AppData', 'Local', 'Programs', 'SiYuan', 'SiYuan.exe'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // ignore unreadable candidates
    }
  }
  return ''
}

function startSiYuanHint(appPath) {
  const start = appPath
    ? `请先启动思源笔记（${appPath}）`
    : '请先启动思源笔记桌面应用'
  return `${start}，启动后在设置页点「重新检测」；若改过端口，也核对一下内核地址。`
}

// Name heuristics used only to explain a suggestion, never to override the user.
const NOTEBOOK_NAME_HINTS = [
  { pattern: /收集|速记|随手|inbox/i, label: '名字像收集箱', bonus: 25 },
  { pattern: /日常|日记|daily/i, label: '名字像日常记录', bonus: 12 },
  { pattern: /学习|笔记|notes|知识/i, label: '名字像笔记库', bonus: 6 },
]

function formatDocDate(stamp) {
  const value = String(stamp ?? '')
  if (!/^\d{8}/.test(value)) return ''
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

/**
 * Pure ranking used by the Settings page and by the "no target yet" tool error.
 * Signals, strongest first: a document written recently, a collection-inbox
 * style name, then the sheer number of documents. `lastWrite` maps notebook id
 * to its newest document timestamp (may be empty; ranking still works).
 */
function rankNotebooks(openBooks, lastWrite) {
  const ranked = openBooks
    .map((book) => {
      const last = String(lastWrite.get(book.id) ?? '')
      const hints = NOTEBOOK_NAME_HINTS.filter((hint) => hint.pattern.test(book.name))
      const score =
        hints.reduce((total, hint) => total + hint.bonus, 0) + Math.min(20, Math.log2(1 + book.docCount) * 3)
      return { book, last, hints, score }
    })
    .sort((a, b) => b.score - a.score || a.book.name.localeCompare(b.book.name))
  const newest = [...ranked].sort((a, b) => String(b.last).localeCompare(String(a.last)))[0]
  if (newest && newest.last) {
    ranked.splice(ranked.indexOf(newest), 1)
    ranked.unshift(newest)
  }
  return ranked.map((entry, index) => {
    const reasons = []
    if (index === 0 && entry.last) reasons.push(`最近有写入（${formatDocDate(entry.last)}）`)
    for (const hint of entry.hints) reasons.push(hint.label)
    if (entry.book.docCount > 0) reasons.push(`${entry.book.docCount} 篇文档`)
    return {
      id: entry.book.id,
      name: entry.book.name,
      docCount: entry.book.docCount,
      reason: reasons[0] ?? '还没写过内容',
      reasons,
    }
  })
}

async function recommendNotebook(cfg, books) {
  const open = books.filter((book) => !book.closed)
  if (open.length === 0) return { ok: false, error: '没有打开的笔记本' }
  const lastWrite = new Map()
  try {
    const rows = await callKernel(cfg, '/api/query/sql', {
      stmt: "SELECT box, MAX(updated) AS t FROM blocks WHERE type = 'd' GROUP BY box",
    })
    for (const row of Array.isArray(rows) ? rows : []) {
      lastWrite.set(String(row?.box ?? ''), String(row?.t ?? ''))
    }
  } catch {
    // Recency is a bonus signal; a kernel that cannot answer it still gets ranked.
  }
  const candidates = rankNotebooks(open, lastWrite)
  const top = candidates[0]
  return { ok: true, id: top.id, name: top.name, reason: top.reason, candidates: candidates.slice(0, 5) }
}

function describeBooks(books) {
  const open = books.filter((book) => !book.closed)
  if (open.length === 0) return '（当前没有打开的笔记本）'
  return open.map((book) => `${book.name}（${book.id}）`).join('、')
}

async function resolveNotebook(cfg, wanted, signal) {
  const books = await listNotebooks(cfg, signal)
  const open = books.filter((book) => !book.closed)
  const target = String(wanted ?? '').trim() || cfg.notebook
  if (target) {
    const hit = open.find((book) => book.id === target) ?? open.find((book) => book.name === target)
    if (hit) return hit
    throw new Error(`找不到笔记本「${target}」。可用的有：${describeBooks(books)}`)
  }
  if (open.length === 1) return open[0]
  let advice = '请先指定 notebook，或在 DSH 设置 → 思源笔记里绑定目标笔记本。'
  try {
    const recommendation = await recommendNotebook(cfg, books)
    if (recommendation.ok) {
      advice = `建议绑定「${recommendation.name}」（${recommendation.reason}）：在 DSH 设置 → 思源笔记里一键绑定，或这次调用直接传 notebook:"${recommendation.name}"。`
    }
  } catch {
    // The recommendation is advisory; fall back to the generic advice.
  }
  throw new Error(`没有指定 notebook，设置里也没有绑定目标笔记本。可选的笔记本：${describeBooks(books)}。${advice}`)
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function dropDuplicateTitle(markdown, title) {
  const lines = String(markdown ?? '').split('\n')
  let index = 0
  while (index < lines.length && lines[index].trim() === '') index += 1
  if (index >= lines.length) return markdown
  const heading = lines[index].trim().replace(/^#\s+/, '')
  if (!lines[index].trim().startsWith('#') || heading !== title) return markdown
  lines.splice(index, 1)
  while (index < lines.length && lines[index].trim() === '') {
    lines.splice(index, 1)
  }
  return lines.join('\n')
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

function normalizeParentPath(value) {
  let path = String(value ?? '').trim()
  if (!path) return ''
  if (!path.startsWith('/')) path = `/${path}`
  path = path.replace(/\/+$/, '')
  return path === '/' ? '' : path
}

function collectBlockIds(data) {
  const ids = new Set()
  if (!Array.isArray(data)) return []
  for (const transaction of data) {
    if (typeof transaction?.id === 'string') ids.add(transaction.id)
    for (const op of transaction?.doOperations ?? []) {
      if (typeof op?.id === 'string') ids.add(op.id)
    }
  }
  return [...ids]
}

function textOutput(schema = { type: 'object' }) {
  return {
    schema,
    render(_args, value) {
      return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Build the tool definitions.
 * @param rawConfig bundle row config, or a function returning the effective config.
 */
export function createTools(rawConfig) {
  const current = typeof rawConfig === 'function' ? rawConfig : () => normalizeConfig(rawConfig)

  const notebooksTool = {
    name: 'siyuan_notebooks',
    description:
      'List or create SiYuan (思源笔记) notebooks. Call it with action "list" before writing when you do not know the notebook id; "create" makes a new notebook and returns its id.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create'],
          description: 'list = 列出笔记本（默认）；create = 新建一个笔记本',
        },
        name: {
          type: 'string',
          description: 'create 时必填：新笔记本名称',
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: textOutput(),
    async execute(args, exec) {
      const input = args ?? {}
      const cfg = current()
      const action = String(input.action ?? 'list')
      if (action === 'create') {
        const bookName = String(input.name ?? '').trim()
        if (!bookName) throw new Error('create 需要 name：要新建的笔记本名称。')
        const data = await callKernel(cfg, '/api/notebook/createNotebook', { name: bookName }, exec?.signal)
        return { ok: true, notebook: { id: String(data?.notebook?.id ?? ''), name: bookName } }
      }
      if (action !== 'list') throw new Error(`不支持的 action「${action}」：只能是 list 或 create。`)
      const books = await listNotebooks(cfg, exec?.signal)
      try {
        const counts = await fetchDocCounts(cfg)
        for (const book of books) {
          if (counts.has(book.id)) book.docCount = counts.get(book.id)
        }
      } catch {
        // The counts are cosmetic; keep whatever lsNotebooks reported.
      }
      return { ok: true, count: books.length, notebooks: books }
    },
  }

  const docCreateTool = {
    name: 'siyuan_doc_create',
    description:
      'Create a SiYuan document from Markdown and return its document id. The title is already the document title in SiYuan, so a leading "# <title>" heading identical to title is removed automatically. The Markdown is SiYuan Flavored Markdown (Kramdown): it supports headings, lists, tables, math, code blocks and block attributes.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '文档标题，同时作为文件名；不能含 / 或 \\' },
        markdown: { type: 'string', description: '文档正文（Markdown）。不要再用与 title 相同的 H1 开头' },
        notebook: { type: 'string', description: '目标笔记本的 id 或名称；省略时用设置页里选的笔记本' },
        parentPath: {
          type: 'string',
          description: '目标父路径，如 "/项目/2026"；省略时写到笔记本根目录。笔记本内任意路径都可写入',
        },
      },
      required: ['title', 'markdown'],
      additionalProperties: false,
    },
    output: textOutput(),
    async execute(args, exec) {
      const input = args ?? {}
      const cfg = current()
      const title = String(input.title ?? '').trim().replace(/[\\/]/g, '-')
      if (!title) throw new Error('需要 title：文档标题不能为空。')
      const markdown = dropDuplicateTitle(String(input.markdown ?? ''), title)
      const parentPath = normalizeParentPath(input.parentPath ?? '')
      const book = await resolveNotebook(cfg, input.notebook, exec?.signal)
      const path = `${parentPath}/${title}`
      const data = await callKernel(
        cfg,
        '/api/filetree/createDocWithMd',
        { notebook: book.id, path, markdown },
        exec?.signal,
      )
      const id = typeof data === 'string' ? data : String(data?.id ?? '')
      if (!id) throw new Error('思源没有返回文档 id，创建可能未生效。')
      return { ok: true, id, title, path, notebook: { id: book.id, name: book.name } }
    },
  }

  const docAppendTool = {
    name: 'siyuan_doc_append',
    description:
      'Append Markdown blocks to the end of an existing SiYuan document, anywhere in the notebook. Without docId it falls back to the deployment default document. Use it to add new sections to a note without rewriting it.',
    parameters: {
      type: 'object',
      properties: {
        docId: { type: 'string', description: '目标文档 id（形如 20261030080350-abc1234）；省略时用部署配置的默认文档' },
        markdown: { type: 'string', description: '要追加的 Markdown 内容' },
      },
      required: ['markdown'],
      additionalProperties: false,
    },
    output: textOutput(),
    async execute(args, exec) {
      const input = args ?? {}
      const cfg = current()
      const docId = String(input.docId ?? '').trim() || cfg.defaultDocId
      if (!docId) throw new Error('需要 docId：目标文档 id。')
      const markdown = String(input.markdown ?? '')
      if (!markdown.trim()) throw new Error('markdown 为空，没有可追加的内容。')
      const data = await callKernel(
        cfg,
        '/api/block/appendBlock',
        { dataType: 'markdown', data: markdown, parentID: docId },
        exec?.signal,
      )
      return { ok: true, docId, blockIds: collectBlockIds(data) }
    },
  }

  const blockUpdateTool = {
    name: 'siyuan_block_update',
    description:
      'Replace the content of one SiYuan block (paragraph, list item, heading, table cell…) identified by its block id, using Markdown. It rewrites that single block, so pass one block of Markdown; to add several blocks use siyuan_doc_append instead.',
    parameters: {
      type: 'object',
      properties: {
        blockId: { type: 'string', description: '要修改的块 id' },
        markdown: { type: 'string', description: '这个块的新内容（Markdown，只写一个块）' },
      },
      required: ['blockId', 'markdown'],
      additionalProperties: false,
    },
    output: textOutput(),
    async execute(args, exec) {
      const input = args ?? {}
      const cfg = current()
      const blockId = String(input.blockId ?? '').trim()
      if (!blockId) throw new Error('需要 blockId：要修改的块 id。')
      const markdown = String(input.markdown ?? '')
      if (!markdown.trim()) throw new Error('markdown 为空：改成空内容请改用别的块操作。')
      await callKernel(cfg, '/api/block/updateBlock', { dataType: 'markdown', data: markdown, id: blockId }, exec?.signal)
      return { ok: true, blockId }
    },
  }

  const searchTool = {
    name: 'siyuan_search',
    description:
      'Search SiYuan. mode "fulltext" (default) runs a full-text search and returns matching blocks with their document id and path; mode "sql" runs a read-only SELECT against the SiYuan database.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'fulltext 时是检索词；sql 时是完整的 SELECT 语句' },
        mode: { type: 'string', enum: ['fulltext', 'sql'], description: '检索方式，默认 fulltext' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '最多返回多少条，默认 20' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: textOutput(),
    async execute(args, exec) {
      const input = args ?? {}
      const cfg = current()
      const query = String(input.query ?? '').trim()
      if (!query) throw new Error('需要 query：检索词或 SQL 语句。')
      const limit = Math.min(100, Math.max(1, Number(input.limit ?? 20) || 20))
      const mode = String(input.mode ?? 'fulltext')
      if (mode === 'sql') {
        const rows = await callKernel(cfg, '/api/query/sql', { stmt: query }, exec?.signal)
        const list = Array.isArray(rows) ? rows : []
        return { ok: true, mode, count: list.length, rows: list.slice(0, limit) }
      }
      if (mode !== 'fulltext') throw new Error(`不支持的 mode「${mode}」：只能是 fulltext 或 sql。`)
      const data = await callKernel(
        cfg,
        '/api/search/fullTextSearchBlock',
        { query, page: 1, pageSize: limit, method: 0, orderBy: 0, groupBy: 0 },
        exec?.signal,
      )
      const blocks = Array.isArray(data?.blocks) ? data.blocks : []
      return {
        ok: true,
        mode,
        count: Number(data?.matchedBlockCount ?? blocks.length),
        blocks: blocks.slice(0, limit).map((block) => ({
          id: String(block.id ?? ''),
          docId: String(block.rootID ?? ''),
          path: String(block.hPath ?? ''),
          type: String(block.type ?? ''),
          text: stripHtml(block.content).slice(0, 400),
        })),
      }
    },
  }

  const docReadTool = {
    name: 'siyuan_doc_read',
    description:
      'Read any SiYuan document as Markdown. Without id it falls back to the deployment default document. Long documents are truncated and report how much was omitted.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id；省略时读部署配置的默认文档' },
        maxChars: { type: 'integer', minimum: 1000, maximum: 200000, description: '最多返回多少字符，默认 20000' },
      },
      required: [],
      additionalProperties: false,
    },
    output: textOutput(),
    async execute(args, exec) {
      const input = args ?? {}
      const cfg = current()
      const id = String(input.id ?? '').trim() || cfg.defaultDocId
      if (!id) throw new Error('需要 id：文档 id。')
      const maxChars = Math.min(200000, Math.max(1000, Number(input.maxChars ?? 20000) || 20000))
      const data = await callKernel(cfg, '/api/export/exportMdContent', { id }, exec?.signal)
      const content = String(data?.content ?? '')
      const truncated = content.length > maxChars
      return {
        ok: true,
        id,
        chars: content.length,
        truncated,
        content: truncated ? content.slice(0, maxChars) : content,
      }
    },
  }

  return [notebooksTool, docCreateTool, docAppendTool, blockUpdateTool, searchTool, docReadTool]
}

// ---------------------------------------------------------------------------
// Web routes for the Settings page
// ---------------------------------------------------------------------------

function isLoopbackHostname(hostname) {
  const host = String(hostname).toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

function isLoopbackAddress(address) {
  const value = String(address ?? '')
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'
}

/** Same trust fence the other local plugins use: loopback socket, loopback Host, same origin. */
function isLoopbackRequest(request) {
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false
  if (request.headers['cf-connecting-ip'] !== undefined || request.headers['x-forwarded-for'] !== undefined) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(payload)
}

async function readJsonBody(req, maxBytes = 32 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) {
      req.destroy()
      return null
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function validatePatch(body) {
  const patch = {}
  if (Object.hasOwn(body, 'baseUrl')) {
    const value = String(body.baseUrl ?? '').trim().replace(/\/+$/, '')
    // An empty string means "drop my override and use the deployment default".
    if (value !== '' && !/^https?:\/\/[^\s]+$/i.test(value)) {
      throw new Error('内核地址要以 http:// 或 https:// 开头；留空表示用部署默认值。')
    }
    patch.baseUrl = value
  }
  if (Object.hasOwn(body, 'tokenFile')) {
    const value = String(body.tokenFile ?? '').trim()
    if (value !== '' && !/^[A-Za-z]:[\\/]|^\//.test(value)) throw new Error('配置路径要写成完整路径，例如 D:/DDUP/jizi/conf/conf.json。')
    patch.tokenFile = value
  }
  for (const key of ['notebook', 'defaultDocId']) {
    if (Object.hasOwn(body, key)) patch[key] = String(body[key] ?? '').trim()
  }
  // Older clients send `defaultNotebook`; keep accepting it as the notebook value.
  if (!Object.hasOwn(body, 'notebook') && Object.hasOwn(body, 'defaultNotebook')) {
    patch.notebook = String(body.defaultNotebook ?? '').trim()
  }
  if (Object.hasOwn(body, 'timeoutMs')) {
    const value = Number(body.timeoutMs)
    if (!Number.isFinite(value) || value < 1000 || value > 120000) throw new Error('超时要在 1000–120000 毫秒之间。')
    patch.timeoutMs = Math.round(value)
  }
  return patch
}

async function buildState(rawConfig) {
  // Accept either the bundle row config or a getter returning the effective
  // config (handy for tests and for callers that already resolved the layers).
  const { cfg, row, saved } =
    typeof rawConfig === 'function'
      ? { cfg: rawConfig(), row: {}, saved: {} }
      : resolveConfig(rawConfig)
  const appPath = discoverSiYuanApp()
  const state = {
    ok: true,
    settingsFile: settingsPath(),
    settings: {
      notebook: cfg.notebook,
      baseUrl: cfg.baseUrl,
      tokenFile: cfg.tokenFile,
      defaultDocId: cfg.defaultDocId,
      timeoutMs: cfg.timeoutMs,
    },
    row: { ...row },
    overrides: Object.keys(saved),
    token: { ok: true },
    kernel: { ok: false, notebooks: [] },
    notebook: { ok: false },
    app: { found: Boolean(appPath), path: appPath },
    recommendation: { ok: false, error: '' },
    hint: '',
  }
  try {
    readToken(cfg)
  } catch (error) {
    state.token = { ok: false, error: error instanceof Error ? error.message : String(error) }
    state.kernel.error = state.token.error
    state.notebook.error = '连接还没配好'
    state.hint = '先让插件读到思源的 API token：在思源「设置 → 关于」里复制 API token，或填写工作区的 conf/conf.json 路径。'
    return state
  }
  try {
    state.kernel.notebooks = await listNotebooks(cfg)
    state.kernel.ok = true
  } catch (error) {
    state.kernel.error = error instanceof Error ? error.message : String(error)
    state.notebook.error = '读不到笔记本列表'
    state.recommendation = { ok: false, error: '思源没在运行，启动后才能推荐笔记本' }
    state.hint = startSiYuanHint(appPath)
    return state
  }
  try {
    const counts = await fetchDocCounts(cfg)
    for (const book of state.kernel.notebooks) {
      if (counts.has(book.id)) book.docCount = counts.get(book.id)
    }
  } catch {
    // The counts are cosmetic; keep whatever lsNotebooks reported.
  }
  const open = state.kernel.notebooks.filter((book) => !book.closed)
  const wanted = cfg.notebook
  const hit = wanted
    ? (open.find((book) => book.id === wanted) ?? open.find((book) => book.name === wanted))
    : open.length === 1
      ? open[0]
      : undefined
  if (hit) {
    state.notebook = { ok: true, id: hit.id, name: hit.name, auto: !wanted, docCount: hit.docCount }
  } else if (!wanted) {
    state.notebook = { ok: false, error: open.length === 0 ? '没有打开的笔记本' : '还没有绑定目标笔记本' }
    if (open.length > 0) {
      try {
        state.recommendation = await recommendNotebook(cfg, state.kernel.notebooks)
      } catch (error) {
        state.recommendation = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      if (state.recommendation.ok) {
        state.hint = `还没绑定笔记本：推荐「${state.recommendation.name}」（${state.recommendation.reason}），点下面的按钮就能绑上。`
      }
    } else {
      state.hint = '思源里还没有打开的笔记本：先在思源里建一本，再回来点「重新检测」。'
    }
  } else {
    state.notebook = { ok: false, error: `找不到笔记本「${wanted}」` }
    state.hint = '之前绑定的笔记本可能被关闭或删除了：重新选一本并保存。'
  }
  return state
}

function makeRoutes(rawConfig) {
  return [
    {
      kind: 'exact',
      path: ROUTES.state,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: `method not allowed: ${req.method}` })
        try {
          writeJson(res, 200, await buildState(rawConfig))
        } catch (error) {
          writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.settings,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: `method not allowed: ${req.method}` })
        try {
          const body = await readJsonBody(req)
          if (body === null) return writeJson(res, 400, { ok: false, error: 'invalid JSON body' })
          if (body.reset === true) {
            saveSettings(Object.fromEntries(EDITABLE.map((key) => [key, ''])))
            return writeJson(res, 200, await buildState(rawConfig))
          }
          const patch = validatePatch(body)
          if (Object.keys(patch).length === 0) return writeJson(res, 400, { ok: false, error: 'nothing to save' })
          saveSettings(patch)
          writeJson(res, 200, await buildState(rawConfig))
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

function optionalService(ctx, serviceName) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(serviceName, false)
    return ctx[serviceName]
  } catch {
    return undefined
  }
}

export function apply(ctx, rawConfig) {
  const current = () => resolveConfig(rawConfig).cfg
  for (const definition of createTools(current)) {
    ctx.effect(() => ctx.tools.register(definition), `siyuan-notes: ${definition.name}`)
  }

  const webServer = optionalService(ctx, 'webServer')
  if (webServer && typeof webServer.register === 'function') {
    ctx.effect(() => {
      const disposers = makeRoutes(rawConfig).map((route) => webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'siyuan-notes: settings routes')
  }
}

export const __internal = {
  resolveConfig,
  buildState,
  validatePatch,
  makeRoutes,
  settingsPath,
  rankNotebooks,
  discoverSiYuanApp,
  startSiYuanHint,
}
