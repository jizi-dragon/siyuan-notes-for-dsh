// Offline sanity check for the client half: load client.js with a stub module
// loader, render the panel in its loading, loaded and error states, and verify
// the slots it registers. No browser, no build step.
const sampleState = {
  ok: true,
  settingsFile: 'C:\\Users\\Administrator\\.dsh\\siyuan-notes\\settings.json',
  settings: {
    notebook: '20261008113024-3u3eikl',
    baseUrl: 'http://127.0.0.1:6806',
    tokenFile: 'D:/DDUP/jizi/conf/conf.json',
    defaultDocId: '',
    timeoutMs: 20000,
  },
  row: {},
  overrides: ['notebook'],
  token: { ok: true },
  kernel: {
    ok: true,
    notebooks: [
      { id: '20261008113024-3u3eikl', name: '收集箱', closed: false, docCount: 12 },
      { id: '20261030080350-tzt4pwi', name: '我的笔记本', closed: false, docCount: 0 },
      { id: '20261030120000-closed0', name: '已关闭', closed: true, docCount: 3 },
    ],
  },
  notebook: { ok: true, id: '20261008113024-3u3eikl', name: '收集箱', auto: false, docCount: 12 },
  app: { found: true, path: 'D:/software/siyuan/SiYuan.exe' },
  recommendation: { ok: false, error: '' },
  hint: '',
}

const APP_PATH = 'D:/software/siyuan/SiYuan.exe'

const sampleDraft = '20261008113024-3u3eikl'

let queue = []

const ReactStub = {
  createElement(tag, props, ...children) {
    return { tag, props: props || {}, children }
  },
  useState(initial) {
    const value = queue.length > 0 ? queue.shift() : initial
    return [value, () => {}]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
  useMemo(factory) {
    return factory()
  },
}

async function load(language, suffix) {
  let captured = null
  globalThis.window = {
    __ModuleLoader__: {
      load(config) {
        captured = config
      },
    },
  }
  Object.defineProperty(globalThis, 'navigator', { value: { language }, configurable: true })
  await import(`../client.js${suffix}`)
  if (!captured || captured.id !== 'siyuan-notes-for-dsh') throw new Error('client module did not register')
  return captured
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.children || []).map(textOf).join('')
}

function walk(node, out) {
  if (!node || typeof node !== 'object') return
  out.nodes += 1
  if (node.tag === 'button') {
    const label = textOf(node)
    if (label) out.buttons.push(label)
  }
  if (node.tag === 'select') {
    out.selects += 1
    out.optionLabels.push(...(node.children || []).filter((child) => child && child.tag === 'option').map(textOf))
  }
  if (node.tag === 'input') out.inputs += 1
  if (node.tag === 'div' || node.tag === 'span') out.text.push(textOf(node))
  for (const child of node.children || []) walk(child, out)
}

function inspect(label, panelElement) {
  const out = { nodes: 0, buttons: [], inputs: 0, selects: 0, optionLabels: [], text: [] }
  walk(panelElement, out)
  console.log(
    `${label}: nodes=${out.nodes} inputs=${out.inputs} selects=${out.selects} options=${JSON.stringify(out.optionLabels)} buttons=${JSON.stringify(out.buttons)}`,
  )
  return out
}

