window.__ModuleLoader__.load({
  id: 'yujie-dsh-plugin-sider-motion',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** Browser-side copy namespace. */
    const NS = 'sessionPorts'
    /** The tab type's identity in the right Sidebar's registry. */
    const TAB_ID = 'yujie-dsh-plugin-sider-motion/tab'
    /** The kind the tab is opened by. */
    const TAB_KIND = 'sessionPorts'
    /** The endpoint the Host half serves. */
    const ENDPOINT = '/plugin/session-ports'
    /** Poll periods: the panel is the focus, the header button is an ambient badge. */
    const PANEL_POLL_MS = 2000
    const HEADER_POLL_MS = 5000

    const zh = {
      'tab.title': '端口',
      'header.label': '查看会话端口',
      'header.running': '查看会话端口，{count} 个运行中',
      'summary.running': '{count} 个端口运行中',
      'summary.none': '当前会话没有运行中的端口',
      'summary.loading': '正在检测端口…',
      'summary.error': '端口检测失败',
      'hint': '检测本会话的后台进程与工作目录中正在监听的端口，每 2 秒自动刷新。',
      'open': '打开',
      'openTitle': '在浏览器中打开 {url}',
      'refresh': '立即刷新',
      'refreshing': '正在刷新…',
      'loading': '正在检测…',
      'empty.title': '暂无运行中的端口',
      'empty.body': '在后台上启动网站、API 或预览服务器后，端口会自动出现在这里。',
      'error.title': '无法读取端口列表',
      'error.body': 'Host 端的检测接口没有响应。稍后重试，或检查插件是否已启用。',
      'retry': '重试',
      'listening': '运行中',
      'notListening': '未监听',
      'source.job': '后台任务',
      'source.output': '任务输出',
      'source.listener': '工作目录进程',
      'source.mixed': '后台任务 + 进程',
      'detail.job': '任务 {id}',
      'cwd': '工作目录',
      'badge.count': '{count}',
    }

    const en = {
      'tab.title': 'Ports',
      'header.label': 'View session ports',
      'header.running': 'View session ports, {count} running',
      'summary.running': '{count} port(s) running',
      'summary.none': 'No port is running in this session',
      'summary.loading': 'Detecting ports…',
      'summary.error': 'Port detection failed',
      'hint': 'Detects listening ports from this session’s background jobs and working directory, refreshed every 2 seconds.',
      'open': 'Open',
      'openTitle': 'Open {url} in the browser',
      'refresh': 'Refresh now',
      'refreshing': 'Refreshing…',
      'loading': 'Detecting…',
      'empty.title': 'No running port',
      'empty.body': 'Start a website, API, or preview server as a background job and its port appears here.',
      'error.title': 'Could not read the port list',
      'error.body': 'The Host detection endpoint did not answer. Retry, or check that the plugin is enabled.',
      'retry': 'Retry',
      'listening': 'Running',
      'notListening': 'Not listening',
      'source.job': 'Background job',
      'source.output': 'Job output',
      'source.listener': 'Workspace process',
      'source.mixed': 'Job + process',
      'detail.job': 'Job {id}',
      'cwd': 'Working directory',
      'badge.count': '{count}',
    }

    const SOURCE_KEY = {
      job: 'source.job',
      output: 'source.output',
      listener: 'source.listener',
      mixed: 'source.mixed',
    }

    const CSS = `
.sp-root{display:flex;flex-direction:column;min-height:0;height:100%;font-size:13px;color:var(--dsw-alias-label-primary);background:transparent}
.sp-statusbar{display:flex;align-items:center;gap:8px;padding:12px 12px 6px;min-height:20px}
.sp-summary{display:inline-flex;align-items:center;gap:7px;font-weight:600;font-size:13px;line-height:1.4;min-width:0}
.sp-summary[data-tone="live"]{color:var(--dsw-alias-label-primary)}
.sp-summary[data-tone="idle"],.sp-summary[data-tone="loading"]{color:var(--dsw-alias-label-secondary)}
.sp-summary[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
.sp-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}
.sp-dot[data-on="true"]{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 22%, transparent)}
.sp-spacer{flex:1 1 auto}
.sp-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}
.sp-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sp-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sp-iconbtn[data-busy="true"] svg{animation:sp-spin 900ms linear infinite}
@keyframes sp-spin{to{transform:rotate(360deg)}}
.sp-hint{padding:0 12px 10px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.sp-list{list-style:none;margin:0;padding:0 8px 10px;display:flex;flex-direction:column;gap:6px;overflow:auto;min-height:0;flex:1 1 auto}
.sp-row{display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;text-decoration:none;cursor:pointer;transition:background 120ms ease,border-color 120ms ease}
.sp-row:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.sp-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sp-row[data-listening="false"]{opacity:.62;cursor:default}
.sp-row[data-listening="false"]:hover{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1)}
.sp-port{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;font-weight:600;line-height:1.35;min-width:52px;flex:none;letter-spacing:-.01em}
.sp-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.sp-cmd{font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.sp-url{font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.sp-tags{display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap}
.sp-tag{font-size:10.5px;line-height:1;padding:3px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.sp-tag[data-tone="live"]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);color:var(--dsw-alias-state-success-primary)}
.sp-open{font-size:11.5px;line-height:1.45;color:var(--dsw-alias-brand-primary);flex:none;white-space:nowrap;align-self:center}
.sp-empty{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:26px 18px;color:var(--dsw-alias-label-secondary);flex:1 1 auto}
.sp-empty-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.sp-empty-body{font-size:12px;line-height:1.6;max-width:260px}
.sp-error{padding:10px 12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55}
.sp-error-title{color:var(--dsw-alias-state-error-primary);font-weight:600;margin-bottom:4px}
.sp-retry{margin-top:8px;padding:4px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer}
.sp-retry:hover{background:var(--dsw-alias-bg-layer-2)}
.sp-cwd{padding:0 12px 12px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none}
.sp-hbtn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 7px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.sp-hbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sp-hbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sp-hbadge{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 20%, transparent);color:var(--dsw-alias-state-success-primary);font-size:10.5px;font-weight:600;line-height:1}
.sp-hbadge[data-idle="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
@media (prefers-reduced-motion: no-preference){
  .sp-root{animation:sp-fade 160ms ease-out both}
  .sp-list>li{animation:sp-rise 200ms ease-out both}
  .sp-list>li:nth-child(2){animation-delay:24ms}
  .sp-list>li:nth-child(3){animation-delay:48ms}
  .sp-list>li:nth-child(4){animation-delay:72ms}
  @keyframes sp-fade{from{opacity:0}to{opacity:1}}
  @keyframes sp-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
}
`


    /**
     * A translate function that survives a missing locale binding.
     * @param t - the framework-bound translate, when present.
     * @returns a translate that falls back to the English dictionary.
     */
    function makeTranslate(t) {
      if (typeof t === 'function') return t
      return (key, params) => {
        let text = typeof en[key] === 'string' ? en[key] : key
        if (params !== undefined && params !== null && typeof params === 'object') {
          for (const [name, value] of Object.entries(params)) {
            text = text.split(`{${name}}`).join(String(value))
          }
        }
        return text
      }
    }

    /**
     * The port glyph: a rounded socket with a plug stem, drawn on currentColor.
     * @param props.size - rendered edge in pixels.
     * @returns the glyph.
     */
    function PortGlyph({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
          style: { display: 'block' },
        },
        h('rect', { x: 2.2, y: 3.2, width: 11.6, height: 7.2, rx: 2.2 }),
        h('path', { d: 'M5.1 10.4v2.4M8 10.4v2.4M10.9 10.4v2.4' }),
        h('path', { d: 'M5.1 1.9v1.3M10.9 1.9v1.3' }),
      )
    }

    /**
     * A small refresh arrow.
     * @returns the glyph.
     */
    function RefreshGlyph() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
          style: { display: 'block' },
        },
        h('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7' }),
        h('path', { d: 'M13 2.2v3.2h-3.2' }),
      )
    }

    /**
     * Poll the Host detection endpoint for one session.
     * @param sessionId - the session whose ports are wanted.
     * @param intervalMs - poll period while the page is visible.
     * @returns the latest state and a manual refresh callback.
     */
    function usePortSource(sessionId, intervalMs) {
      const [state, setState] = useState({ status: 'loading', data: undefined, error: undefined })
      const mounted = useRef(true)

      const load = useCallback(async () => {
        if (typeof sessionId !== 'string' || sessionId === '') return
        const url = `${ENDPOINT}/list?sessionId=${encodeURIComponent(sessionId)}`
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          if (!response.ok) throw new Error(`request failed (${String(response.status)})`)
          const data = await response.json()
          if (data === null || typeof data !== 'object' || !Array.isArray(data.ports)) {
            throw new Error('unexpected payload')
          }
          if (data.error !== undefined) throw new Error(String(data.error))
          if (mounted.current) setState({ status: 'ready', data, error: undefined })
        } catch (error) {
          if (!mounted.current) return
          setState((previous) => ({
            status: 'error',
            data: previous.data,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }, [sessionId])

      useEffect(() => {
        mounted.current = true
        load()
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          load()
        }, intervalMs)
        return () => {
          mounted.current = false
          clearInterval(timer)
        }
      }, [load, intervalMs])

      return [state, load]
    }

    /**
     * Compose the status sentence for the current scan.
     * @param t - bound translate.
     * @param state - poll state.
     * @returns the sentence and its tone.
     */
    function summaryOf(t, state) {
      if (state.status === 'error' && state.data === undefined) {
        return { text: t('summary.error'), tone: 'error' }
      }
      if (state.data === undefined) return { text: t('summary.loading'), tone: 'loading' }
      const running = typeof state.data.running === 'number' ? state.data.running : 0
      if (running > 0) return { text: t('summary.running', { count: running }), tone: 'live' }
      return { text: t('summary.none'), tone: 'idle' }
    }

    /**
     * One reload control shared by the panel and its status bar.
     * @param props.onClick - trigger a scan.
     * @param props.t - bound translate.
     * @param props.busy - whether a scan is in flight.
     * @returns the button.
     */
    function RefreshButton({ onClick, t: rawT, busy }) {
      const t = makeTranslate(rawT)
      return h(
        'button',
        {
          type: 'button',
          className: 'sp-iconbtn',
          'data-busy': busy ? 'true' : 'false',
          title: t('refresh'),
          'aria-label': t('refresh'),
          onClick,
        },
        h(RefreshGlyph, null),
      )
    }

    /**
     * The right-Sidebar page: every port this session is serving.
     * @param props.sessionId - the Session this tab belongs to.
     * @param props.t - bound translate.
     * @returns the panel.
     */
    function PortsTab({ sessionId, t: rawT }) {
      const t = makeTranslate(rawT)
      const [state, refresh] = usePortSource(sessionId, PANEL_POLL_MS)
      const [busy, setBusy] = useState(false)
      const ports = state.data?.ports ?? []
      const summary = summaryOf(t, state)

      const reload = useCallback(() => {
        setBusy(true)
        Promise.resolve(refresh()).finally(() => setBusy(false))
      }, [refresh])

      const body = []
      body.push(h('style', { key: 'style' }, CSS))
      body.push(
        h(
          'div',
          { className: 'sp-statusbar', key: 'bar' },
          h(
            'span',
            { className: 'sp-summary', 'data-tone': summary.tone },
            h('span', { className: 'sp-dot', 'data-on': summary.tone === 'live' ? 'true' : 'false' }),
            summary.text,
          ),
          h('span', { className: 'sp-spacer' }),
          h(RefreshButton, { onClick: reload, t, busy }),
        ),
      )

      if (state.status === 'error' && state.data === undefined) {
        body.push(
          h(
            'div',
            { className: 'sp-error', key: 'error' },
            h('div', { className: 'sp-error-title' }, t('error.title')),
            h('div', null, t('error.body')),
            h(
              'button',
              { type: 'button', className: 'sp-retry', onClick: reload },
              t('retry'),
            ),
          ),
        )
        return h('div', { className: 'sp-root' }, body)
      }

      if (ports.length === 0) {
        if (state.status === 'loading') {
          body.push(
            h(
              'div',
              { className: 'sp-empty', key: 'loading' },
              h(PortGlyph, { size: 22 }),
              h('div', { className: 'sp-empty-title' }, t('loading')),
            ),
          )
        } else {
          body.push(
            h(
              'div',
              { className: 'sp-empty', key: 'empty' },
              h(PortGlyph, { size: 22 }),
              h('div', { className: 'sp-empty-title' }, t('empty.title')),
              h('div', { className: 'sp-empty-body' }, t('empty.body')),
            ),
          )
        }
        return h('div', { className: 'sp-root' }, body)
      }

      body.push(h('div', { className: 'sp-hint', key: 'hint' }, t('hint')))
      body.push(
        h(
          'ul',
          { className: 'sp-list', key: 'list', 'aria-label': t('tab.title') },
          ports.map((entry) => h(PortRow, { key: `${entry.port}`, entry, t })),
        ),
      )

      if (typeof state.data?.cwd === 'string' && state.data.cwd !== '') {
        body.push(
          h(
            'div',
            { className: 'sp-cwd', key: 'cwd', title: state.data.cwd },
            `${t('cwd')} · ${state.data.cwd}`,
          ),
        )
      }

      return h('div', { className: 'sp-root' }, body)
    }

    /**
     * One port card; a live port is a link that opens the browser.
     * @param props.entry - one port record from the Host.
     * @param props.t - bound translate.
     * @returns the row.
     */
    function PortRow({ entry, t: rawT }) {
      const t = makeTranslate(rawT)
      const listening = entry.listening === true
      const url = typeof entry.url === 'string' && entry.url !== '' ? entry.url : `http://localhost:${entry.port}/`
      const command = typeof entry.label === 'string' && entry.label !== ''
        ? entry.label
        : typeof entry.process === 'string' && entry.process !== ''
          ? entry.process
          : entry.detail
      const sourceKey = SOURCE_KEY[entry.source] ?? 'source.job'
      const tags = [
        h(
          'span',
          { className: 'sp-tag', 'data-tone': listening ? 'live' : 'idle', key: 'state' },
          listening ? t('listening') : t('notListening'),
        ),
        h('span', { className: 'sp-tag', key: 'source' }, t(sourceKey)),
      ]

      const content = [
        h('span', { className: 'sp-port', key: 'port' }, String(entry.port)),
        h(
          'span',
          { className: 'sp-main', key: 'main' },
          h('span', { className: 'sp-cmd', title: command }, command ?? url),
          h('span', { className: 'sp-url', title: url }, url),
          h('span', { className: 'sp-tags', key: 'tags' }, tags),
        ),
        listening ? h('span', { className: 'sp-open', key: 'open' }, `${t('open')} ↗`) : null,
      ]

      const rowProps = {
        className: 'sp-row',
        'data-listening': listening ? 'true' : 'false',
      }

      if (listening) {
        return h(
          'li',
          { key: String(entry.port) },
          h(
            'a',
            {
              ...rowProps,
              href: url,
              target: '_blank',
              rel: 'noopener noreferrer',
              title: t('openTitle', { url }),
            },
            content,
          ),
        )
      }

      return h('li', { key: String(entry.port) }, h('div', rowProps, content))
    }

    /**
     * The chip title the tab strip and floating header show.
     * @param props.t - bound translate.
     * @returns the glyph and title.
     */
    function PortsTabTitle({ t: rawT }) {
      const t = makeTranslate(rawT)
      return h(
        React.Fragment,
        null,
        h(PortGlyph, { size: 14 }),
        h('span', { style: { marginInlineStart: 6 } }, t('tab.title')),
      )
    }

    /**
     * The conversation-header entry that opens the panel and shows its count.
     * @param props.sessionId - the Session on screen.
     * @param props.t - bound translate.
     * @param props.openPortsTab - navigation callback.
     * @returns the header button.
     */
    function PortsHeaderButton({ sessionId, t: rawT, openPortsTab }) {
      const t = makeTranslate(rawT)
      const [state] = usePortSource(sessionId, HEADER_POLL_MS)
      const running = typeof state.data?.running === 'number' ? state.data.running : 0
      const label = running > 0 ? t('header.running', { count: running }) : t('header.label')
      return h(
        'button',
        {
          type: 'button',
          className: 'sp-hbtn',
          title: label,
          'aria-label': label,
          onClick: () => openPortsTab(),
        },
        h(PortGlyph, { size: 16 }),
        running > 0
          ? h('span', { className: 'sp-hbadge' }, t('badge.count', { count: running }))
          : null,
      )
    }

    const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']

    /**
     * Browser half: register the tab type, its body, its chip, and the header entry.
     * @param ctx - client context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-ports: dictionaries')

      const t = ctx.locale.bind(NS)

      const openPortsTab = () => {
        try {
          ctx.sidebarRight.openTab(TAB_KIND)
        } catch (error) {
          console.error('session-ports: could not open the ports tab', error)
        }
      }

      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            priority: 'extension',
            title: () => t('tab.title'),
          }),
        'session-ports: tab type',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: TAB_ID,
                locale: NS,
              },
              PortsTab,
            ),
          ),
        'session-ports: tab body',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab.title',
                key: TAB_ID,
                locale: NS,
              },
              PortsTabTitle,
            ),
          ),
        'session-ports: tab chip',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('conversation.session.header.utilities', () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'session-ports',
                order: -6,
                locale: NS,
                inject: () => ({ openPortsTab }),
              },
              PortsHeaderButton,
            ),
          ),
        'session-ports: header entry',
      )
    }

    return { inject, apply }
  },
})
