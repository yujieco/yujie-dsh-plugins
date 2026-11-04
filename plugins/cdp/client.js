window.__ModuleLoader__.load({
  id: 'yujie-dsh-plugin-cdp',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** Browser-side copy namespace. */
    const NS = 'cdpPanel'
    /** The tab type's identity in the right Sidebar's registry. */
    const TAB_ID = 'yujie-dsh-plugin-cdp/tab'
    /** The kind the tab is opened by. */
    const TAB_KIND = 'cdpBrowser'
    /** Host endpoints served by lib/panel.js. */
    const ENDPOINT = '/plugin/cdp'
    /** The panel refresh period: a live view does not need to be faster. */
    const POLL_MS = 2000

    const zh = {
      'tab.title': '浏览器',
      'header.label': '查看受控浏览器',
      'status.connected': '{browser} 运行中',
      'status.idle': '没有浏览器会话',
      'status.loading': '正在连接…',
      'status.error': '无法读取浏览器状态',
      'page.untitled': '未命名页面',
      'page.none': '尚未打开页面',
      'hint': '实时画面，每 2 秒刷新。要开始控制，让 Agent 运行 browser_launch 或 browser_open_dsh。',
      'empty.title': '还没有受控浏览器',
      'empty.body': '让 Agent 运行 browser_launch 或 browser_open_dsh，这里就会出现实时画面、标签页和最近的报错。',
      'errors.title': '最近报错',
      'errors.none': '没有报错',
      'errors.more': '还有 {count} 条',
      'refresh': '刷新画面',
      'refreshing': '正在刷新…',
      'image.alt': '浏览器的实时画面',
      'screenshot': '画面',
    }

    const en = {
      'tab.title': 'Browser',
      'header.label': 'View the controlled browser',
      'status.connected': '{browser} running',
      'status.idle': 'No browser session',
      'status.loading': 'Connecting…',
      'status.error': 'Could not read the browser state',
      'page.untitled': 'Untitled page',
      'page.none': 'No page yet',
      'hint': 'Live view, refreshed every 2 seconds. To start controlling, have the agent run browser_launch or browser_open_dsh.',
      'empty.title': 'No controlled browser yet',
      'empty.body': 'Have the agent run browser_launch or browser_open_dsh and the live screen, tabs, and recent errors appear here.',
      'errors.title': 'Recent errors',
      'errors.none': 'No errors',
      'errors.more': '{count} more',
      'refresh': 'Refresh the view',
      'refreshing': 'Refreshing…',
      'image.alt': 'Live browser view',
      'screenshot': 'Screen',
    }

    const CSS = `
.cdp-root{display:flex;flex-direction:column;min-height:0;height:100%;font-size:13px;color:var(--dsw-alias-label-primary);background:transparent}
.cdp-bar{display:flex;align-items:center;gap:8px;padding:12px 12px 8px;min-height:20px}
.cdp-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}
.cdp-dot[data-on="true"]{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 22%, transparent)}
.cdp-status{font-weight:600;font-size:13px;line-height:1.4;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cdp-status[data-tone="idle"],.cdp-status[data-tone="loading"]{color:var(--dsw-alias-label-secondary)}
.cdp-status[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
.cdp-spacer{flex:1 1 auto}
.cdp-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.cdp-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.cdp-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.cdp-iconbtn[data-busy="true"] svg{animation:cdp-spin 900ms linear infinite}
@keyframes cdp-spin{to{transform:rotate(360deg)}}
.cdp-title{padding:0 12px 8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cdp-shot{flex:1 1 auto;min-height:0;display:flex;align-items:flex-start;justify-content:center;padding:0 12px;overflow:auto}
.cdp-shot img{max-width:100%;height:auto;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);display:block}
.cdp-empty{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:26px 18px;color:var(--dsw-alias-label-secondary);flex:1 1 auto}
.cdp-empty-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.cdp-empty-body{font-size:12px;line-height:1.6;max-width:260px}
.cdp-errors{border-top:1px solid var(--dsw-alias-border-l1);margin-top:8px;padding:8px 12px 10px;max-height:38%;overflow:auto;flex:none}
.cdp-errors-head{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:11.5px;margin-bottom:6px}
.cdp-error{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.5;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;word-break:break-word;margin:0 0 4px}
.cdp-error[data-kind="console"]{color:var(--dsw-alias-label-secondary)}
.cdp-hint{padding:8px 12px 12px;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.5;flex:none}
`

    /**
     * Bind the dictionary the slot passes in.
     * @param {any} raw - the slot's translate function.
     * @returns {(key: string, params?: Record<string, unknown>) => string} the bound translate.
     */
    function makeTranslate(raw) {
      return (key, params) => {
        let text = typeof raw === 'function' ? raw(key) : key
        if (text === undefined || text === key) {
          text = zh[key] ?? en[key] ?? key
        }
        if (params === undefined) return String(text)
        let output = String(text)
        for (const [name, value] of Object.entries(params)) output = output.split(`{${name}}`).join(String(value))
        return output
      }
    }

    /**
     * Poll the Host for the session's browser state.
     * @param {string} sessionId - the Session this tab belongs to.
     * @param {number} period - poll period in milliseconds.
     * @returns {[object, () => Promise<void>]} state and an explicit refresh.
     */
    function useCdpState(sessionId, period) {
      const [state, setState] = useState({ loading: true, data: undefined, error: undefined })
      const alive = useRef(true)

      const load = useCallback(async () => {
        try {
          const response = await fetch(`${ENDPOINT}/state?session=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          if (alive.current) setState({ loading: false, data, error: undefined })
        } catch (error) {
          if (alive.current) setState(previous => ({ loading: false, data: previous.data, error }))
        }
      }, [sessionId])

      useEffect(() => {
        alive.current = true
        load()
        const timer = setInterval(load, period)
        return () => {
          alive.current = false
          clearInterval(timer)
        }
      }, [load, period])

      return [state, load]
    }

    /**
     * The tab body: live screen, page identity, and the most recent errors.
     * @param {{ sessionId: string, t: any }} props - slot props.
     */
    function CdpPanel({ sessionId, t: rawT }) {
      const t = makeTranslate(rawT)
      const [state, refresh] = useCdpState(sessionId, POLL_MS)
      const [tick, setTick] = useState(0)
      const [busy, setBusy] = useState(false)
      const data = state.data
      const connected = data?.connected === true
      const pages = data?.pages ?? []
      const current = pages.find(page => page.current === true) ?? pages[0]
      const errors = data?.errors ?? []

      const reload = useCallback(() => {
        setBusy(true)
        setTick(value => value + 1)
        Promise.resolve(refresh()).finally(() => setBusy(false))
      }, [refresh])

      const tone = state.error !== undefined ? 'error' : connected ? 'live' : state.loading ? 'loading' : 'idle'
      const status = state.error !== undefined
        ? t('status.error')
        : connected
          ? t('status.connected', { browser: data.browser ?? 'browser' })
          : t('status.loading')

      const pageLine = current === undefined
        ? t('page.none')
        : `${current.title === '' ? t('page.untitled') : current.title} — ${current.url}`

      const shotUrl = connected ? `${ENDPOINT}/shot?session=${encodeURIComponent(sessionId)}&w=720&t=${tick}&ts=${data?.ts ?? 0}` : undefined

      const parts = [h('style', { key: 'style' }, CSS)]
      parts.push(
        h(
          'div',
          { className: 'cdp-bar', key: 'bar' },
          h('span', { className: 'cdp-dot', 'data-on': tone === 'live' ? 'true' : 'false' }),
          h('span', { className: 'cdp-status', 'data-tone': tone, title: status }, status),
          h('span', { className: 'cdp-spacer' }),
          h(
            'button',
            {
              type: 'button',
              className: 'cdp-iconbtn',
              'data-busy': busy ? 'true' : 'false',
              title: busy ? t('refreshing') : t('refresh'),
              'aria-label': t('refresh'),
              onClick: reload,
              key: 'refresh',
            },
            h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true },
              h('path', { d: 'M8 2a6 6 0 1 0 5.2 3H11a4.5 4.5 0 1 1-3-1.6V5.6L4.8 3.2 8 0z', fill: 'currentColor' })),
          ),
        ),
      )
      parts.push(h('div', { className: 'cdp-title', key: 'page', title: pageLine }, pageLine))

      if (connected && shotUrl !== undefined) {
        parts.push(
          h('div', { className: 'cdp-shot', key: 'shot' },
            h('img', { src: shotUrl, alt: t('image.alt'), loading: 'lazy' })),
        )
      } else {
        parts.push(
          h('div', { className: 'cdp-empty', key: 'empty' },
            h('div', { className: 'cdp-empty-title' }, t('empty.title')),
            h('div', { className: 'cdp-empty-body' }, t('empty.body'))),
        )
      }

      if (connected) {
        const rows = errors.length === 0
          ? [h('div', { className: 'cdp-error', key: 'none', 'data-kind': 'console' }, t('errors.none'))]
          : errors.map(item => h('pre', { className: 'cdp-error', key: item.id, 'data-kind': item.kind }, item.text))
        parts.push(
          h('div', { className: 'cdp-errors', key: 'errors' },
            h('div', { className: 'cdp-errors-head' }, t('errors.title')),
            ...rows),
        )
      }

      parts.push(h('div', { className: 'cdp-hint', key: 'hint' }, t('hint')))
      return h('div', { className: 'cdp-root' }, ...parts)
    }

    /**
     * The tab's header chip: a small screen glyph and the tab title.
     * @param {{ t: any }} props - slot props.
     */
    function CdpPanelTitle({ t: rawT }) {
      const t = makeTranslate(rawT)
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', 'aria-hidden': true },
          h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
          h('path', { d: 'M1.5 5.5h13', stroke: 'currentColor', strokeWidth: 1.4 })),
        h('span', null, t('tab.title')))
    }

    /**
     * A compact header control that opens the panel.
     * @param {{ openCdp: () => void, t: any }} props - injected props.
     */
    function CdpHeaderButton({ openCdp, t: rawT }) {
      const t = makeTranslate(rawT)
      return h(
        'button',
        {
          type: 'button',
          className: 'cdp-iconbtn',
          title: t('header.label'),
          'aria-label': t('header.label'),
          onClick: openCdp,
          style: { width: 28, height: 28 },
        },
        h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': true },
          h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
          h('path', { d: 'M1.5 5.5h13M5 8.6h4.2M5 11h6', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'cdp: dictionaries')

        const t = ctx.locale.bind(NS)

        const openCdp = () => {
          try {
            ctx.sidebarRight.openTab(TAB_KIND)
          } catch (error) {
            console.error('cdp: could not open the browser tab', error)
          }
        }

        ctx.effect(
          () => ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            priority: 'extension',
            title: () => t('tab.title'),
          }),
          'cdp: tab type',
        )

        ctx.effect(
          () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
            { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS },
            CdpPanel,
          )),
          'cdp: tab body',
        )

        ctx.effect(
          () => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
            { name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NS },
            CdpPanelTitle,
          )),
          'cdp: tab title',
        )

        ctx.effect(
          () => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'yujie-cdp',
              order: -7,
              locale: NS,
              inject: () => ({ openCdp }),
            },
            CdpHeaderButton,
          )),
          'cdp: header entry',
        )
      },
    }
  },
})