for (const [language, suffix] of [
  ['zh-CN', '?zh'],
  ['en-US', '?en'],
]) {
  const captured = await load(language, suffix)
  const mod = captured.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`unexpected require(${id})`)
  })
  const registrations = []
  const ctx = {
    slots: {
      inject(name, fn) {
        fn()
      },
      register(descriptor, component) {
        registrations.push({ descriptor, component })
        return () => {}
      },
    },
  }
  mod.apply(ctx)
  const section = registrations.find((entry) => entry.descriptor.name === 'settings.section')
  const bundleConfig = registrations.find((entry) => entry.descriptor.name === 'plugins.bundle.config')
  const nav = section.descriptor.label()
  console.log(
    `[${language}] inject=${JSON.stringify(mod.inject)} nav=${JSON.stringify(nav)} sectionId=${section.descriptor.id} order=${section.descriptor.order} bundleKey=${bundleConfig.descriptor.key}`,
  )
  if (section.descriptor.id !== 'siyuan-notes' || section.descriptor.order !== 60) throw new Error('settings.section descriptor drifted')
  if (bundleConfig.descriptor.key !== 'siyuan-notes-for-dsh') throw new Error('plugins.bundle.config key drifted')
  if (language.startsWith('zh') ? nav !== '思源笔记' : nav !== 'SiYuan Notes') throw new Error('nav label not localized')

  queue = []
  const loading = inspect(`  ${language} loading`, section.component({}))
  if (loading.nodes < 3) throw new Error('loading panel rendered nothing')

  // state, draft, busy, notice
  queue = [sampleState, sampleDraft, false, null]
  const loaded = inspect(`  ${language} loaded`, section.component({}))
  if (loaded.selects !== 1) throw new Error(`expected exactly one select, got ${loaded.selects}`)
  if (loaded.inputs !== 0) throw new Error(`the page must not offer free-form inputs, got ${loaded.inputs}`)
  if (loaded.buttons.length !== 3) throw new Error(`expected 3 buttons, got ${JSON.stringify(loaded.buttons)}`)
  if (!loaded.optionLabels.includes('收集箱 · 12 篇') && language.startsWith('zh')) {
    throw new Error(`notebook option label missing: ${JSON.stringify(loaded.optionLabels)}`)
  }
  // Only open notebooks plus the "automatic" entry may be offered.
  if (loaded.optionLabels.length !== 3) throw new Error(`closed notebook leaked into the list: ${JSON.stringify(loaded.optionLabels)}`)

  queue = [sampleState, sampleDraft, false, { kind: 'error', text: '保存失败：连不上内核' }]
  const failed = inspect(`  ${language} save-error`, section.component({}))
  if (!failed.text.some((text) => text.includes('连不上内核'))) throw new Error('error notice not rendered')

  const offline = {
    ...sampleState,
    kernel: { ok: false, notebooks: [], error: '连不上思源内核（http://127.0.0.1:6806）' },
    notebook: { ok: false, error: '读不到笔记本列表' },
    recommendation: { ok: false, error: '思源没在运行，启动后才能推荐笔记本' },
    hint: '请先启动思源笔记（D:/software/siyuan/SiYuan.exe），启动后在设置页点「重新检测」。',
  }
  queue = [offline, '', false, null]
  const down = inspect(`  ${language} kernel-down`, section.component({}))
  if (down.selects !== 1) throw new Error('select should still render (disabled) when the kernel is down')
  const startTitle = language.startsWith('zh') ? '思源笔记没有运行' : 'SiYuan is not running'
  if (!down.text.some((text) => text.includes(startTitle))) throw new Error('the "start SiYuan" banner is missing')
  if (!down.text.some((text) => text.includes(APP_PATH))) throw new Error('the found SiYuan path is missing from the banner')
  if (!down.buttons.includes(language.startsWith('zh') ? '重新检测' : 'Re-check')) {
    throw new Error('the banner must offer a re-check button')
  }

  // Running but nothing bound yet: recommend a notebook and offer one-click binding.
  const unbound = {
    ...sampleState,
    settings: { ...sampleState.settings, notebook: '' },
    overrides: [],
    notebook: { ok: false, error: '还没有绑定目标笔记本' },
    recommendation: {
      ok: true,
      id: '20261008113024-3u3eikl',
      name: '收集箱',
      reason: '最近有写入（2026-11-26）',
      candidates: [
        { id: '20261008113024-3u3eikl', name: '收集箱', reason: '最近有写入（2026-11-26）' },
        { id: '20261008112659-ngh7jkq', name: '学习', reason: '名字像笔记库' },
      ],
    },
    hint: '还没绑定笔记本：推荐「收集箱」（最近有写入（2026-11-26）），点下面的按钮就能绑上。',
  }
  queue = [unbound, '', false, null]
  const recommended = inspect(`  ${language} unbound`, section.component({}))
  const bindTop = language.startsWith('zh') ? '绑定这本' : 'Bind this notebook'
  const bindOne = language.startsWith('zh') ? '绑定' : 'Bind'
  if (!recommended.buttons.includes(bindTop)) throw new Error(`recommendation bind button missing: ${JSON.stringify(recommended.buttons)}`)
  if (!recommended.buttons.includes(bindOne)) throw new Error(`candidate bind button missing: ${JSON.stringify(recommended.buttons)}`)
  if (!recommended.text.some((text) => text.includes('学习'))) throw new Error('the secondary candidates are not rendered')
  if (!recommended.text.some((text) => text.includes('最近有写入'))) throw new Error('the recommendation reason is not rendered')
  // A bound notebook must hide the recommendation card entirely.
  if (loaded.text.some((text) => text.includes(bindTop))) throw new Error('recommendation card leaked into the bound state')
}

console.log('client.js OK')
