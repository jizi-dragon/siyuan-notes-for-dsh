/**
 * SiYuan (思源笔记) settings page — browser half.
 *
 * The only thing this page configures is which notebook the agent writes into.
 * Everything inside that notebook is writable (any sub-path, any document, any
 * block), so there is no path field. Connection details are deployment defaults
 * or discovered automatically on the host side.
 *
 * Loaded by the DSH Web shell through `window.__ModuleLoader__.load`: no build
 * step, React comes from the shell's shared module table.
 */
window.__ModuleLoader__.load({
  id: 'siyuan-notes-for-dsh',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo } = React

    const STATE_URL = '/api/siyuan-notes/state'
    const SETTINGS_URL = '/api/siyuan-notes/settings'

    const DICT_ZH = {
      nav: '思源笔记',
      title: '思源笔记',
      subtitle: '选择 agent 写入的目标笔记本。选定之后，整本笔记本都可写入：任意子路径新建文档，任意文档追加，任意块改写。',
      notebookLabel: '写入目标笔记本',
      notebookHint: '留空表示「不指定」：只有一个打开的笔记本时会自动用它，否则工具调用需要自己传 notebook。',
      notebookAuto: '自动（唯一打开的笔记本时使用）',
      notebookMissing: '未选择',
      notebookUnknown: '找不到',
      docs: '{n} 篇',
      statusKernelOn: '内核已连接',
      statusKernelOff: '内核未连接',
      statusTarget: '写入 {name}',
      statusNone: '未选目标',
      loading: '正在读取思源状态…',
      save: '保存',
      saving: '保存中…',
      recheck: '重新检测',
      clear: '清除选择',
      saved: '已保存：写入「{name}」',
      savedNone: '已清除选择：不再固定目标笔记本',
      cleared: '已恢复默认（跟随插件配置）',
      reload: '重新读取设置失败',
      saveFailed: '保存失败',
      tokenOff: 'API token 读不到',
      notebookListEmpty: '思源里没有打开的笔记本',
      settingsAt: '设置文件',
      kernelAt: '内核地址',
      openOnly: '只列出已打开的笔记本；在思源里打开后点「重新检测」。',
      startTitle: '思源笔记没有运行',
      startFallback: '请先打开思源笔记桌面应用，等它完全启动后再点「重新检测」。',
      recommendTitle: '还没有绑定目标笔记本',
      recommendLead: '按最近的写入记录和笔记本名字，建议先绑定这本：',
      recommendBind: '绑定这本',
      recommendOthers: '其他候选',
      bind: '绑定',
      recommendSkip: '也可以自己在上面的下拉框里选一本。',
    }
    const DICT_EN = {
      nav: 'SiYuan Notes',
      title: 'SiYuan Notes',
      subtitle: 'Pick the notebook the agent writes into. Once set, the whole notebook is writable: create documents at any sub-path, append to any document, rewrite any block.',
      notebookLabel: 'Target notebook',
      notebookHint: 'Leave empty for "unspecified": a single open notebook is used automatically, otherwise each tool call must pass a notebook.',
      notebookAuto: 'Automatic (single open notebook)',
      notebookMissing: 'Not selected',
      notebookUnknown: 'Not found',
      docs: '{n} docs',
      statusKernelOn: 'Kernel connected',
      statusKernelOff: 'Kernel offline',
      statusTarget: 'Writing to {name}',
      statusNone: 'No target yet',
      loading: 'Reading SiYuan state…',
      save: 'Save',
      saving: 'Saving…',
      recheck: 'Re-check',
      clear: 'Clear selection',
      saved: 'Saved: writing to "{name}"',
      savedNone: 'Selection cleared: no fixed notebook',
      cleared: 'Reset to the deployment defaults',
      reload: 'Could not reload settings',
      saveFailed: 'Save failed',
      tokenOff: 'API token not readable',
      notebookListEmpty: 'No open notebook in SiYuan',
      settingsAt: 'Settings file',
      kernelAt: 'Kernel',
      openOnly: 'Only open notebooks are listed; open it in SiYuan, then press "Re-check".',
      startTitle: 'SiYuan is not running',
      startFallback: 'Open the SiYuan desktop app first, wait until it finishes starting, then press "Re-check".',
      recommendTitle: 'No target notebook yet',
      recommendLead: 'Based on recent writes and notebook names, this one is suggested:',
      recommendBind: 'Bind this notebook',
      recommendOthers: 'Other candidates',
      bind: 'Bind',
      recommendSkip: 'You can also pick one yourself in the dropdown above.',
    }
    const ZH = typeof navigator !== 'undefined' && /^zh/i.test(String(navigator.language || ''))
    const DICT = ZH ? DICT_ZH : DICT_EN

    function t(key, vars) {
      let text = DICT[key] ?? key
      if (vars) {
        for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, String(value))
      }
      return text
    }

    // ---------------------------------------------------------------------
    // Styles (only `--dsw-alias-*` tokens, each with a literal fallback)
    // ---------------------------------------------------------------------

    const styles = {
      page: { display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px 8px', maxWidth: 720 },
      head: { display: 'flex', flexDirection: 'column', gap: 6 },
      title: { fontSize: 16, fontWeight: 600, color: 'var(--dsw-alias-text-primary, #16181d)' },
      subtitle: { fontSize: 13, lineHeight: 1.6, color: 'var(--dsw-alias-text-secondary, #5b6472)' },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-secondary, #e3e6eb)',
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 8 },
      chip: (ok) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: 12,
        lineHeight: 1.6,
        color: ok ? 'var(--dsw-alias-text-success, #1a7f43)' : 'var(--dsw-alias-text-secondary, #5b6472)',
        background: ok ? 'var(--dsw-alias-bg-success, #e8f6ee)' : 'var(--dsw-alias-bg-secondary, #f2f3f6)',
        border: '1px solid var(--dsw-alias-border-secondary, #e3e6eb)',
      }),
      dot: (ok) => ({
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: ok ? 'var(--dsw-alias-text-success, #1a7f43)' : 'var(--dsw-alias-text-tertiary, #9aa3b2)',
      }),
      label: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-text-secondary, #5b6472)' },
      select: {
        width: '100%',
        padding: '7px 9px',
        fontSize: 13,
        lineHeight: 1.4,
        color: 'var(--dsw-alias-text-primary, #16181d)',
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
        border: '1px solid var(--dsw-alias-border-secondary, #d6dae1)',
        borderRadius: 8,
        outline: 'none',
      },
      hint: { fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-text-tertiary, #7c8595)' },
      meta: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--dsw-alias-text-tertiary, #7c8595)' },
      row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
      primary: {
        padding: '6px 14px',
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--dsw-alias-text-on-accent, #ffffff)',
        background: 'var(--dsw-alias-bg-accent, #2f6bff)',
        border: '1px solid transparent',
        borderRadius: 7,
        cursor: 'pointer',
      },
      ghost: {
        padding: '6px 12px',
        fontSize: 13,
        color: 'var(--dsw-alias-text-primary, #16181d)',
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
        border: '1px solid var(--dsw-alias-border-secondary, #d6dae1)',
        borderRadius: 7,
        cursor: 'pointer',
      },
      error: {
        fontSize: 12,
        lineHeight: 1.6,
        color: 'var(--dsw-alias-text-danger, #c0392b)',
        background: 'var(--dsw-alias-bg-danger, #fdeeee)',
        border: '1px solid var(--dsw-alias-border-danger, #f3c9c4)',
        borderRadius: 8,
        padding: '8px 10px',
      },
      ok: {
        fontSize: 12,
        lineHeight: 1.6,
        color: 'var(--dsw-alias-text-success, #1a7f43)',
        background: 'var(--dsw-alias-bg-success, #eef8f1)',
        border: '1px solid var(--dsw-alias-border-success, #cbe8d6)',
        borderRadius: 8,
        padding: '8px 10px',
      },
      banner: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-warning, #f0d9a8)',
        background: 'var(--dsw-alias-bg-warning, #fdf6e3)',
      },
      bannerTitle: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-text-primary, #16181d)' },
      bannerBody: { fontSize: 12, lineHeight: 1.7, color: 'var(--dsw-alias-text-secondary, #5b6472)' },
      bannerPath: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        color: 'var(--dsw-alias-text-secondary, #5b6472)',
        wordBreak: 'break-all',
      },
      recommendCard: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        borderRadius: 10,
        border: '1px dashed var(--dsw-alias-border-accent, #b9caff)',
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      },
      recoRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
      recoName: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-text-primary, #16181d)' },
      candidateRow: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        fontSize: 12,
        color: 'var(--dsw-alias-text-secondary, #5b6472)',
      },
    }

    // ---------------------------------------------------------------------
    // Data access
    // ---------------------------------------------------------------------

    async function readState() {
      const response = await fetch(STATE_URL, { headers: { accept: 'application/json' } })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body || body.ok !== true) {
        throw new Error((body && (body.error || body.message)) || `HTTP ${response.status}`)
      }
      return body
    }

    async function writeSettings(patch) {
      const response = await fetch(SETTINGS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body || body.ok !== true) {
        throw new Error((body && (body.error || body.message)) || `HTTP ${response.status}`)
      }
      return body
    }

    function openNotebooks(state) {
      const books = (state && state.kernel && state.kernel.notebooks) || []
      return books.filter((book) => !book.closed)
    }

    function notebookLabel(book) {
      const docs = Number(book.docCount || 0)
      return docs > 0 ? `${book.name} · ${t('docs', { n: docs })}` : book.name
    }

    // ---------------------------------------------------------------------
    // Panel
    // ---------------------------------------------------------------------

    function SettingsPanel() {
      const [state, setState] = useState(null)
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)

      const load = useCallback(async () => {
        setBusy(true)
        setNotice(null)
        try {
          const next = await readState()
          setState(next)
          const picked = (next.settings && next.settings.notebook) || ''
          setDraft(picked)
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('reload')}：${error instanceof Error ? error.message : String(error)}` })
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const books = useMemo(() => openNotebooks(state), [state])
      const kernelOk = Boolean(state && state.kernel && state.kernel.ok)
      const current = state && state.notebook && state.notebook.ok ? state.notebook : null

      const save = useCallback(
        async (value) => {
          setBusy(true)
          setNotice(null)
          try {
            const next = await writeSettings({ notebook: value })
            setState(next)
            setDraft((next.settings && next.settings.notebook) || '')
            const target = next.notebook && next.notebook.ok ? next.notebook.name : ''
            setNotice({ kind: 'ok', text: target ? t('saved', { name: target }) : t('savedNone') })
          } catch (error) {
            setNotice({ kind: 'error', text: `${t('saveFailed')}：${error instanceof Error ? error.message : String(error)}` })
          } finally {
            setBusy(false)
          }
        },
        [],
      )

      const head = h(
        'div',
        { style: styles.head },
        h('div', { style: styles.title }, t('title')),
        h('div', { style: styles.subtitle }, t('subtitle')),
      )

      if (!state) {
        return h(
          'div',
          { style: styles.page },
          head,
          h('div', { style: styles.card }, h('div', { style: styles.hint }, busy ? t('loading') : t('loading'))),
          notice ? h('div', { style: notice.kind === 'error' ? styles.error : styles.ok }, notice.text) : null,
        )
      }

      const chips = h(
        'div',
        { style: styles.chips },
        h(
          'span',
          { style: styles.chip(kernelOk) },
          h('span', { style: styles.dot(kernelOk) }),
          kernelOk ? t('statusKernelOn') : t('statusKernelOff'),
        ),
        h(
          'span',
          { style: styles.chip(Boolean(current)) },
          h('span', { style: styles.dot(Boolean(current)) }),
          current ? t('statusTarget', { name: current.name }) : t('statusNone'),
        ),
      )

      const appPath = (state.app && state.app.path) || ''
      const hint = String(state.hint || '')
      const recommendation = state.recommendation && state.recommendation.ok ? state.recommendation : null
      const candidates = (recommendation && recommendation.candidates) || []

      // SiYuan not running: say so plainly, show where it was found, and offer the
      // single useful action.
      const banner = !kernelOk
        ? h(
            'div',
            { style: styles.banner },
            h('div', { style: styles.bannerTitle }, t('startTitle')),
            h('div', { style: styles.bannerBody }, hint || t('startFallback')),
            state.kernel && state.kernel.error ? h('div', { style: styles.bannerPath }, state.kernel.error) : null,
            appPath ? h('div', { style: styles.bannerPath }, appPath) : null,
            h(
              'div',
              { style: styles.row },
              h('button', { type: 'button', style: styles.primary, disabled: busy, onClick: load }, t('recheck')),
            ),
          )
        : null

      // Running but nothing bound: recommend one notebook and let the user bind it
      // with one click, or pick another candidate.
      const recommend =
        kernelOk && !current && recommendation
          ? h(
              'div',
              { style: styles.recommendCard },
              h('div', { style: styles.label }, t('recommendTitle')),
              h('div', { style: styles.bannerBody }, t('recommendLead')),
              h(
                'div',
                { style: styles.recoRow },
                h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                  h('div', { style: styles.recoName }, recommendation.name),
                  h('div', { style: styles.hint }, recommendation.reason),
                ),
                h(
                  'button',
                  { type: 'button', style: styles.primary, disabled: busy, onClick: () => save(recommendation.id) },
                  t('recommendBind'),
                ),
              ),
              candidates.length > 1
                ? h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                    h('div', { style: styles.label }, t('recommendOthers')),
                    ...candidates.slice(1).map((candidate) =>
                      h(
                        'div',
                        { key: candidate.id, style: styles.candidateRow },
                        h('span', null, `${candidate.name} · ${candidate.reason}`),
                        h(
                          'button',
                          { type: 'button', style: styles.ghost, disabled: busy, onClick: () => save(candidate.id) },
                          t('bind'),
                        ),
                      ),
                    ),
                  )
                : null,
              h('div', { style: styles.hint }, t('recommendSkip')),
            )
          : null

      const select = h(
        'select',
        {
          style: styles.select,
          value: draft,
          disabled: busy || !kernelOk,
          onChange: (event) => setDraft(event.target.value),
        },
        h('option', { value: '' }, t('notebookAuto')),
        ...books.map((book) => h('option', { key: book.id, value: book.id }, notebookLabel(book))),
        // Keep a saved value selectable even when the notebook is closed or missing.
        draft && !books.some((book) => book.id === draft)
          ? h('option', { key: '__saved', value: draft }, `${current ? current.name : draft} · ${t('notebookUnknown')}`)
          : null,
      )

      const body = h(
        'div',
        { style: styles.card },
        chips,
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: styles.label }, t('notebookLabel')),
          select,
          h('div', { style: styles.hint }, t('notebookHint')),
          kernelOk && books.length === 0 ? h('div', { style: styles.hint }, t('notebookListEmpty')) : null,
        ),
        !state.token.ok && state.token.error ? h('div', { style: styles.error }, `${t('tokenOff')}：${state.token.error}`) : null,
        h(
          'div',
          { style: styles.meta },
          h('div', null, `${t('settingsAt')}：${state.settingsFile}`),
          h('div', null, `${t('kernelAt')}：${(state.settings && state.settings.baseUrl) || ''}`),
        ),
        h(
          'div',
          { style: styles.row },
          h(
            'button',
            {
              type: 'button',
              style: styles.primary,
              disabled: busy || draft === ((state.settings && state.settings.notebook) || ''),
              onClick: () => save(draft),
            },
            busy ? t('saving') : t('save'),
          ),
          kernelOk ? h('button', { type: 'button', style: styles.ghost, disabled: busy, onClick: load }, t('recheck')) : null,
          h(
            'button',
            { type: 'button', style: styles.ghost, disabled: busy, onClick: () => save('') },
            t('clear'),
          ),
        ),
      )

      return h(
        'div',
        { style: styles.page },
        head,
        banner,
        body,
        recommend,
        notice ? h('div', { style: notice.kind === 'error' ? styles.error : styles.ok }, notice.text) : null,
      )
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'siyuan-notes',
            order: 60,
            label: () => t('nav'),
          },
          SettingsPanel,
        ),
      )
      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register({ name: 'plugins.bundle.config', key: 'siyuan-notes-for-dsh' }, SettingsPanel),
      )
    }

    return { inject: ['slots'], apply }
  },
})
