window.__ModuleLoader__.load({
  id: 'yujie-dsh-plugin-system-prompt',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this bundle. */
    const LOCALE_NS = 'yujie-dsh-plugin-system-prompt'
    /** Settings namespace: the profile entry id the bundle patch inserts. */
    const ENTRY_ID = 'yujie-dsh-plugin-system-prompt'
    /** Bundle page cell key: the bundle's package name, as the Plugins page dispatches it. */
    const BUNDLE_KEY = 'yujie-dsh-plugin-system-prompt'

    const en = {
      tabLabel: 'System prompt',
      summaryEmpty: 'No custom system prompt is injected yet.',
      summaryOff: 'Custom system prompt injection is off.',
      summarySet: 'A custom system prompt is injected at the start of every conversation.',
      promptLabel: 'System prompt',
      promptHint:
        'Injected at the very start of every conversation\u2019s system prompt, ahead of the built-in guidance. It applies to all agents, subagents included, from the next model step; edit and save here at any time.',
      enableLabel: 'Inject this prompt',
      placeholder: 'For example: You are a senior Go engineer. Answer in Chinese and prefer the standard library.',
      save: 'Save',
      saving: 'Saving\u2026',
      saved: 'Saved. It applies from the next model step.',
      failed: 'The deployment did not accept these values; your draft is kept for correction.',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This deployment does not serve the system prompt configuration.',
      loading: 'Loading\u2026',
    }

    const zh = {
      tabLabel: '系统提示词',
      summaryEmpty: '尚未注入自定义系统提示词。',
      summaryOff: '自定义系统提示词注入已关闭。',
      summarySet: '已在每次对话开头注入自定义系统提示词。',
      promptLabel: '系统提示词',
      promptHint:
        '拼接在每次对话系统提示词的最前面，位于内置指引之前；对所有代理（含子代理）生效，从下一个模型步起应用，可随时在此修改并保存。',
      enableLabel: '注入这段提示词',
      placeholder: '例如：你是一名资深 Go 工程师，始终用中文回答，优先使用标准库。',
      save: '保存',
      saving: '保存中\u2026',
      saved: '已保存，从下一个模型步开始生效。',
      failed: '本部署没有接受这些值，草稿已保留供修改。',
      readOnly: '本部署的设置为只读。',
      unavailable: '本部署没有提供系统提示词配置。',
      loading: '加载中\u2026',
    }

    const style = {
      summary: {
        margin: 0,
        fontSize: '13px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-secondary)',
      },
      wrap: {
        display: 'grid',
        gap: '10px',
        color: 'var(--dsw-alias-label-primary)',
      },
      hint: {
        margin: 0,
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-secondary)',
      },
      note: {
        margin: 0,
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-state-warn-primary)',
      },
      fieldLabel: {
        fontSize: '13px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-primary)',
      },
      textarea: {
        width: '100%',
        minHeight: '132px',
        boxSizing: 'border-box',
        resize: 'vertical',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        fontSize: '13px',
        lineHeight: 1.6,
        outline: 'none',
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
      },
      checkbox: {
        width: '14px',
        height: '14px',
        margin: 0,
        accentColor: 'var(--dsw-alias-brand-primary)',
      },
      actions: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
      },
      button: {
        padding: '6px 16px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '13px',
        cursor: 'pointer',
      },
      ok: {
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-state-success-primary)',
      },
      error: {
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-state-error-primary)',
      },
    }

    /**
     * The two editable fields of a form snapshot.
     * @param {{ status?: string, value?: unknown } | undefined} state - form snapshot.
     * @returns the current prompt and switch position.
     */
    function fieldsOf(state) {
      const value = state && typeof state.value === 'object' && state.value !== null ? state.value : {}
      return {
        prompt: typeof value.prompt === 'string' ? value.prompt : '',
        enabled: value.enabled !== false,
      }
    }

    /**
     * Persist an edited draft through the Host settings form; emptying the prompt
     * clears the override so the schema default applies again.
     * @param {object} form - the entry's config form.
     * @param {{ prompt: string, enabled: boolean }} draft - edited values.
     * @returns whether the Host accepted every write.
     */
    async function writeDraft(form, draft) {
      const current = fieldsOf(form.getSnapshot())
      let accepted = true
      if (draft.prompt !== current.prompt) {
        accepted =
          (draft.prompt === ''
            ? await form.unset('prompt')
            : await form.set('prompt', draft.prompt)) && accepted
      }
      if (draft.enabled !== current.enabled) {
        accepted = (await form.set('enabled', draft.enabled)) && accepted
      }
      return accepted
    }

    /**
     * The one-line state text the Plugins page asks a card for.
     * @param {(key: string) => string} t - page locale reader.
     * @param {{ status?: string, value?: unknown } | undefined} state - form snapshot.
     * @returns the summary line.
     */
    function summaryOf(t, state) {
      if (!state || state.status !== 'ready') return t('loading')
      const current = fieldsOf(state)
      if (!current.enabled) return t('summaryOff')
      return current.prompt.trim() === '' ? t('summaryEmpty') : t('summarySet')
    }

    /**
     * The configuration card rendered on the bundle's page in Plugins.
     * @param {object} props - view request, locale reader, and the injected store face.
     * @returns the summary line or the editing form.
     */
    function Card(props) {
      const t = props.t
      const [state, setState] = React.useState(() => props.read())
      const [draft, setDraft] = React.useState(() => fieldsOf(props.read()))
      const [dirty, setDirty] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [outcome, setOutcome] = React.useState(null)

      React.useEffect(() => {
        if (typeof props.subscribe !== 'function') return undefined
        const off = props.subscribe(() => setState(props.read()))
        setState(props.read())
        return typeof off === 'function' ? off : undefined
      }, [])

      React.useEffect(() => {
        if (dirty || !state || state.status !== 'ready') return
        setDraft(fieldsOf(state))
      }, [state, dirty])

      if (props.view === 'summary') {
        return h('p', { style: style.summary }, summaryOf(t, state))
      }

      const status = state && state.status
      if (status === 'unavailable') return h('p', { style: style.hint }, t('unavailable'))
      if (status !== 'ready') return h('p', { style: style.hint }, t('loading'))

      const readOnly = state.writable === false
      const disabled = readOnly || saving

      const onPrompt = (event) => {
        const next = event.target.value
        setDraft((prev) => ({ ...prev, prompt: next }))
        setDirty(true)
        setOutcome(null)
      }
      const onEnabled = (event) => {
        const next = event.target.checked
        setDraft((prev) => ({ ...prev, enabled: next }))
        setDirty(true)
        setOutcome(null)
      }
      const submit = async () => {
        setSaving(true)
        try {
          const accepted = await props.save(draft)
          setOutcome(accepted ? 'saved' : 'failed')
          if (accepted) setDirty(false)
        } catch (_error) {
          setOutcome('failed')
        } finally {
          setSaving(false)
        }
      }

      return h(
        'div',
        { style: style.wrap },
        h('p', { style: style.hint }, t('promptHint')),
        readOnly ? h('p', { style: style.note, role: 'status' }, t('readOnly')) : null,
        h('label', { style: style.fieldLabel, htmlFor: 'yujie-dsh-plugin-system-prompt-input' }, t('promptLabel')),
        h('textarea', {
          id: 'yujie-dsh-plugin-system-prompt-input',
          style: style.textarea,
          value: draft.prompt,
          placeholder: t('placeholder'),
          disabled,
          spellCheck: false,
          onChange: onPrompt,
        }),
        h(
          'label',
          { style: style.row },
          h('input', {
            type: 'checkbox',
            style: style.checkbox,
            checked: draft.enabled,
            disabled,
            onChange: onEnabled,
          }),
          h('span', null, t('enableLabel')),
        ),
        h(
          'div',
          { style: style.actions },
          h(
            'button',
            {
              type: 'button',
              style: style.button,
              disabled: !dirty || disabled,
              onClick: submit,
            },
            saving ? t('saving') : t('save'),
          ),
          outcome === 'saved' ? h('span', { style: style.ok, role: 'status' }, t('saved')) : null,
          outcome === 'failed' ? h('span', { style: style.error, role: 'status' }, t('failed')) : null,
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(LOCALE_NS, { en, zh }),
          'yujie-dsh-plugin-system-prompt: dictionaries',
        )
        const t = ctx.locale.bind(LOCALE_NS)
        // `configForms` belongs to the settings base plugin; stay inert without it.
        ctx.inject(['configForms'], (child) => {
          const configForms = child.configForms
          if (
            !configForms ||
            typeof configForms.get !== 'function' ||
            typeof configForms.whileServed !== 'function'
          ) {
            return
          }
          const form = configForms.get(ENTRY_ID)
          const face = () => ({
            read: () => form.getSnapshot(),
            subscribe: (listener) => form.subscribe(listener),
            save: (next) => writeDraft(form, next),
          })
          child.effect(
            () =>
              configForms.whileServed([ENTRY_ID], () => {
                const disposers = [
                  // Plugins page: a tab of its own beside Installed and Discover.
                  child.slots.inject('plugins.tab', () =>
                    child.slots.register(
                      {
                        name: 'plugins.tab',
                        id: 'system-prompt',
                        order: 10,
                        label: () => t('tabLabel'),
                        locale: LOCALE_NS,
                        inject: face,
                      },
                      Card,
                    ),
                  ),
                  // Settings -> Built-in plugins: a tab of its own.
                  child.slots.inject('settings.plugins.tab', () =>
                    child.slots.register(
                      {
                        name: 'settings.plugins.tab',
                        id: 'system-prompt',
                        order: 20,
                        label: () => t('tabLabel'),
                        locale: LOCALE_NS,
                        inject: face,
                      },
                      Card,
                    ),
                  ),
                  // On the bundle's page: shown between the description and the rows.
                  child.slots.inject('plugins.bundle.config', () =>
                    child.slots.register(
                      {
                        name: 'plugins.bundle.config',
                        key: BUNDLE_KEY,
                        locale: LOCALE_NS,
                        inject: face,
                      },
                      Card,
                    ),
                  ),
                ]
                return () => {
                  for (const off of disposers) off()
                }
              }),
            'yujie-dsh-plugin-system-prompt: configuration surfaces',
          )
        })
      },
    }
  },
})
