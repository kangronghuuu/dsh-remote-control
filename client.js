window.__ModuleLoader__.load({
  id: '@local/dsh-remote-control',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const S = {
      page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'var(--dsw-alias-label-primary)' },
      header: {
        display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      title: { fontSize: '15px', fontWeight: 600, margin: 0 },
      subtitle: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      grow: { flex: 1 },
      body: { display: 'flex', flex: 1, minHeight: 0 },
      column: { display: 'flex', flexDirection: 'column', minHeight: 0 },
      list: { flex: 1, overflowY: 'auto', padding: '10px' },
      row: {
        display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
        borderRadius: '10px', border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)', marginBottom: '8px',
      },
      rowButton: { cursor: 'pointer', textAlign: 'left', width: '100%' },
      rowActive: { borderColor: 'var(--dsw-alias-brand-primary)' },
      name: { fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      meta: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      chip: {
        fontSize: '11px', padding: '2px 8px', borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
      },
      chipOk: { color: 'var(--dsw-alias-state-success-primary)', borderColor: 'var(--dsw-alias-state-success-primary)' },
      chipWarn: { color: 'var(--dsw-alias-state-warn-primary)', borderColor: 'var(--dsw-alias-state-warn-primary)' },
      chipBad: { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' },
      button: {
        font: 'inherit', fontSize: '12px', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
      },
      primary: { background: 'var(--dsw-alias-brand-primary)', borderColor: 'var(--dsw-alias-brand-primary)', color: '#fff' },
      danger: { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' },
      notice: {
        margin: '10px', padding: '10px 12px', borderRadius: '10px',
        border: '1px solid var(--dsw-alias-state-warn-primary)',
        background: 'var(--dsw-alias-bg-layer-1)', fontSize: '12px',
      },
      log: { flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '8px' },
      bubble: {
        maxWidth: '78%', padding: '8px 11px', borderRadius: '12px', fontSize: '13px',
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', border: '1px solid var(--dsw-alias-border-l1)',
      },
      userBubble: { alignSelf: 'flex-end', background: 'var(--dsw-alias-bg-layer-2)' },
      assistantBubble: { alignSelf: 'flex-start', background: 'var(--dsw-alias-bg-layer-1)' },
      toolRow: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', alignSelf: 'flex-start' },
      note: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', alignSelf: 'center' },
      composer: {
        display: 'flex', gap: '8px', alignItems: 'flex-end', padding: '10px 14px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      input: {
        flex: 1, resize: 'none', font: 'inherit', fontSize: '13px', padding: '8px 10px', minHeight: '38px',
        maxHeight: '140px', borderRadius: '10px', color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
      },
      empty: { margin: 'auto', padding: '24px', textAlign: 'center', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' },
      pane: { width: '300px', borderRight: '1px solid var(--dsw-alias-border-l1)' },
      field: {
        font: 'inherit', fontSize: '12px', padding: '7px 9px', borderRadius: '8px', minWidth: '180px',
        color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
      },
      error: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)', padding: '8px 18px' },
      configBar: {
        display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
        padding: '8px 14px', borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
    }

    async function api(path, body) {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`)
      return data
    }

    function shortAccount(userId) {
      if (!userId) return 'signed out'
      return String(userId).slice(0, 8)
    }

    function relativeTime(value) {
      const delta = Date.now() - Number(value || 0)
      if (!Number.isFinite(delta)) return ''
      const seconds = Math.round(delta / 1000)
      if (seconds < 10) return 'now'
      if (seconds < 60) return `${seconds}s ago`
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return `${minutes}m ago`
      return `${Math.round(minutes / 60)}h ago`
    }

    const STORAGE_NAMESPACE = 'dsh-remote-control'

    function storageKey() {
      try { return `${STORAGE_NAMESPACE}:last:${window.location.host || 'local'}` } catch { return `${STORAGE_NAMESPACE}:last` }
    }

    function readSavedTarget() {
      try {
        const hash = window.location.hash || ''
        if (hash.length > 1) {
          const params = new URLSearchParams(hash.slice(1))
          const peerId = params.get('peer')
          if (peerId) return { peerId, sessionId: params.get('session') || null, scrollTop: 0, pinned: true }
        }
        const raw = window.localStorage?.getItem(storageKey())
        if (!raw) return null
        const value = JSON.parse(raw)
        if (!value || typeof value.peerId !== 'string') return null
        return value
      } catch {
        return null
      }
    }

    function writeSavedTarget(value) {
      try { window.localStorage?.setItem(storageKey(), JSON.stringify(value)) } catch { /* storage unavailable */ }
      try {
        const params = new URLSearchParams()
        params.set('peer', value.peerId)
        if (value.sessionId) params.set('session', value.sessionId)
        if (window.history?.replaceState) {
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${params.toString()}`)
        }
      } catch { /* ignore */ }
    }

    function uptimeText(since) {
      if (!since) return ''
      const seconds = Math.max(0, Math.round((Date.now() - since) / 1000))
      if (seconds < 60) return seconds + 's'
      if (seconds < 3600) return Math.round(seconds / 60) + 'm'
      return (seconds / 3600).toFixed(1) + 'h'
    }

    function SetupWizard({ busy, error, onChoose, onSkip }) {
      const [invite, setInvite] = useState('')
      const [joinMode, setJoinMode] = useState(false)
      const row = (label, detail, onClick) => h('button', {
        type: 'button',
        style: {
          textAlign: 'left', padding: '10px 12px', borderRadius: '10px',
          border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent',
          color: 'inherit', cursor: 'pointer', font: 'inherit',
        },
        disabled: busy === 'setup',
        onClick,
      },
        h('div', { style: { fontWeight: 600, fontSize: '13px' } }, label),
        h('div', { style: { ...S.meta, marginTop: '2px' } }, detail))
      return h('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '16px' } },
        h('div', { style: { width: 'min(560px, 94vw)', background: 'var(--dsw-alias-bg-l1, #1b1d21)', border: '1px solid var(--dsw-alias-border-l1, #333)', borderRadius: '14px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '90vh', overflow: 'auto' } },
          h('div', { style: { fontSize: '16px', fontWeight: 600 } }, 'Set up remote access'),
          h('div', { style: S.meta }, 'Choose how other devices reach this Host. Identity keys stay local; you can change this later from the Service card.'),
          busy === 'setup' ? h('div', { style: S.meta }, 'Working…') : null,
          error ? h('div', { style: S.error }, error) : null,
          row('Only this network (LAN)', 'No relay and no tunnel; nothing is downloaded.', () => onChoose('lan')),
          row('Host a relay here', 'Stable invite: this Host serves the relay. No extra install.', () => onChoose('relay-host')),
          row('Quick tunnel (downloads cloudflared)', 'Verified download of the pinned build, then a public https URL.', () => onChoose('tunnel')),
          joinMode
            ? h('div', { style: { display: 'flex', gap: '8px' } },
              h('input', {
                style: { ...S.field, flex: 1 },
                placeholder: 'Paste invite: url key#code',
                value: invite,
                onChange: (event) => setInvite(event.target.value),
              }),
              h('button', {
                type: 'button',
                style: S.button,
                disabled: busy === 'setup' || !invite.trim(),
                onClick: () => onChoose('relay-join', invite),
              }, 'Join'),
            )
            : row('Join an existing relay', 'Paste an invite another device gave you.', () => setJoinMode(true)),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '4px' } },
            h('button', { type: 'button', style: S.button, onClick: onSkip }, 'Skip')),
        ))
    }

    function Icon({ size, active }) {
      const edge = size || 20
      return h('svg', {
        viewBox: '0 0 24 24', width: edge, height: edge, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        style: { opacity: active ? 1 : 0.72 },
      },
        h('rect', { x: 3, y: 4, width: 18, height: 12, rx: 2 }),
        h('path', { d: 'M8 20h8M12 16v4' }),
        h('path', { d: 'M7.5 10h2l1.5 2 1.5-4 1.5 2h2.5' }),
      )
    }

    /* ---------------- chat ---------------- */

    function Chat({ peerId, sessionId, title, blank, initialScrollTop, initialPinned, onScrollTop }) {
      const [entries, setEntries] = useState([])
      const [live, setLive] = useState('')
      const [running, setRunning] = useState(false)
      const [draft, setDraft] = useState('')
      const [pendingFiles, setPendingFiles] = useState([])
      const [uploading, setUploading] = useState(null)
      const [error, setError] = useState(null)
      const [streamState, setStreamState] = useState('connecting')
      const [attempt, setAttempt] = useState(0)
      const [config, setConfig] = useState(null)
      const [configBusy, setConfigBusy] = useState(false)
      const seen = useRef(new Set())
      const logRef = useRef(null)
      const pinned = useRef(initialPinned ?? true)
      const scrollSent = useRef(0)

      useEffect(() => {
        seen.current = new Set()
        setEntries([])
        setLive('')
        setRunning(false)
        setError(null)
        setStreamState('connecting')
        if (!peerId || !sessionId) return undefined
        const source = new EventSource(
          `/remote-control/api/peer/${encodeURIComponent(peerId)}/stream?sessionId=${encodeURIComponent(sessionId)}`,
        )
        source.onopen = () => setStreamState('live')
        source.onmessage = (event) => {
          setStreamState('live')
          let frame
          try { frame = JSON.parse(event.data) } catch { return }
          if (frame.type === 'snapshot') {
            const batch = []
            for (const record of frame.records || []) {
              const entry = toEntry(record?.event, seen.current)
              if (entry) batch.push(entry)
            }
            if (batch.length > 0) setEntries((current) => current.concat(batch))
            return
          }
          if (frame.type === 'event') {
            const entry = toEntry(frame.event, seen.current)
            if (!entry) return
            if (entry.kind === 'turn-start') { setRunning(true); return }
            if (entry.kind === 'turn-end') { setRunning(false); return }
            if (entry.kind === 'live-reset') { setLive(''); return }
            if (entry.kind === 'assistant') setLive('')
            setEntries((current) => current.concat([entry]))
            return
          }
          if (frame.type === 'assistant-stream') {
            const inner = frame.frame || {}
            if (inner.type === 'start') { setLive(''); return }
            if (inner.type === 'chunk' && inner.chunk?.type === 'text-delta') {
              setLive((current) => current + String(inner.chunk.text ?? ''))
            }
            if (inner.type === 'end') {
              setTimeout(() => setLive(''), 700)
            }
            return
          }
          if (frame.type === 'remote-error') setError(`${frame.code || 'error'}: ${frame.message || 'stream failed'}`)
        }
        source.onerror = () => {
          // EventSource retries by itself, but a dead stream must not look like
          // an empty conversation.
          setStreamState('error')
        }
        return () => source.close()
      }, [peerId, sessionId, attempt])

      useEffect(() => {
        if (!pinned.current) return
        const node = logRef.current
        if (node) node.scrollTop = node.scrollHeight
      }, [entries, live])

      // Restore the saved reading position once content exists.
      const restoredScroll = useRef(false)
      useEffect(() => {
        if (restoredScroll.current) return
        const node = logRef.current
        if (!node || entries.length === 0) return
        restoredScroll.current = true
        if (typeof initialScrollTop === 'number' && initialScrollTop > 0) node.scrollTop = initialScrollTop
      }, [entries])

      const addFiles = useCallback((list) => {
        const files = Array.from(list ?? []).filter((file) => file && typeof file.size === 'number')
        if (files.length > 0) setPendingFiles((current) => [...current, ...files])
      }, [])

      const dropFiles = useCallback((event) => {
        event.preventDefault()
        addFiles(event.dataTransfer?.files)
      }, [addFiles])

      const send = useCallback(async () => {
        const text = draft.trim()
        const pending = pendingFiles
        if ((!text && pending.length === 0) || !peerId || !sessionId) return
        setDraft('')
        setError(null)
        try {
          const sent = []
          for (const file of pending) {
            setUploading({ name: file.name, progress: 0 })
            const init = await api('/remote-control/api/upload/init', {
              sessionId,
              name: file.name || 'file',
              size: file.size,
              mediaType: file.type || 'application/octet-stream',
            })
            const uploadId = init?.uploadId
            if (!uploadId) throw new Error('The device refused the upload.')
            const chunkSize = 512 * 1024
            for (let offset = 0, index = 0; offset < file.size; offset += chunkSize, index += 1) {
              const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer())
              let binary = ''
              for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
              await api('/remote-control/api/upload/chunk', { uploadId, index, data: btoa(binary) })
              setUploading({ name: file.name, progress: Math.min(1, (offset + chunkSize) / Math.max(1, file.size)) })
            }
            const committed = await api('/remote-control/api/upload/commit', { uploadId })
            if (committed?.attachment) sent.push(committed.attachment)
          }
          setUploading(null)
          setPendingFiles([])
          await api(`/remote-control/api/peer/${encodeURIComponent(peerId)}/prompt`, { sessionId, text, attachments: sent })
        } catch (failure) {
          setUploading(null)
          setDraft(text)
          setError(failure.message)
        }
      }, [draft, pendingFiles, peerId, sessionId])

      const stop = useCallback(async () => {
        try {
          await api(`/remote-control/api/peer/${encodeURIComponent(peerId)}/cancel`, { sessionId })
        } catch (failure) {
          setError(failure.message)
        }
      }, [peerId, sessionId])

      const loadConfig = useCallback(async () => {
        if (!peerId || !sessionId) return
        try {
          const value = await api(
            `/remote-control/api/peer/${encodeURIComponent(peerId)}/session-config?sessionId=${encodeURIComponent(sessionId)}`,
          )
          setConfig(value)
        } catch {
          setConfig(null)
        }
      }, [peerId, sessionId])

      useEffect(() => { loadConfig() }, [loadConfig])

      const applyConfig = useCallback(async (patch) => {
        setConfigBusy(true)
        setError(null)
        try {
          const value = await api(`/remote-control/api/peer/${encodeURIComponent(peerId)}/session-config`, { sessionId, ...patch })
          if (value && value.ok === false) throw new Error((value.failures || []).join('; ') || 'config rejected')
          await loadConfig()
        } catch (failure) {
          setError(failure.message)
        }
        setConfigBusy(false)
      }, [peerId, sessionId, loadConfig])

      const models = config?.models ?? []
      const permissions = config?.permission?.catalog?.options ?? []
      const modelValue = config?.model ? `${config.model.provider}:${config.model.model}` : ''
      const permissionValue = config?.permission?.current ?? config?.permission?.catalog?.defaultPreset ?? ''
      const planActive = config?.plan?.active === true
      const configBar = (models.length > 0 || permissions.length > 0)
        ? h('div', { style: S.configBar },
          models.length > 0
            ? h('select', {
              style: S.field,
              value: modelValue,
              disabled: configBusy,
              onChange: (event) => {
                const [provider, model] = event.target.value.split(':')
                if (provider && model) applyConfig({ model: { provider, model } })
              },
            },
              modelValue ? null : h('option', { value: '' }, 'Model'),
              models.map((group) => h('optgroup', { key: group.provider, label: group.name },
                group.models.map((model) => h('option', {
                  key: `${group.provider}:${model.id}`,
                  value: `${group.provider}:${model.id}`,
                }, model.name)),
              )),
            )
            : null,
          permissions.length > 0
            ? h('select', {
              style: S.field,
              value: permissionValue,
              disabled: configBusy,
              onChange: (event) => applyConfig({ permission: event.target.value }),
            }, permissions.map((option) => h('option', {
              key: option.value,
              value: option.value,
              title: option.description ?? '',
            }, option.name)))
            : null,
          config?.plan
            ? h('button', {
              type: 'button',
              disabled: configBusy,
              style: { ...S.button, ...(planActive ? S.primary : {}) },
              onClick: () => applyConfig({ plan: !planActive }),
            }, planActive ? 'Plan on' : 'Plan off')
            : null,
        )
        : null

      return h('div', { style: { ...S.column, flex: 1, minHeight: 0 } },
        h('div', {
          style: { padding: '10px 18px', borderBottom: '1px solid var(--dsw-alias-border-l1)', fontSize: '13px', fontWeight: 600 },
        }, title || sessionId),
        error ? h('div', { style: S.error }, error) : null,
        h('div', {
          ref: logRef,
          style: S.log,
          onScroll: (event) => {
            const node = event.currentTarget
            pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60
            const now = Date.now()
            if (onScrollTop && now - scrollSent.current > 250) {
              scrollSent.current = now
              onScrollTop(node.scrollTop, pinned.current)
            }
          },
        },
          entries.length === 0 && !live
            ? h('div', { style: S.empty },
              streamState === 'error'
                ? h('div', null,
                  h('div', { style: { marginBottom: '8px' } },
                    'Could not open the transcript. The device may be unreachable, or it refused the stream.'),
                  h('button', {
                    type: 'button',
                    style: S.button,
                    onClick: () => setAttempt((value) => value + 1),
                  }, 'Retry'))
                : streamState === 'connecting'
                  ? 'Connecting to the device…'
                  : (blank
                    ? 'This session is empty. Send a message to start it.'
                    : 'No messages yet. Send one below.'))
            : entries.map((entry) => renderEntry(entry)),
          streamState === 'error' && entries.length > 0
            ? h('div', { style: S.note }, 'Stream lost — retrying…')
            : null,
          live ? h('div', { style: { ...S.bubble, ...S.assistantBubble, opacity: 0.85 } }, live) : null,
        ),
        configBar,
        h('div', { style: S.composer, onDragOver: (event) => event.preventDefault(), onDrop: dropFiles },
          pendingFiles.length > 0 || uploading
            ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 } },
                pendingFiles.map((file, index) => h('span', {
                  key: `${file.name}-${index}`,
                  style: {
                    display: 'inline-flex', gap: 6, alignItems: 'center', padding: '2px 8px',
                    borderRadius: 999, background: 'rgba(127,127,127,0.18)', fontSize: 12,
                  },
                },
                  `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`,
                  h('button', {
                    type: 'button',
                    title: 'Remove',
                    style: { border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', padding: 0 },
                    onClick: () => setPendingFiles((current) => current.filter((_, position) => position !== index)),
                  }, '✕'),
                )),
                uploading
                  ? h('span', { style: { fontSize: 12, opacity: 0.8 } }, `Uploading ${uploading.name} ${Math.round(uploading.progress * 100)}%`)
                  : null,
              )
            : null,
          h('textarea', {
            style: S.input,
            rows: 1,
            value: draft,
            placeholder: 'Message this device…',
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() }
            },
          }),
          h('label', { style: { ...S.button, cursor: 'pointer' }, title: 'Attach files' },
            'Attach',
            h('input', {
              type: 'file',
              multiple: true,
              style: { display: 'none' },
              onChange: (event) => { addFiles(event.target.files); event.target.value = '' },
            }),
          ),
          running ? h('button', { type: 'button', style: { ...S.button, ...S.danger }, onClick: stop }, 'Stop') : null,
          h('button', {
            type: 'button',
            style: { ...S.button, ...S.primary },
            onClick: send,
            disabled: uploading !== null || (!draft.trim() && pendingFiles.length === 0),
          }, uploading ? 'Uploading…' : 'Send'),
        ),
      )
    }

    function renderEntry(entry) {
      if (entry.kind === 'user') return h('div', { key: entry.key, style: { ...S.bubble, ...S.userBubble } }, entry.text)
      if (entry.kind === 'assistant') return h('div', { key: entry.key, style: { ...S.bubble, ...S.assistantBubble } }, entry.text)
      if (entry.kind === 'tool') return h('div', { key: entry.key, style: S.toolRow }, `⚙ ${entry.text}`)
      return h('div', { key: entry.key, style: S.note }, entry.text)
    }

    function blocksText(content) {
      if (typeof content === 'string') return content
      if (!Array.isArray(content)) return ''
      return content.map((block) => (block && block.type === 'text' ? String(block.text ?? '') : '')).join('')
    }

    function toEntry(event, seen) {
      if (!event || typeof event.seq !== 'number' || seen.has(event.seq)) return null
      seen.add(event.seq)
      const key = `e${event.seq}`
      const data = event.data || {}
      switch (event.type) {
        case 'user/message': {
          const kind = data.source?.kind
          if (kind && kind !== 'user') return null
          const text = blocksText(data.content ?? data.message?.content)
          return text ? { key, kind: 'user', text } : null
        }
        case 'assistant/message': {
          const text = blocksText(data.message?.content)
          return text ? { key, kind: 'assistant', text } : null
        }
        case 'tool/call':
          return { key, kind: 'tool', text: String(data.name || 'tool') }
        case 'turn/start':
          return { key, kind: 'turn-start' }
        case 'turn/end':
          return { key, kind: 'turn-end' }
        case 'session/title':
          return null
        default:
          return null
      }
    }

    /* ---------------- devices page ---------------- */

    function DevicesPage() {
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(null)
      const [openPeer, setOpenPeer] = useState(null)
      const [sessions, setSessions] = useState(null)
      const [sessionId, setSessionId] = useState(null)
      const [notice, setNotice] = useState(null)
      const [wizardSkipped, setWizardSkipped] = useState(false)
      const savedTarget = useRef(readSavedTarget())
      const restoredTarget = useRef(false)
      const scrollPos = useRef({
        scrollTop: savedTarget.current?.scrollTop ?? 0,
        pinned: savedTarget.current?.pinned ?? true,
      })
      const [relayOpen, setRelayOpen] = useState(false)
      const [relayUrl, setRelayUrl] = useState('')
      const [relayKey, setRelayKey] = useState('')
      const [reachability, setReachability] = useState(null)

      const refresh = useCallback(async () => {
        try {
          const value = await api('/remote-control/api/state')
          setState(value)
          setError(null)
        } catch (failure) {
          setError(failure.message)
        }
      }, [])

      useEffect(() => {
        let alive = true
        refresh()
        const timer = setInterval(() => { if (alive) refresh() }, 3000)
        return () => { alive = false; clearInterval(timer) }
      }, [refresh])

      // Persist the selection (and scroll position) per browser and Host.
      useEffect(() => {
        if (!openPeer) return
        const value = {
          peerId: openPeer.deviceId,
          sessionId: sessionId ?? null,
          scrollTop: scrollPos.current.scrollTop,
          pinned: scrollPos.current.pinned,
        }
        writeSavedTarget(value)
      }, [openPeer, sessionId])

      const approve = useCallback(async (requestId) => {
        setBusy(requestId)
        try { await api('/remote-control/api/approve', { requestId }) } catch (failure) { setError(failure.message) }
        setBusy(null)
        refresh()
      }, [refresh])

      const deny = useCallback(async (requestId) => {
        setBusy(requestId)
        try { await api('/remote-control/api/deny', { requestId }) } catch (failure) { setError(failure.message) }
        setBusy(null)
        refresh()
      }, [refresh])

      const connect = useCallback(async (deviceId) => {
        setBusy(deviceId)
        try { await api('/remote-control/api/connect', { deviceId }) } catch (failure) { setError(failure.message) }
        setBusy(null)
        refresh()
      }, [refresh])

      const revoke = useCallback(async (deviceId) => {
        setBusy(deviceId)
        try {
          await api('/remote-control/api/revoke', { deviceId })
          setOpenPeer(null)
        } catch (failure) {
          setError(failure.message)
        }
        setBusy(null)
        refresh()
      }, [refresh])

      const installTunnel = useCallback(async () => {
        if (!window.confirm('Download and verify the pinned cloudflared build from Cloudflare\'s GitHub release?')) return
        setBusy('service')
        try {
          const result = await api('/remote-control/api/service/tunnel/install', { consent: true })
          if (result && result.ok === false) setError(result.message || result.error)
        } catch (failure) {
          setError(failure.message)
        }
        setBusy(null)
        refresh()
      }, [refresh])

      const setupChoice = useCallback(async (choice, invite) => {
        setBusy('setup')
        setError(null)
        try {
          if (choice === 'lan') {
            await api('/remote-control/api/service/start', { provider: 'lan-only' })
            await api('/remote-control/api/setup/complete', { mode: 'lan', provider: 'lan-only' })
          } else if (choice === 'relay-host') {
            await api('/remote-control/api/relay/host', {})
            await api('/remote-control/api/service/start', { provider: 'relay' })
            await api('/remote-control/api/setup/complete', { mode: 'relay-host', provider: 'relay' })
          } else if (choice === 'tunnel') {
            const install = await api('/remote-control/api/service/tunnel/install', { consent: true })
            if (install && install.ok === false) throw new Error(install.message || install.error || 'cloudflared install failed')
            await api('/remote-control/api/service/start', { provider: 'tunnel' })
            await api('/remote-control/api/setup/complete', { mode: 'tunnel', provider: 'tunnel' })
          } else if (choice === 'relay-join') {
            const parts = String(invite || '').trim().split(/\s+/)
            const url = parts[0] || ''
            const [key, code = ''] = (parts[1] || '').split('#')
            await api('/remote-control/api/relay', { url, key, pairCode: code })
            await api('/remote-control/api/setup/complete', { mode: 'relay-join', provider: 'relay' })
          }
        } catch (failure) {
          setError(failure.message)
        }
        setBusy(null)
        refresh()
      }, [refresh])

      const serviceAction = useCallback(async (action) => {
        setBusy('service')
        try {
          await api('/remote-control/api/service/' + action, {})
        } catch (failure) {
          setError(failure.message)
        }
        setBusy(null)
        refresh()
      }, [refresh])

      const open = useCallback(async (peer) => {
        setOpenPeer(peer)
        setSessions(null)
        setSessionId(null)
        try {
          const value = await api(`/remote-control/api/peer/${encodeURIComponent(peer.deviceId)}/sessions`)
          const items = (value.items || []).slice().sort(
            (a, b) => Number(Boolean(a.blank)) - Number(Boolean(b.blank)) || (b.updatedAt || 0) - (a.updatedAt || 0),
          )
          setSessions(items)
          return items
        } catch (failure) {
          setError(failure.message)
          setSessions([])
          return []
        }
      }, [])

      // Restore the last peer/session (or a deep link) once both are known.
      useEffect(() => {
        const target = savedTarget.current
        if (!target || restoredTarget.current || !state?.peers) return
        const peer = state.peers.find((entry) => entry.deviceId === target.peerId && entry.approved)
        if (!peer) return
        restoredTarget.current = true
        ;(async () => {
          const items = await open(peer)
          if (target.sessionId && items.some((item) => item.id === target.sessionId)) {
            setSessionId(target.sessionId)
          } else if (target.sessionId) {
            setNotice('The saved session is no longer available on that device. Pick another one.')
          }
        })()
      }, [state, open])

      const saveRelay = useCallback(async () => {
        setBusy('relay')
        setError(null)
        const parts = relayUrl.trim().split(/\s+/)
        const url = parts[0] || ''
        const key = parts[1] || relayKey
        try {
          await api('/remote-control/api/relay', { url, key })
          setRelayKey('')
          setRelayOpen(false)
        } catch (failure) {
          setError(failure.message)
        }
        setBusy(null)
        refresh()
      }, [relayUrl, relayKey, refresh])

      const hostRelay = useCallback(async () => {
        setBusy('relay')
        setError(null)
        try {
          const value = await api('/remote-control/api/relay/host', { enabled: true })
          if (value?.reachability) setReachability(value.reachability)
        } catch (failure) {
          setError(failure.message)
        }
        setBusy(null)
        refresh()
      }, [refresh])

      const stopHosting = useCallback(async () => {
        setBusy('relay')
        try { await api('/remote-control/api/relay/host', { enabled: false }) } catch (failure) { setError(failure.message) }
        setReachability(null)
        setBusy(null)
        refresh()
      }, [refresh])

      const checkReachability = useCallback(async () => {
        setBusy('reach')
        setError(null)
        try {
          const value = await api('/remote-control/api/relay/reachability')
          setReachability(value)
        } catch (failure) {
          setError(failure.message)
        }
        setBusy(null)
      }, [])

      const clearRelay = useCallback(async () => {
        setBusy('relay')
        try { await api('/remote-control/api/relay/clear', {}) } catch (failure) { setError(failure.message) }
        setBusy(null)
        refresh()
      }, [refresh])

      const peers = state?.peers ?? []
      const requests = state?.requests ?? []
      const self = state?.self
      const relay = state?.relay

      // Prefer a reachable non-loopback name: a phone scan should never encode
      // 127.0.0.1, and the tailnet name also beats a bare LAN address.
      const pairingUrls = state?.pairing?.urls ?? []
      const pairingUrl = pairingUrls.find((url) => url.includes('.ts.net'))
        ?? pairingUrls.find((url) => !/127\.0\.0\.1|localhost/.test(url))
        ?? pairingUrls[0]
        ?? ''
      const pairScan = pairingUrl && state?.pairing?.code ? `${pairingUrl}?code=${state.pairing.code}` : ''

      return h('div', { style: S.page },
        state && state.setup && state.setup.completed === false && !wizardSkipped
          ? h(SetupWizard, { busy, error, onChoose: setupChoice, onSkip: () => setWizardSkipped(true) })
          : null,
        h('div', { style: S.header },
          h('div', null,
            h('h2', { style: S.title }, 'Devices'),
            h('div', { style: S.subtitle },
              self ? `${self.deviceName} · ${shortAccount(self.userId)} · port ${self.port}` : 'Discovering…'),
          ),
          h('div', { style: S.grow }),
          h('span', { style: { ...S.chip, ...(relay?.connected ? S.chipOk : {}) } },
            relay?.connected ? `Relay · ${relay.peers}` : 'LAN only'),
          h('button', { type: 'button', style: S.button, onClick: () => setRelayOpen((value) => !value) }, 'Relay'),
          h('span', { style: S.chip }, `${peers.length} found`),
          h('button', { type: 'button', style: S.button, onClick: refresh }, 'Refresh'),
        ),
        notice
          ? h('div', { style: { ...S.notice, display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: { flex: 1 } }, notice),
            h('button', { type: 'button', style: S.button, onClick: () => setNotice(null) }, 'Dismiss'),
          )
          : null,
        state?.service
          ? h('div', { style: { ...S.notice, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h('span', { style: { fontWeight: 600 } }, 'Service'),
            h('span', { style: { ...S.chip, ...(state.service.healthy ? S.chipOk : S.chipWarn) } }, state.service.healthy ? 'healthy' : 'unhealthy'),
            h('span', { style: S.meta }, state.service.provider + (state.service.since ? ' · up ' + uptimeText(state.service.since) : '')),
            state.service.endpoint
              ? h('span', { style: { ...S.meta, maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: state.service.endpoint }, state.service.endpoint)
              : null,
            state.service.lastError
              ? h('span', { style: { ...S.chip, ...S.chipBad }, title: state.service.lastError.message }, state.service.lastError.code)
              : null,
            h('div', { style: { flex: 1 } }),
            state.service.provision && !state.service.provision.installed
              ? h('button', { type: 'button', style: S.button, disabled: busy === 'service', onClick: installTunnel }, 'Download & verify v' + state.service.provision.version)
              : null,
            h('button', { type: 'button', style: S.button, disabled: busy === 'service', onClick: () => serviceAction('start') }, 'Start'),
            h('button', { type: 'button', style: S.button, disabled: busy === 'service', onClick: () => serviceAction('stop') }, 'Stop'),
            state.service.endpoint
              ? h('img', {
                alt: 'Service URL QR',
                src: '/remote-control/api/qr?text=' + encodeURIComponent(state.service.endpoint),
                style: { width: '84px', height: '84px', background: '#fff', borderRadius: '8px', padding: '4px' },
              })
              : null,
          )
          : null,
        state?.pairing?.code
          ? h('div', { style: { ...S.notice, display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '240px' } },
              h('span', { style: S.meta }, 'Pairing code — enter it on the phone, or scan the code to pair automatically'),
              h('span', {
                style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '30px', letterSpacing: '8px', fontWeight: 600 },
                onDblClick: () => { try { navigator.clipboard?.writeText(state.pairing.code) } catch { /* ignore */ } },
              }, state.pairing.code),
              ...pairingUrls.map((url) => h('a', {
                key: url,
                href: url,
                target: '_blank',
                rel: 'noreferrer',
                style: { ...S.meta, color: 'inherit' },
              }, url)),
            ),
            pairScan
              ? h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } },
                h('img', {
                  alt: 'Pairing QR code',
                  src: '/remote-control/api/qr?text=' + encodeURIComponent(pairScan),
                  style: { width: '132px', height: '132px', background: '#fff', borderRadius: '8px', padding: '6px' },
                }),
                h('span', { style: S.meta }, 'Scan to pair'),
                h('a', {
                  href: pairScan,
                  target: '_blank',
                  rel: 'noreferrer',
                  style: { ...S.meta, color: 'inherit', maxWidth: '220px', overflowWrap: 'anywhere', textAlign: 'center' },
                }, pairScan),
              )
              : null,
          )
          : null,
        error ? h('div', { style: S.error }, error) : null,

        relayOpen
          ? h('div', { style: S.notice },
            relay?.hosted
              ? h('div', null,
                h('div', { style: { ...S.meta, marginBottom: '6px' } },
                  'This device is hosting the relay. Paste this invite into the other device’s Relay panel.'),
                relay.invite
                  ? h('img', {
                    alt: 'Invite QR code',
                    src: `/remote-control/api/qr?text=${encodeURIComponent(relay.invite)}`,
                    style: { width: '184px', height: '184px', marginBottom: '10px', background: '#fff', borderRadius: '8px', padding: '6px' },
                  })
                  : null,
                h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
                  h('input', {
                    style: { ...S.field, flex: 1, minWidth: '260px' },
                    readOnly: true,
                    value: relay.invite || '',
                    onFocus: (event) => event.target.select(),
                  }),
                  h('button', {
                    type: 'button',
                    style: S.button,
                    onClick: () => { try { navigator.clipboard?.writeText(relay.invite || '') } catch { /* ignore */ } },
                  }, 'Copy'),
                  h('button', { type: 'button', style: S.button, disabled: busy === 'relay', onClick: stopHosting }, 'Stop hosting'),
                ),
                h('div', { style: { ...S.meta, marginTop: '6px' } },
                  `Reachable at ${(relay.urls || []).join(', ') || 'this machine'} — forward that port (or set publicUrl) so other networks can reach it.`),
                h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } },
                  h('button', {
                    type: 'button',
                    style: S.button,
                    disabled: busy === 'reach',
                    onClick: checkReachability,
                  }, 'Check reachability'),
                  reachability
                    ? h('span', { style: { ...S.meta, flex: 1 } },
                      reachability.ok
                        ? `Reachable at ${reachability.url}${reachability.upnp?.mapped ? ' (UPnP mapping)' : ''}`
                        : `Not reachable${reachability.upnp?.available === false ? ' — no UPnP gateway on this network' : reachability.hint ? ` — ${reachability.hint}` : ''}`)
                    : null,
                ),
              )
              : h('div', null,
                h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
                  h('input', {
                    style: S.field,
                    placeholder: 'relay URL or invite',
                    value: relayUrl,
                    onChange: (event) => setRelayUrl(event.target.value),
                  }),
                  h('input', {
                    style: S.field,
                    type: 'password',
                    placeholder: 'workspace key',
                    value: relayKey,
                    onChange: (event) => setRelayKey(event.target.value),
                  }),
                  h('button', {
                    type: 'button',
                    style: { ...S.button, ...S.primary },
                    disabled: busy === 'relay' || !relayUrl.trim(),
                    onClick: saveRelay,
                  }, 'Connect'),
                  h('button', { type: 'button', style: S.button, disabled: busy === 'relay', onClick: hostRelay }, 'Create relay here'),
                  relay?.connected
                    ? h('button', { type: 'button', style: S.button, disabled: busy === 'relay', onClick: clearRelay }, 'Disconnect')
                    : null,
                ),
                h('div', { style: { ...S.meta, marginTop: '6px' } },
                  'Paste an invite (URL and key), or create a relay here and share it with your other devices.'),
              ),
          )
          : null,

        requests.length > 0
          ? h('div', null, requests.map((request) => h('div', { key: request.requestId, style: S.notice },
            h('div', { style: { marginBottom: '8px' } },
              h('strong', null, request.deviceName),
              ` wants to control this computer (account ${shortAccount(request.userId)}).`),
            h('div', { style: { ...S.meta, marginBottom: '8px' } },
              [
                request.sas ? `SAS ${request.sas}` : '',
                request.fingerprint ? `key ${String(request.fingerprint).slice(0, 12)}` : '',
                request.relay ? `via ${request.relay}` : '',
                request.relayChanged ? 'relay changed since the last approval' : '',
              ].filter(Boolean).join(' · ')),
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('button', {
                type: 'button', style: { ...S.button, ...S.primary }, disabled: busy === request.requestId,
                onClick: () => approve(request.requestId),
              }, 'Allow'),
              h('button', {
                type: 'button', style: S.button, disabled: busy === request.requestId,
                onClick: () => deny(request.requestId),
              }, 'Deny'),
            ),
          )))
          : null,

        h('div', { style: S.body },
          h('div', { style: { ...S.column, ...S.pane } },
            h('div', { style: S.list },
              peers.length === 0
                ? h('div', { style: S.empty }, 'No other DSH device found on this network yet.')
                : peers.map((peer) => h('div', {
                  key: peer.deviceId,
                  style: {
                    ...S.row,
                    ...(peer.approved ? S.rowButton : {}),
                    ...(openPeer?.deviceId === peer.deviceId ? S.rowActive : {}),
                  },
                  onClick: peer.approved ? () => open(peer) : undefined,
                },
                  h('div', { style: { flex: 1, minWidth: 0 } },
                    h('div', { style: S.name }, peer.deviceName),
                    h('div', { style: S.meta }, `${peer.address}:${peer.port} · ${peer.userId ? shortAccount(peer.userId) : 'signed out'} · ${peer.transport === 'relay' ? 'relay' : 'LAN'} · ${relativeTime(peer.lastSeen)}`),
                  ),
                  peer.approved
                    ? h('span', { style: { ...S.chip, ...S.chipOk } }, 'Trusted')
                    : null,
                  peer.approved
                    ? h('span', {
                      style: { ...S.chip, ...(peer.forwardSecrecy ? S.chipOk : S.chipWarn) },
                      title: peer.forwardSecrecy ? 'Ephemeral channel established' : 'Only static agreement (restart or re-approve to refresh)',
                    }, peer.forwardSecrecy ? 'E2E' : 'static')
                    : null,
                  peer.approved && peer.fingerprint
                    ? h('span', { style: S.meta, title: `fingerprint ${peer.fingerprint}` }, String(peer.fingerprint).slice(0, 8))
                    : null,
                  peer.approved && Array.isArray(peer.scopes)
                    ? h('span', { style: S.meta, title: peer.scopes.join(', ') }, `${peer.scopes.length} scopes`)
                    : null,
                  peer.approved && peer.needsReapproval
                    ? h('span', {
                      style: { ...S.chip, ...S.chipBad },
                      title: 'This approval has no agreement key; approve again to enable encryption',
                    }, 'Re-approve')
                    : null,
                  peer.approved
                    ? h('button', {
                      type: 'button',
                      style: S.button,
                      disabled: busy === peer.deviceId,
                      onClick: (event) => { event.stopPropagation(); revoke(peer.deviceId) },
                    }, 'Revoke')
                    : peer.connecting
                      ? h('span', { style: { ...S.chip, ...S.chipWarn } }, 'Waiting')
                      : h('button', {
                        type: 'button', style: S.button, disabled: busy === peer.deviceId,
                        onClick: (event) => { event.stopPropagation(); connect(peer.deviceId) },
                      }, 'Request'),
                  peer.userId && self?.userId && peer.userId !== self.userId
                    ? h('span', { style: { ...S.chip, ...S.chipBad } }, 'Other account')
                    : null,
                )),
            ),
          ),

          openPeer
            ? h('div', { style: { ...S.column, flex: 1, minWidth: 0 } },
              sessions === null
                ? h('div', { style: S.empty }, 'Loading sessions…')
                : sessions.length === 0
                  ? h('div', { style: S.empty }, 'This device has no sessions.')
                  : h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } },
                    h('div', { style: { ...S.column, ...S.pane, width: '220px' } },
                      h('div', { style: S.list }, sessions.map((session) => h('div', {
                        key: session.id,
                        style: { ...S.row, ...S.rowButton, ...(sessionId === session.id ? S.rowActive : {}) },
                        onClick: () => setSessionId(session.id),
                      },
                        h('div', { style: { minWidth: 0 } },
                          h('div', { style: S.name }, session.title || session.cwd || session.id),
                          h('div', { style: S.meta },
                            [session.running ? 'running' : '', session.blank ? 'empty' : '', relativeTime(session.updatedAt)].filter(Boolean).join(' · ')),
                        ),
                      ))),
                    ),
                    sessionId
                      ? h(Chat, {
                        peerId: openPeer.deviceId,
                        sessionId,
                        title: sessions.find((session) => session.id === sessionId)?.title,
                        blank: sessions.find((session) => session.id === sessionId)?.blank === true,
                        initialScrollTop: savedTarget.current?.peerId === openPeer.deviceId
                          ? scrollPos.current.scrollTop
                          : 0,
                        initialPinned: scrollPos.current.pinned,
                        onScrollTop: (value, isPinned) => {
                          scrollPos.current.scrollTop = value
                          scrollPos.current.pinned = isPinned
                          writeSavedTarget({
                            peerId: openPeer.deviceId,
                            sessionId,
                            scrollTop: value,
                            pinned: isPinned,
                          })
                        },
                      })
                      : h('div', { style: S.empty }, 'Pick a session to control it.'),
                  ),
            )
            : h('div', { style: S.empty }, 'Select a trusted device to see its sessions.'),
        ),
      )
    }

    return {
      inject: ['slots'],
      // Exposed for the headless render test (scripts/client-render-test.mjs).
      __components: { Icon, DevicesPage, Chat, SetupWizard },
      // Persistence primitives, exposed for the UI test.
      __helpers: { readSavedTarget, writeSavedTarget },
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'devices', order: 20, label: () => 'Devices',
        }, Icon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'devices',
        }, DevicesPage))
      },
    }
  },
})
