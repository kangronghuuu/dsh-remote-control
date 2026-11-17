window.__ModuleLoader__.load({
  id: 'dsh-remote-control-plugin',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const S = {
      chevron: { fontSize: '11px', lineHeight: 1, opacity: 0.75 },
      page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0, overflow: 'hidden', color: 'var(--dsw-alias-label-primary)' },
      header: {
        display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      title: { fontSize: '15px', fontWeight: 600, margin: 0 },
      subtitle: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      grow: { flex: 1 },
      body: { display: 'flex', flex: 1, minHeight: 0, minWidth: 0 },
      column: { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 },
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
      // Secondary text that must stay readable: wraps instead of truncating.
      metaWrap: {
        fontSize: '11px', color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 0,
      },
      // A chat title shrinks with the panel instead of widening it.
      turnBanner: {
        display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 14px 0', padding: '8px 10px',
        borderRadius: '10px', fontSize: '12px', border: '1px solid var(--dsw-alias-state-warn-primary)',
        background: 'rgba(217, 164, 65, .12)',
      },
      turnBannerError: { borderColor: 'var(--dsw-alias-state-error-primary)', background: 'rgba(217, 83, 79, .12)' },
      runChip: {
        display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap', flex: '0 0 auto',
      },
      runChipOn: { color: 'var(--dsw-alias-state-success-primary)' },
      runDot: { width: '7px', height: '7px', borderRadius: '50%', background: 'currentColor', opacity: 0.5 },
      chatTitle: {
        fontSize: '13px', fontWeight: 600, flex: 1, minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      },
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
      log: { flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '8px' },
      bubble: {
        maxWidth: '78%', padding: '8px 11px', borderRadius: '12px', fontSize: '13px',
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', minWidth: 0,
        border: '1px solid var(--dsw-alias-border-l1)',
      },
      userBubble: { alignSelf: 'flex-end', background: 'var(--dsw-alias-bg-layer-2)' },
      assistantBubble: { alignSelf: 'flex-start', background: 'var(--dsw-alias-bg-layer-1)' },
      toolBlock: { alignSelf: 'flex-start', maxWidth: '100%', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      reasoningBlock: {
        marginBottom: '6px', paddingBottom: '6px', borderBottom: '1px dashed var(--dsw-alias-border-l1)',
        fontSize: '11px', color: 'var(--dsw-alias-label-secondary)',
      },
      reasoningBody: {
        margin: '4px 0 0', maxHeight: '220px', overflow: 'auto', whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere', fontSize: '11px', opacity: 0.9,
      },
      toolPre: {
        margin: '4px 0 0', padding: '8px', borderRadius: '8px', maxHeight: '260px', overflow: 'auto',
        background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.12))',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', whiteSpace: 'pre-wrap',
      },
      copyButton: {
        marginTop: '4px', padding: '2px 7px', borderRadius: '6px', fontSize: '10px', cursor: 'pointer',
        background: 'transparent', color: 'inherit', border: '1px solid var(--dsw-alias-border-l1)',
      },
      turnNav: { display: 'flex', alignItems: 'center', gap: '8px', alignSelf: 'flex-start' },
      turnStep: {
        padding: '0 7px', borderRadius: '6px', fontSize: '13px', lineHeight: '1.7', cursor: 'pointer',
        background: 'transparent', color: 'inherit', border: '1px solid var(--dsw-alias-border-l1)',
      },
      hitlStack: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 0' },
      imageRow: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' },
      messageImage: { maxWidth: '180px', maxHeight: '180px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', cursor: 'zoom-in' },
      queueList: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 0' },
      queueRow: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', opacity: 0.9 },
      queueButton: {
        padding: '1px 7px', borderRadius: '6px', fontSize: '10px', cursor: 'pointer',
        background: 'transparent', color: 'inherit', border: '1px solid var(--dsw-alias-border-l1)',
      },
      modeRow: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0, paddingBottom: '4px' },
      smallButton: {
        padding: '1px 8px', borderRadius: '6px', fontSize: '11px', lineHeight: '1.7', cursor: 'pointer',
        background: 'transparent', color: 'inherit', border: '1px solid var(--dsw-alias-border-l1)',
      },
      fileChip: {
        padding: '2px 8px', borderRadius: '999px', fontSize: '11px', cursor: 'pointer',
        background: 'transparent', color: 'inherit', border: '1px solid var(--dsw-alias-border-l1)',
      },
      sheet: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 },
      sheetCard: {
        width: 'min(92vw, 640px)', maxHeight: '80vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '8px',
        padding: '14px', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
      },
      sheetImage: { maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: '8px', alignSelf: 'center' },
      sheetText: { margin: 0, padding: '8px', borderRadius: '8px', fontSize: '11px', whiteSpace: 'pre-wrap', maxHeight: '52vh', overflow: 'auto', background: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.12))' },
      pendingRow: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', padding: '8px 12px', borderRadius: '10px', background: 'rgba(79,124,255,.10)' },
      pendingThumb: { width: '18px', height: '18px', borderRadius: '4px', objectFit: 'cover' },
      pendingChip: {
        display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '999px',
        fontSize: '11px', border: '1px solid var(--dsw-alias-border-l1)',
      },
      pendingRemove: { background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', padding: 0, fontSize: '12px' },
      hitlCard: {
        display: 'flex', flexDirection: 'column', gap: '6px', padding: '9px 11px', borderRadius: '10px',
        border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
      },
      toolRow: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', alignSelf: 'flex-start' },
      note: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', alignSelf: 'center' },
      composer: {
        display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', minWidth: 0, padding: '10px 14px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      input: {
        flex: 1, minWidth: 0, resize: 'none', font: 'inherit', fontSize: '13px', padding: '8px 10px', minHeight: '38px',
        maxHeight: '140px', borderRadius: '10px', color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
      },
      empty: { margin: 'auto', padding: '24px', textAlign: 'center', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' },
      pane: { width: '300px', borderRight: '1px solid var(--dsw-alias-border-l1)' },
      field: {
        font: 'inherit', fontSize: '12px', padding: '7px 9px', borderRadius: '8px',
        minWidth: 0, flex: '1 1 160px', maxWidth: '100%',
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

    /* ---------------- markdown ---------------- */

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    }

    function inlineMarkdown(text) {
      let out = escapeHtml(text)
      out = out.replace(/\`([^\`]+)\`/g, (whole, value) => {
        if (/^[a-z]+:/i.test(value) || value.includes(' ')) return '<code>' + value + '</code>'
        if (/\.\w{1,8}$/.test(value) && (value.includes('/') || value.startsWith('.'))) {
          return '<button type="button" class="rc-file" data-path="' + escapeHtml(value) + '">' + value + '</button>'
        }
        return '<code>' + value + '</code>'
      })
      out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, target) => {
        if (/^https?:\/\//i.test(target)) return '<a href="' + target + '" target="_blank" rel="noreferrer">' + label + '</a>'
        if (/^[a-z]+:/i.test(target)) return '<a href="' + target + '">' + label + '</a>'
        // A relative path is meaningful to the Host, not to the browser.
        if (/\.\w{1,8}$/.test(target) && (target.includes('/') || target.startsWith('.'))) {
          return '<button type="button" class="rc-file" data-path="' + escapeHtml(target) + '">' + label + '</button>'
        }
        return label
      })
      out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
      return out
    }

    // A deliberately small subset: fenced code, headings, tables, lists, quotes,
    // rules, bold/italic/code/links. Everything else stays literal text.
    function markdownHtml(text) {
      const lines = String(text ?? '').split('\n')
      const html = []
      let index = 0
      while (index < lines.length) {
        const line = lines[index]
        const fence = /^```(.*)$/.exec(line)
        if (fence) {
          const body = []
          index += 1
          while (index < lines.length && !/^```/.test(lines[index])) { body.push(lines[index]); index += 1 }
          index += 1
          html.push('<pre><code>' + escapeHtml(body.join('\n')) + '</code></pre>')
          continue
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading) {
          const level = Math.min(6, heading[1].length + 2)
          html.push('<' + 'h' + level + '>' + inlineMarkdown(heading[2]) + '</' + 'h' + level + '>')
          index += 1
          continue
        }
        if (/^\s*(---|\*\*\*)\s*$/.test(line)) { html.push('<hr />'); index += 1; continue }
        if (/^\s*>/.test(line)) {
          const body = []
          while (index < lines.length && /^\s*>/.test(lines[index])) {
            body.push(lines[index].replace(/^\s*>\s?/, ''))
            index += 1
          }
          html.push('<blockquote>' + inlineMarkdown(body.join('\n')).replace(/\n/g, '<br />') + '</blockquote>')
          continue
        }
        if (/^\s*\|/.test(line) && /\s*\|\s*$/.test(line)) {
          const rows = []
          while (index < lines.length && /^\s*\|/.test(lines[index])) { rows.push(lines[index]); index += 1 }
          const cells = (row) => row.replace(/^\s*\||\|\s*$/g, '').split('|').map((cell) => cell.trim())
          const head = rows.shift()
          if (rows.length && /^[-: |]+$/.test(rows[0])) rows.shift()
          let table = '<table><thead><tr>' + (head ? cells(head) : []).map((cell) => '<th>' + inlineMarkdown(cell) + '</th>').join('') + '</tr></thead><tbody>'
          for (const row of rows) table += '<tr>' + cells(row).map((cell) => '<td>' + inlineMarkdown(cell) + '</td>').join('') + '</tr>'
          html.push(table + '</tbody></table>')
          continue
        }
        if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
          const ordered = /^\s*\d+\./.test(line)
          const items = []
          while (index < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[index])) {
            items.push(lines[index].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
            index += 1
          }
          const tag = ordered ? 'ol' : 'ul'
          html.push('<' + tag + '>' + items.map((item) => '<li>' + inlineMarkdown(item) + '</li>').join('') + '</' + tag + '>')
          continue
        }
        if (line.trim() === '') { index += 1; continue }
        const paragraph = [line]
        index += 1
        while (index < lines.length && lines[index].trim() !== '' && !/^\s*([-*+]|\d+\.)\s+|^\s*\||^\s*>|^```|^#{1,6}\s/.test(lines[index])) {
          paragraph.push(lines[index])
          index += 1
        }
        html.push('<p>' + paragraph.map((part) => inlineMarkdown(part)).join('<br />') + '</p>')
      }
      return html.join('\n')
    }

    // Telemetry that would bury the transcript; the web UI hides it too.
    const NOISE_EVENTS = new Set([
      'session-log-deepseek/delivery-accepted',
      'step/start', 'step/end',
      'job/registered', 'job/settled',
      'tool-workflow/agent-start', 'tool-workflow/agent-end',
      'agent/inbox/spliced',
    ])

    const PROCESS_LABELS = {
      'todo/write': 'plan updated',
      'workspace/changes': 'workspace changed',
      'approval/asked': 'approval requested',
      'approval/decided': 'approval decided',
      'command/run': 'command started',
      'command/done': 'command finished',
      'compaction/start': 'compacting context',
      'compaction/end': 'context compacted',
      'compaction/summary': 'context compacted',
      'compaction/prune': 'context pruned',
      'compact/start': 'compacting context',
      'compact/end': 'context compacted',
    }

    /* ---------------- diff + copy ---------------- */

    function looksLikeDiff(text) {
      const lines = String(text ?? '').split('\n').filter((line) => line.trim() !== '').slice(0, 60)
      if (lines.length < 2) return false
      const marks = lines.filter((line) => /^\+(?!\+\+)|^-(?!--)/.test(line)).length
      if (marks < 2) return false
      return lines.some((line) => /^@@/.test(line)) || marks / lines.length >= 0.3
    }

    function diffHtml(text) {
      return String(text ?? '').split('\n').map((line) => {
        const safe = escapeHtml(line)
        if (/^@@/.test(line)) return '<span class="rc-d-hunk">' + safe + '</span>'
        if (/^\+\+\+|^---/.test(line)) return '<span class="rc-d-meta">' + safe + '</span>'
        if (/^\+/.test(line)) return '<span class="rc-d-add">' + safe + '</span>'
        if (/^-/.test(line)) return '<span class="rc-d-del">' + safe + '</span>'
        return safe
      }).join('\n')
    }

    function copyText(value) {
      try {
        navigator.clipboard?.writeText(String(value ?? ''))
        return true
      } catch {
        return false
      }
    }

    function CopyButton({ value, label = 'copy' }) {
      const [done, setDone] = useState(false)
      return h('button', {
        type: 'button',
        style: S.copyButton,
        title: 'Copy',
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!copyText(value)) return
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        },
      }, done ? 'copied' : label)
    }

    /**
     * One pending approval or question raised on the peer that owns the session.
     * Answered over the peer channel, then the poll clears it.
     */
    function blocksFiles(content) {
      if (!Array.isArray(content)) return []
      return content
        .filter((block) => block && block.type === 'file' && block.attachment && typeof block.attachment === 'object')
        .map((block) => block.attachment)
    }

    function blocksReasoning(content) {
      if (!Array.isArray(content)) return ''
      return content
        .map((block) => (block && block.type === 'reasoning' ? String(block.text ?? '') : ''))
        .join('\n')
        .trim()
    }

    function blocksImages(content) {
      if (!Array.isArray(content)) return []
      return content
        .filter((block) => block && block.type === 'image' && block.attachment && typeof block.attachment === 'object')
        .map((block) => block.attachment)
    }

    /**
     * An image lives on the Host that owns the session, so it arrives as base64
     * over the peer channel and is shown from a data URL.
     */
    /**
     * An image the session produced: the file lives on the peer, so the bytes are
     * fetched raw and shown from a data URL.
     */
    function PathImage({ peerId, sessionId, filePath }) {
      const [src, setSrc] = useState('')
      useEffect(() => {
        let alive = true
        const url = '/remote-control/api/peer/' + encodeURIComponent(peerId) + '/file?sessionId=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(filePath) + '&raw=1'
        api(url).then((value) => {
          if (!alive || !value?.data) return
          setSrc('data:' + (value.mediaType || 'image/png') + ';base64,' + value.data)
        }).catch(() => {})
        return () => { alive = false }
      }, [peerId, sessionId, filePath])
      if (!src) return h('span', { style: S.meta }, '\ud83d\uddbc ' + filePath.split('/').pop())
      return h('img', {
        src,
        alt: filePath,
        style: S.messageImage,
        onClick: () => window.open(src, '_blank'),
      })
    }

    /** True when a block actually carries a durable attachment reference. */
    function hasAttachmentId(ref) {
      return Boolean(ref && typeof ref === 'object' && typeof ref.attachmentId === 'string' && ref.attachmentId !== '')
    }

    /** A block may describe a file by path instead of by attachment id. */
    function refPath(ref) {
      if (!ref) return ''
      if (typeof ref === 'string') return ref
      return String(ref.path || ref.filePath || ref.name || '')
    }

    function AttachmentImage({ peerId, sessionId, ref }) {
      const [src, setSrc] = useState('')
      useEffect(() => {
        if (!hasAttachmentId(ref)) return undefined
        let alive = true
        const url = '/remote-control/api/peer/' + encodeURIComponent(peerId) + '/attachment?ref=' + encodeURIComponent(JSON.stringify(ref))
        api(url).then((value) => {
          if (!alive || !value?.data) return
          setSrc('data:' + (value.mediaType || 'image/png') + ';base64,' + value.data)
        }).catch(() => {})
        return () => { alive = false }
      }, [peerId, ref])
      if (!src) {
        // No usable id: show the path as a file reference instead of requesting a
        // broken /attachment URL.
        const filePath = refPath(ref)
        return filePath
          ? h(PathImage, { peerId, sessionId, filePath })
          : h('span', { style: S.meta }, 'image')
      }
      return h('img', {
        src,
        alt: ref?.name || 'image',
        style: S.messageImage,
        onClick: () => window.open(src, '_blank'),
      })
    }

    /**
     * A non-image attachment: text opens inline, anything else downloads. The
     * bytes come over the peer channel like images do.
     */
    /** Extensions whose preview must not be read as text. */
    const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|svg)$/i
    const PDF_EXTENSION = /\.pdf$/i

    /** A file path on the peer: read it through the Host and show the text. */
    function PathSheet({ peerId, sessionId, filePath, onClose }) {
      const [state, setState] = useState({ status: 'loading', text: '', dataUrl: '', mediaType: '', size: 0 })
      useEffect(() => {
        let alive = true
        if (!filePath || !peerId) {
          setState({ status: 'error', text: '', dataUrl: '', mediaType: '', size: 0 })
          return undefined
        }
        const binary = IMAGE_EXTENSIONS.test(filePath) || PDF_EXTENSION.test(filePath)
        const url = '/remote-control/api/peer/' + encodeURIComponent(peerId) + '/file?sessionId=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(filePath) + (binary ? '&raw=1' : '')
        api(url).then((value) => {
          if (!alive) return
          if (binary && value?.data) {
            setState({ status: 'binary', text: '', dataUrl: 'data:' + (value.mediaType || 'application/octet-stream') + ';base64,' + value.data, mediaType: value.mediaType || '', size: Number(value.size) || 0 })
          } else if (value?.text !== undefined) {
            setState({ status: 'text', text: String(value.text), dataUrl: '', mediaType: value.mediaType || '', size: Number(value.size) || 0 })
          } else {
            setState({ status: 'error', text: '', dataUrl: '', mediaType: '', size: 0 })
          }
        }).catch(() => { if (alive) setState({ status: 'error', text: '', dataUrl: '', mediaType: '', size: 0 }) })
        return () => { alive = false }
      }, [peerId, sessionId, filePath])
      return h('div', { style: S.sheet, onClick: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { style: S.sheetCard },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('strong', { style: { flex: 1, fontSize: '13px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, filePath),
            h('button', { type: 'button', style: S.button, onClick: onClose }, 'Close'),
          ),
          state.status === 'loading' ? h('div', { style: S.meta }, 'Loading\u2026') : null,
          state.status === 'error' ? h('div', { style: S.meta }, 'Could not read this file.') : null,
          state.status === 'text'
            ? h('pre', { style: S.sheetText }, state.text || '(empty file)')
            : null,
          state.status === 'binary' && state.mediaType.startsWith('image/')
            ? h('img', { src: state.dataUrl, alt: filePath, style: S.sheetImage })
            : null,
          state.status === 'binary'
            ? h('a', { href: state.dataUrl, download: filePath.split('/').pop() || 'file', style: S.button }, 'Download')
            : null,
        ),
      )
    }

    function FileSheet({ peerId, ref, onClose }) {
      const [state, setState] = useState({ status: 'loading', text: '', dataUrl: '' })
      useEffect(() => {
        if (!hasAttachmentId(ref)) {
          setState({ status: 'error', text: '', dataUrl: '' })
          return undefined
        }
        let alive = true
        const url = '/remote-control/api/peer/' + encodeURIComponent(peerId) + '/attachment?ref=' + encodeURIComponent(JSON.stringify(ref))
        api(url).then((value) => {
          if (!alive || !value?.data) { if (alive) setState({ status: 'error', text: '', dataUrl: '' }); return }
          const mediaType = value.mediaType || 'application/octet-stream'
          const dataUrl = 'data:' + mediaType + ';base64,' + value.data
          if (mediaType.startsWith('text/') || mediaType === 'application/json') {
            try {
              const text = decodeURIComponent(escape(window.atob(value.data)))
              setState({ status: 'text', text, dataUrl })
            } catch { setState({ status: 'binary', text: '', dataUrl }) }
          } else {
            setState({ status: 'binary', text: '', dataUrl })
          }
        }).catch(() => { if (alive) setState({ status: 'error', text: '', dataUrl: '' }) })
        return () => { alive = false }
      }, [peerId, ref])
      return h('div', { style: S.sheet, onClick: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { style: S.sheetCard },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('strong', { style: { flex: 1, fontSize: '13px' } }, ref?.name || 'Attachment'),
            h('button', { type: 'button', style: S.button, onClick: onClose }, 'Close'),
          ),
          state.status === 'loading' ? h('div', { style: S.meta }, 'Loading\u2026') : null,
          state.status === 'error' ? h('div', { style: S.meta }, 'Could not load this attachment.') : null,
          state.status === 'text' ? h('pre', { style: S.sheetText }, state.text) : null,
          state.status === 'binary'
            ? h('a', { href: state.dataUrl, download: ref?.name || 'attachment', style: S.button }, 'Download ' + (ref?.name || 'file'))
            : null,
        ),
      )
    }

    function HitlCard({ item, onAnswer }) {
      const question = Array.isArray(item.questions) ? item.questions[0] : null
      const options = Array.isArray(question?.options) ? question.options : []
      return h('div', { style: S.hitlCard },
        h('div', { style: { fontWeight: 600, fontSize: 12 } },
          (item.kind === 'approval' ? 'Approval needed' : 'Question') + (item.toolName ? ' \u00b7 ' + item.toolName : '')),
        item.displayReason || item.reason
          ? h('div', { style: S.metaWrap }, item.displayReason || item.reason)
          : null,
        item.kind === 'approval'
          ? h('div', { style: { display: 'flex', gap: '8px' } },
            h('button', { type: 'button', style: { ...S.button, ...S.primary }, onClick: () => onAnswer(item, { decision: 'allow' }) }, 'Allow'),
            h('button', { type: 'button', style: S.button, onClick: () => onAnswer(item, { decision: 'deny' }) }, 'Deny'),
          )
          : h('div', null,
            question?.question ? h('div', { style: S.meta }, question.question) : null,
            h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
              options.map((option) => h('button', {
                key: String(option.id ?? option.value ?? option.label),
                type: 'button',
                style: S.button,
                onClick: () => onAnswer(item, { answers: [option.value ?? option.label ?? option] }),
              }, String(option.label ?? option.value ?? option))),
            ),
          ),
      )
    }

    function Chat({ peerId, sessionId, title, blank, initialScrollTop, initialPinned, onScrollTop, onNewSession }) {
      const [entries, setEntries] = useState([])
      const [live, setLive] = useState('')
      const [liveReasoning, setLiveReasoning] = useState('')
      const [running, setRunning] = useState(false)
      const [draft, setDraft] = useState('')
      const [pendingFiles, setPendingFiles] = useState([])
      const [uploading, setUploading] = useState(null)
      useEffect(() => {
        if (document.getElementById('rc-md-style')) return
        const style = document.createElement('style')
        style.id = 'rc-md-style'
        style.textContent = [
          '.rc-md { display: flex; flex-direction: column; gap: 6px; }',
          '.rc-md p { margin: 0; }',
          '.rc-md h3, .rc-md h4, .rc-md h5 { margin: 2px 0; font-size: 13px; }',
          '.rc-md pre { margin: 0; padding: 8px; border-radius: 8px; overflow-x: auto; background: var(--dsw-alias-bg-layer-3, rgba(127,127,127,.12)); }',
          '.rc-md code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }',
          '.rc-md table { border-collapse: collapse; font-size: 12px; }',
          '.rc-md th, .rc-md td { border: 1px solid var(--dsw-alias-border-l1); padding: 3px 7px; text-align: left; }',
          '.rc-md blockquote { margin: 0; padding-left: 8px; border-left: 2px solid var(--dsw-alias-border-l1); opacity: .9; }',
          '.rc-md ul, .rc-md ol { margin: 0; padding-left: 18px; }',
          '.rc-md a { color: inherit; text-decoration: underline; }',
          '.rc-md hr { border: 0; border-top: 1px solid var(--dsw-alias-border-l1); }',
          '.rc-d-add { color: #6fe08b; }',
          '.rc-file { font: inherit; font-size: 0.92em; padding: 0 4px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1); background: rgba(127,127,127,.12); color: inherit; cursor: pointer; }',
          '.rc-d-del { color: #ff8c8c; }',
          '.rc-d-hunk { color: #7fb8ff; }',
          '.rc-d-meta { opacity: .8; font-weight: 600; }',
        ].join('\n')
        document.head.append(style)
      }, [])

      const [error, setError] = useState(null)
      const [streamState, setStreamState] = useState('connecting')
      const lastFrameAt = useRef(Date.now())
      // A stalled SSE connection fires no error at all: without a watchdog the
      // transcript just stops refreshing while the chip still says live.
      useEffect(() => {
        if (!peerId || !sessionId) return undefined
        const timer = setInterval(() => {
          if (Date.now() - lastFrameAt.current > 45_000) {
            lastFrameAt.current = Date.now()
            setAttempt((value) => value + 1)
          }
        }, 10_000)
        return () => clearInterval(timer)
      }, [peerId, sessionId])
      const [attempt, setAttempt] = useState(0)
      const [config, setConfig] = useState(null)
      const [configBusy, setConfigBusy] = useState(false)
      const seen = useRef(new Set())
      const chatRoot = useRef(null)
      const inputRef = useRef(null)
      const logRef = useRef(null)
      // Turn boundaries, so the transcript can be navigated turn by turn.
      const turnMark = useRef({ pending: false, count: 0 })
      const [turnCount, setTurnCount] = useState(0)
      const [turnCursor, setTurnCursor] = useState(0)
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
          lastFrameAt.current = Date.now()
          setStreamState('live')
          let frame
          try { frame = JSON.parse(event.data) } catch { return }
          if (frame.type === 'snapshot') {
            const batch = []
            for (const record of frame.records || []) {
              const entry = toEntry(record?.event, seen.current)
              if (entry) batch.push(entry)
            }
            if (batch.length > 0) setEntries((current) => mergeEntries(current, batch))
            return
          }
          if (frame.type === 'event') {
            const entry = toEntry(frame.event, seen.current)
            if (!entry) return
            if (entry.kind === 'turn-start') {
              turnMark.current.pending = true
              setRunning(true)
              return
            }
            if (entry.kind === 'turn-end') { setRunning(false); return }
            if (entry.kind === 'live-reset') { setLive(''); return }
            if (entry.kind === 'assistant') setLive('')
            setEntries((current) => mergeEntries(current, [entry]))
            return
          }
          if (frame.type === 'ping') { lastFrameAt.current = Date.now(); return }
          if (frame.type === 'assistant-stream') {
            const inner = frame.frame || {}
            if (inner.type === 'start') { setLive(''); setLiveReasoning(''); return }
            if (inner.type === 'chunk' && inner.chunk?.type === 'text-delta') {
              setLive((current) => current + String(inner.chunk.text ?? ''))
            }
            // Thinking streams as its own delta; dropping it was why reasoning
            // only appeared once the message finished.
            if (inner.type === 'chunk' && inner.chunk?.type === 'reasoning-delta') {
              setLiveReasoning((current) => (current + String(inner.chunk.text ?? '')).slice(0, 20_000))
            }
            if (inner.type === 'end') {
              setTimeout(() => { setLive(''); setLiveReasoning('') }, 700)
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
      }, [entries, running, runningKnown, sessionId])

      // Image chips get a local thumbnail so a paste is visibly accepted.
      const previews = useRef(new Map())
      const previewFor = (file) => {
        if (!file || !String(file.type || '').startsWith('image/')) return ''
        try {
          if (!previews.current.has(file)) previews.current.set(file, URL.createObjectURL(file))
          return previews.current.get(file)
        } catch {
          return ''
        }
      }

      const addFiles = useCallback((list) => {
        const files = Array.from(list ?? []).filter((file) => file && typeof file.size === 'number')
        if (files.length > 0) setPendingFiles((current) => [...current, ...files])
      }, [])

      // Paste anywhere in the chat, not only while the textarea has focus: the
      // window-level fallthrough used to drop the file into the app's own
      // composer, where this page could never see it.
      const readPastedFiles = (transfer) => {
        const files = []
        for (const item of transfer?.items ?? []) {
          if (item.kind !== 'file') continue
          const file = item.getAsFile()
          if (file) files.push(file)
        }
        // Some platforms only expose the list, not the item iterator.
        if (files.length === 0) {
          for (const file of transfer?.files ?? []) files.push(file)
        }
        return files
      }

      const handlePaste = useCallback((event) => {
        const files = readPastedFiles(event.clipboardData)
        if (files.length === 0) return false
        event.preventDefault()
        event.stopPropagation()
        addFiles(files)
        return true
      }, [addFiles])

      // A capture-phase listener on the document runs before the shell's own
      // handlers, but only acts while the focus is inside this chat: pasting into
      // the app's main composer must keep working normally.
      useEffect(() => {
        const onPaste = (event) => {
          const root = chatRoot.current
          const target = event.target
          const inChat = root && target instanceof Node && root.contains(target)
          if (!inChat) return
          handlePaste(event)
        }
        document.addEventListener('paste', onPaste, true)
        return () => document.removeEventListener('paste', onPaste, true)
      }, [handlePaste])

      // Third fallback: an explicit button that reads the clipboard directly. On
      // Electron this works even when the paste event was swallowed.
      const pasteFromClipboard = useCallback(async () => {
        try {
          const items = await navigator.clipboard.read()
          const files = []
          for (const item of items) {
            for (const type of item.types ?? []) {
              if (!type.startsWith('image/')) continue
              const blob = await item.getType(type)
              files.push(new File([blob], 'pasted.' + type.split('/')[1].replace('jpeg', 'jpg'), { type }))
            }
          }
          if (files.length === 0) {
            setError('Nothing image-like on the clipboard.')
            return
          }
          addFiles(files)
        } catch {
          setError('Clipboard read was blocked — use Attach or Ctrl+V.')
        }
      }, [addFiles])

      const dropFiles = useCallback((event) => {
        event.preventDefault()
        addFiles(event.dataTransfer?.files)
      }, [addFiles])

      // A tool result belongs to its call, not to a new row.
      const mergeEntries = (current, incoming) => {
        const next = current.slice()
        for (const original of incoming) {
          // The first entry after a turn/start belongs to that turn.
          const entry = turnMark.current.pending && original.kind !== 'turn-start'
            ? ((turnMark.current.pending = false), { ...original, turn: (turnMark.current.count += 1) })
            : original
          if (entry.turn) setTurnCount(entry.turn)
          if (entry.kind === 'tool-result') {
            let merged = false
            for (let index = next.length - 1; index >= 0; index -= 1) {
              const item = next[index]
              if (item.kind === 'tool' && item.callId === entry.callId) {
                next[index] = { ...item, output: entry.output, failed: entry.failed }
                merged = true
                break
              }
            }
            if (!merged) next.push({ ...entry, kind: 'tool', name: 'tool' })
            continue
          }
          next.push(entry)
        }
        return next
      }

      const jumpTurn = (direction) => {
        const total = turnMark.current.count
        if (total === 0) return
        const from = turnCursor || total
        const target = Math.min(total, Math.max(1, from + direction))
        setTurnCursor(target)
        const node = logRef.current?.querySelector('[data-turn="' + target + '"]')
        node?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }

      // A turn that stopped early (or never finished because the Host restarted)
      // has to be visible; a line in the transcript is easy to miss.
      const [turnAlert, setTurnAlert] = useState(null)
      // Until the Host reports a running flag we cannot tell "still running" from
      // "interrupted", so the interrupted alert waits for the first poll.
      const [runningKnown, setRunningKnown] = useState(false)
      const DISMISSED_KEY = 'dsh-remote-control:dismissed-alerts'
      const readDismissed = () => {
        try { return JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || '{}') || {} } catch { return {} }
      }
      const isDismissed = (info) => readDismissed()[String(info?.key || '')] === true
      const dismissTurnAlert = () => {
        if (turnAlert) {
          try {
            const map = readDismissed()
            map[String(turnAlert.key || '')] = true
            window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(map))
          } catch { /* ignore */ }
        }
        setTurnAlert(null)
      }

      useEffect(() => {
        // A turn that is still running has no end yet: that is normal, not an
        // interruption, so the alert is only computed once the peer says idle.
        let lastStart = null
        let lastEnd = null
        for (const entry of entries) {
          if (entry.kind === 'turn-start') lastStart = entry
          else if (entry.kind === 'turn-end') lastEnd = entry
        }
        if (running) { setTurnAlert(null); return }
        const seqOf = (entry) => Number(String(entry?.key || '').replace(/^e/, '')) || 0
        if (lastStart && (!lastEnd || seqOf(lastStart) > seqOf(lastEnd))) {
          // Still running, or not known yet: not an interruption.
          if (running || !runningKnown) { setTurnAlert(null); return }
          if (isDismissed(lastStart)) { setTurnAlert(null); return }
          setTurnAlert({ kind: 'interrupted', key: lastStart.key, text: 'The last turn was interrupted (no completion was recorded).' })
          return
        }
        const reason = lastEnd?.reason || {}
        const when = lastEnd?.at ? ' · ' + new Date(lastEnd.at).toLocaleTimeString() : ''
        if (lastEnd && isDismissed(lastEnd)) { setTurnAlert(null); return }
        if (reason.kind === 'aborted') setTurnAlert({ kind: 'aborted', key: lastEnd?.key, text: 'Turn interrupted — it was stopped before finishing.' + when })
        else if (reason.kind === 'interrupted') setTurnAlert({ kind: 'interrupted', key: lastEnd?.key, text: 'Turn was interrupted — the Host restarted or the link dropped. The answer above is incomplete.' + when })
        else if (reason.kind === 'max-tokens') setTurnAlert({ kind: 'max-tokens', key: lastEnd?.key, text: 'Turn stopped at the token limit; the answer is incomplete.' + when })
        else if (reason.kind === 'error') setTurnAlert({ kind: 'error', key: lastEnd?.key, text: 'Turn failed: ' + (reason.error?.message || reason.error?.code || 'unknown error') + when })
        else if (reason.kind && reason.kind !== 'completed') setTurnAlert({ kind: 'other', text: 'Turn ended unexpectedly (' + reason.kind + ')' + when })
        else setTurnAlert(null)
      }, [entries])

      const [hitl, setHitl] = useState([])
      const refreshHitl = useCallback(async () => {
        if (!peerId || !sessionId) return
        try {
          const value = await api('/remote-control/api/peer/' + encodeURIComponent(peerId) + '/hitl?sessionId=' + encodeURIComponent(sessionId))
          setHitl(Array.isArray(value?.items) ? value.items : [])
        } catch { /* older peer: nothing to show */ }
      }, [peerId, sessionId])
      useEffect(() => {
        refreshHitl()
        const timer = setInterval(refreshHitl, 3000)
        return () => clearInterval(timer)
      }, [refreshHitl])
      const answerHitl = async (item, payload) => {
        try {
          await api('/remote-control/api/peer/' + encodeURIComponent(peerId) + '/hitl-answer', { requestId: item.requestId, ...payload })
        } catch { /* stale card */ }
        refreshHitl()
      }

      // Queue and steering, mirroring the phone page: while a turn runs, a new
      // message can either wait in the queue or be injected into the turn.
      const [mode, setMode] = useState('queue')
      const [queue, setQueue] = useState([])
      const [queueNotice, setQueueNotice] = useState(null)
      const refreshQueue = useCallback(async () => {
        if (!peerId || !sessionId) return
        try {
          const value = await api('/remote-control/api/peer/' + encodeURIComponent(peerId) + '/state?sessionId=' + encodeURIComponent(sessionId))
          setQueue(Array.isArray(value?.queue) ? value.queue : [])
          // The Host knows whether the session is running; the replayed events do
          // not always, so trust this poll over event-derived flags.
          if (typeof value?.running === 'boolean') {
            setRunning(value.running)
            setRunningKnown(true)
          }
        } catch { /* peer has no state route */ }
      }, [peerId, sessionId])
      useEffect(() => {
        refreshQueue()
        const timer = setInterval(refreshQueue, 2500)
        return () => clearInterval(timer)
      }, [refreshQueue])
      const editQueued = async (item) => {
        // Editing means "take it back and change it": remove the queued item and
        // load its text into the composer.
        setDraft(String(item.text ?? ''))
        await queueAction(item, 'remove')
        requestAnimationFrame(() => inputRef.current?.focus())
      }

      const queueAction = async (item, kind) => {
        try {
          await api('/remote-control/api/peer/' + encodeURIComponent(peerId) + '/queue', { sessionId, itemId: item.id, kind })
        } catch { /* the item may already be gone */ }
        refreshQueue()
      }

      // Older pages, a new session, and the attachment sheet.
      const [earlier, setEarlier] = useState({ hasMore: false, cursor: null, loading: false })
      const [preview, setPreview] = useState(null)
      const loadEarlier = async () => {
        if (earlier.loading) return
        setEarlier((value) => ({ ...value, loading: true }))
        try {
          const query = '/remote-control/api/peer/' + encodeURIComponent(peerId) + '/history?sessionId=' + encodeURIComponent(sessionId) + (earlier.cursor ? '&before=' + encodeURIComponent(earlier.cursor) : '')
          const page = await api(query)
          const fresh = new Set()
          const older = []
          for (const record of page?.records || []) {
            const entry = toEntry(record?.event, fresh)
            if (entry && !entry.kind.endsWith('start') && !entry.kind.endsWith('end')) older.push(entry)
          }
          if (older.length > 0) setEntries((current) => older.concat(current.filter((entry) => !older.some((item) => item.key === entry.key))))
          setEarlier({ hasMore: Boolean(page?.hasMore), cursor: page?.cursor ?? null, loading: false })
        } catch {
          setEarlier((value) => ({ ...value, hasMore: false, loading: false }))
        }
      }
      const scrollJump = (where) => {
        const node = logRef.current
        if (!node) return
        node.scrollTo({ top: where === 'top' ? 0 : node.scrollHeight, behavior: 'smooth' })
      }

      // Attachments belong to the Host that owns the session, so they are uploaded
      // to the peer; uploading locally produced references the peer could not read.
      const uploadBase = '/remote-control/api/peer/' + encodeURIComponent(peerId) + '/upload'

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
            const init = await api(uploadBase + '/init', {
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
              await api(uploadBase + '/chunk', { uploadId, index, data: btoa(binary) })
              setUploading({ name: file.name, progress: Math.min(1, (offset + chunkSize) / Math.max(1, file.size)) })
            }
            const committed = await api(uploadBase + '/commit', { uploadId })
            if (committed?.attachment) {
              // The Host builds prompt content blocks from { type, attachment },
              // which is the same shape DSH's own paste produces. A bare ref was
              // silently dropped, which is why pasted images never arrived.
              sent.push({ type: committed.kind === 'image' ? 'image' : 'file', attachment: committed.attachment })
            }
          }
          setUploading(null)
          setPendingFiles([])
          await api(`/remote-control/api/peer/${encodeURIComponent(peerId)}/prompt`, { sessionId, text, attachments: sent, mode })
          setQueueNotice(mode === 'steer'
            ? 'Sent as a steer message into the running turn.'
            : running ? 'Queued — it runs after the current turn ends.' : 'Sent.')
        refreshQueue()
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

      return h('div', { ref: chatRoot, style: { ...S.column, flex: 1, minHeight: 0, minWidth: 0, width: '100%', maxWidth: '100%', overflow: 'hidden' }, onPaste: handlePaste },
        preview && typeof preview === 'string'
          ? h(PathSheet, { peerId, sessionId, filePath: preview, onClose: () => setPreview(null) })
          : preview
            ? h(FileSheet, { peerId, ref: preview, onClose: () => setPreview(null) })
            : null,
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px',
            borderBottom: '1px solid var(--dsw-alias-border-l1)', minWidth: 0,
          },
        },
        turnAlert
          ? h('div', { style: { ...S.turnBanner, ...(turnAlert.kind === 'error' ? S.turnBannerError : {}) } },
            h('span', { style: { flex: 1, minWidth: 0 } }, turnAlert.text),
            h('button', { type: 'button', style: S.smallButton, onClick: dismissTurnAlert }, 'Dismiss'),
          )
          : null,

          h('span', { style: S.chatTitle, title: title || sessionId }, title || sessionId),
          h('span', {
            style: { ...S.runChip, ...(running ? S.runChipOn : {}) },
            title: running ? 'A turn is running on the peer' : 'No turn is running',
          },
            h('span', { style: { ...S.runDot, ...(running ? { background: 'currentColor' } : {}) } }),
            running ? 'running' : 'idle',
          ),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 } },
          h('button', { type: 'button', style: S.smallButton, title: 'Scroll to top', onClick: () => scrollJump('top') }, '\u2191'),
          h('button', { type: 'button', style: S.smallButton, title: 'Scroll to bottom', onClick: () => scrollJump('bottom') }, '\u2193'),
          onNewSession
            ? h('button', { type: 'button', style: S.smallButton, onClick: onNewSession }, 'New')
            : null,
        ),
        error ? h('div', { style: S.error }, error) : null,
        turnCount > 0
          ? h('div', { style: S.turnNav },
            h('button', { type: 'button', style: S.turnStep, title: 'Previous turn', onClick: () => jumpTurn(-1) }, '\u2039'),
            h('span', { style: S.meta }, 'Turn ' + (turnCursor || turnCount) + '/' + turnCount),
            h('button', { type: 'button', style: S.turnStep, title: 'Next turn', onClick: () => jumpTurn(1) }, '\u203a'),
          )
          : null,
        earlier.hasMore
          ? h('button', {
            type: 'button',
            style: { ...S.smallButton, alignSelf: 'center' },
            disabled: earlier.loading,
            onClick: loadEarlier,
          }, earlier.loading ? 'Loading\u2026' : 'Load earlier messages')
          : null,
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
            : renderEntries(entries, { peerId, sessionId, onOpenFile: setPreview }),
          streamState === 'error' && entries.length > 0
            ? h('div', { style: S.note }, 'Stream lost — retrying…')
            : null,
          live || liveReasoning
            ? h('div', { style: { ...S.bubble, ...S.assistantBubble, opacity: 0.85 } },
              liveReasoning
                ? h('details', { style: S.reasoningBlock, open: true },
                  h('summary', { style: { cursor: 'pointer' } }, 'Reasoning \u00b7 streaming\u2026'),
                  h('div', { style: S.reasoningBody }, liveReasoning),
                )
                : null,
              live ? h('div', { style: { whiteSpace: 'pre-wrap' } }, live) : null,
            )
            : null,
        ),
        hitl.length > 0
          ? h('div', { style: S.hitlStack }, hitl.map((item) => h(HitlCard, { key: item.requestId, item, onAnswer: answerHitl })))
          : null,
        configBar,
        queueNotice
          ? h('div', { style: { ...S.metaWrap, padding: '4px 14px' } }, queueNotice)
          : null,
        queue.length > 0
          ? h('div', { style: S.queueList }, queue.map((item) => h('div', { key: item.id, style: S.queueRow },
            h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.text || '(attachment)'),
            h('button', { type: 'button', style: S.queueButton, onClick: () => editQueued(item) }, 'Edit'),
            h('button', { type: 'button', style: S.queueButton, onClick: () => queueAction(item, 'steer') }, 'Steer'),
            h('button', { type: 'button', style: S.queueButton, onClick: () => queueAction(item, 'remove') }, '×'),
          )))
          : null,
        h('div', { style: S.modeRow },
          ...['queue', 'steer'].map((name) => h('button', {
            key: name,
            type: 'button',
            style: { ...S.queueButton, ...(mode === name ? S.primary : {}) , textTransform: 'capitalize' },
            onClick: () => setMode(name),
          }, name)),
          h('span', { style: { ...S.metaWrap, flex: '1 1 auto' } }, mode === 'steer' ? 'inject into the running turn' : 'wait until the turn ends'),
        ),
        pendingFiles.length > 0
          ? h('div', { style: S.pendingRow },
            h('span', { style: { ...S.meta, fontWeight: 600 } }, 'Attached: ' + pendingFiles.length + ' file(s) — Ctrl+Enter to send'),
            pendingFiles.map((file, position) => h('span', { key: (file.name || 'file') + position, style: S.pendingChip },
            previewFor(file)
              ? h('img', { src: previewFor(file), alt: file.name || 'image', style: S.pendingThumb })
              : null,
            h('span', { style: { maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, file.name || 'file'),
            h('button', {
              type: 'button',
              style: S.pendingRemove,
              title: 'Remove',
              onClick: () => setPendingFiles((current) => current.filter((_, index) => index !== position)),
            }, '\u00d7'),
          )),
            )
          : null,
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
            ref: inputRef,
            style: S.input,
            rows: 1,
            value: draft,
            placeholder: 'Message this device…  (Enter = newline · Ctrl+Enter = send)',
            onChange: (event) => setDraft(event.target.value),

            onKeyDown: (event) => {
              // Enter is a newline here: prompts are often multi-line. Cmd/Ctrl+Enter
              // sends, which matches the desktop conventions people already have.
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                send()
              }
            },
          }),
          h('button', {
            type: 'button',
            style: S.button,
            title: 'Paste an image from the clipboard',
            onClick: pasteFromClipboard,
          }, 'Paste'),
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

    function wrapTurn(entry, node) {
      if (!entry || !entry.turn) return node
      return h('div', { key: 'turn-' + entry.key, 'data-turn': entry.turn, style: { display: 'contents' } }, node)
    }

    function renderEntries(entries, context = {}) {
      const nodes = []
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        if (entry.kind === 'process') {
          let count = 1
          while (index + 1 < entries.length && entries[index + 1].kind === 'process' && entries[index + 1].text === entry.text) {
            count += 1
            index += 1
          }
          nodes.push(wrapTurn(entry, h('div', { key: entry.key, style: S.toolRow }, `⚙ ${entry.text}${count > 1 ? ' ×' + count : ''}`)))
          continue
        }
        nodes.push(wrapTurn(entry, renderEntry(entry, context)))
      }
      return nodes
    }

    function splitVisualFiles(files) {
      const images = []
      const rest = []
      for (const ref of Array.isArray(files) ? files : []) {
        const name = String(ref?.name || ref?.path || '')
        if (IMAGE_EXTENSIONS.test(name)) images.push(ref)
        else rest.push(ref)
      }
      return { images, rest }
    }

    function renderEntry(entry, context = {}) {
      if (entry.kind === 'user') {
        const visuals = splitVisualFiles(entry.files)
        return h('div', { key: entry.key, style: { ...S.bubble, ...S.userBubble } },
          entry.text ? h('div', { style: { whiteSpace: 'pre-wrap' } }, entry.text) : null,
          entry.images?.length
            ? h('div', { style: S.imageRow }, entry.images.map((ref, position) => h(AttachmentImage, { key: (ref.attachmentId || '') + position, peerId: context.peerId, sessionId: context.sessionId, ref })))
            : null,
          visuals.images.length
            ? h('div', { style: S.imageRow }, visuals.images.map((ref, position) => h(PathImage, {
              key: 'up' + position,
              peerId: context.peerId,
              sessionId: context.sessionId,
              filePath: String(ref?.path || ref?.name || ''),
            })))
            : null,
          entry.files?.length
            ? h('div', { style: S.imageRow }, entry.files.map((ref, position) => h('button', {
              key: (ref.attachmentId || '') + position,
              type: 'button',
              style: S.fileChip,
              onClick: () => context.onOpenFile?.(ref),
            }, '\ud83d\udcc4 ' + (ref.name || 'file'))))
            : null,

        )
      }
      if (entry.kind === 'assistant') {
        const visuals = splitVisualFiles(entry.files)
        return h('div', { key: entry.key, style: { ...S.bubble, ...S.assistantBubble } },
          entry.images?.length
            ? h('div', { style: S.imageRow }, entry.images.map((ref, position) => h(AttachmentImage, { key: 'a' + position, peerId: context.peerId, sessionId: context.sessionId, ref })))
            : null,
          visuals.images.length
            ? h('div', { style: S.imageRow }, visuals.images.map((ref, position) => h(PathImage, {
              key: 'p' + position,
              peerId: context.peerId,
              sessionId: context.sessionId,
              filePath: String(ref?.path || ref?.name || ''),
            })))
            : null,
          entry.reasoning
            ? h('details', { style: S.reasoningBlock },
              h('summary', { style: { cursor: 'pointer' } }, 'Reasoning · ' + entry.reasoning.length + ' chars'),
              h('div', { style: S.reasoningBody }, entry.reasoning),
            )
            : null,
          h('div', {
            className: 'rc-md',
            dangerouslySetInnerHTML: { __html: markdownHtml(entry.text) },
            onClick: (event) => {
              const target = event.target.closest?.('.rc-file')
              if (!target) return
              event.preventDefault()
              const filePath = target.getAttribute('data-path')
              if (filePath) context.onOpenFile?.(filePath)
            },
          }),
          h(CopyButton, { value: entry.text }),
        )
      }
      if (entry.kind === 'tool') {
        const argsText = entry.args ? JSON.stringify(entry.args, null, 2) : entry.raw
        const hasResult = entry.output !== undefined
        return h('details', { key: entry.key, style: S.toolBlock },
          h('summary', { style: { cursor: 'pointer' } },
            '\u2699 ' + entry.name + (entry.hint ? '  ' + entry.hint : '') + (hasResult ? '' : '  \u2026')),
          argsText ? h('pre', { style: S.toolPre }, argsText) : null,
          hasResult
            ? (looksLikeDiff(entry.output)
              ? h('pre', {
                style: S.toolPre,
                className: 'rc-md',
                dangerouslySetInnerHTML: { __html: diffHtml(entry.output) },
              })
              : h('pre', { style: { ...S.toolPre, ...(entry.failed ? { color: '#ff8c8c' } : {}) } },
                entry.output || (entry.failed ? '(failed with no output)' : '(no output)')))
            : null,
          hasResult ? h(CopyButton, { value: entry.output || '' }) : null,
        )
      }
      if (entry.kind === 'compaction') {
        return h('details', { key: entry.key, style: S.toolBlock },
          h('summary', { style: { cursor: 'pointer' } }, 'Context compacted \u00b7 ' + entry.text.length + ' chars of summary'),
          h('div', { className: 'rc-md', dangerouslySetInnerHTML: { __html: markdownHtml(entry.text) } }),
        )
      }
      if (entry.kind === 'reasoning') {
        return h('details', { key: entry.key, style: S.toolBlock },
          h('summary', { style: { cursor: 'pointer' } }, 'thinking\u2026'),
          h('div', { style: { whiteSpace: 'pre-wrap', fontSize: 12 } }, entry.text),
        )
      }
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
          const content = data.content ?? data.message?.content
          const text = blocksText(content)
          const images = blocksImages(content)
          const files = blocksFiles(content)
          if (!text && images.length === 0 && files.length === 0) return null
          return { key, kind: 'user', text, images, files }
        }
        case 'assistant/message': {
          const content = data.message?.content
          const text = blocksText(content)
          const images = blocksImages(content)
          const files = blocksFiles(content)
          // The model's thinking is a reasoning block in the same content array.
          const reasoning = blocksReasoning(content).slice(0, 20_000)
          if (!text && !reasoning && images.length === 0 && files.length === 0) return null
          return { key, kind: 'assistant', text, images, files, reasoning }
        }
        case 'tool/call': {
          const name = String(data.name || 'tool')
          let args = null
          try { args = JSON.parse(data.arguments || '{}') } catch { args = null }
          const hint = args && typeof args === 'object'
            ? String(args.command || args.path || args.file_path || args.query || args.description || '').replace(/\s+/g, ' ').slice(0, 90)
            : ''
          return {
            key,
            kind: 'tool',
            callId: String(data.callId || data.id || ''),
            name,
            args,
            raw: typeof data.arguments === 'string' ? data.arguments : '',
            hint,
          }
        }
        case 'tool/result': {
          const output = blocksText(data.message?.content)
          return {
            key,
            kind: 'tool-result',
            callId: String(data.message?.toolCallId || data.callId || ''),
            output,
            failed: Boolean(data.error) || data.message?.isError === true,
          }
        }
        case 'assistant/attempt': {
          const reasoning = String(data.reasoning ?? data.message?.reasoning ?? '').trim()
          return reasoning ? { key, kind: 'reasoning', text: reasoning } : null
        }
        case 'turn/start':
          return { key, kind: 'turn-start' }
        case 'turn/end':
          return { key, kind: 'turn-end', reason: data.reason || {}, at: data.at || data.endedAt || null }
        case 'session/title':
          return null
        case 'compaction/summary':
        case 'compact/summary': {
          const summary = String(data.summary ?? data.text ?? data.content ?? '')
          return summary ? { key, kind: 'compaction', text: summary } : null
        }
        default: {
          if (NOISE_EVENTS.has(event.type)) return null
          return { key, kind: 'process', text: PROCESS_LABELS[event.type] || event.type }
        }
      }
    }

    /* ---------------- devices page ---------------- */

    /**
     * A section that folds down to one summary line. The open state is kept per
     * browser so the page opens the way the user left it.
     */
    function Collapsible({ title, summary, storageKey, defaultOpen = false, forceClose = 0, children }) {
      const [open, setOpen] = useState(() => {
        try {
          const saved = window.localStorage.getItem('dsh-remote-control:section:' + storageKey)
          return saved === null ? defaultOpen : saved === '1'
        } catch { return defaultOpen }
      })
      // Picking a device or a session folds the picker so the transcript gets the
      // whole width; the header line stays clickable to bring it back.
      useEffect(() => {
        if (forceClose) setOpen(false)
      }, [forceClose])
      const toggle = () => {
        setOpen((value) => {
          const next = !value
          try { window.localStorage.setItem('dsh-remote-control:section:' + storageKey, next ? '1' : '0') } catch { /* ignore */ }
          return next
        })
      }
      return h('div', { style: { ...S.notice, display: 'flex', flexDirection: 'column', gap: open ? '12px' : '0px' } },
        h('div', {
          role: 'button',
          tabIndex: 0,
          'aria-expanded': open,
          onClick: toggle,
          onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle() } },
          style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', minHeight: '22px' },
        },
          h('span', { style: S.chevron }, open ? '\u25BE' : '\u25B8'),
          h('span', { style: { fontWeight: 600 } }, title),
          summary ? h('span', { style: { ...S.meta, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, summary) : null,
          h('div', { style: { flex: 1 } }),
          h('span', { style: S.meta }, open ? 'hide' : 'show'),
        ),
        open ? children : null,
      )
    }

    class PageErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error, info) {
        console.error('[remote-control] page render failed', error, info?.componentStack)
      }
      render() {
        if (!this.state.error) return this.props.children
        const message = String(this.state.error?.message || this.state.error)
        const stack = String(this.state.error?.stack || '').split('\n').slice(0, 8).join('\n')
        return h('div', { style: { padding: '16px', fontSize: '12px', color: 'var(--dsw-alias-label-primary)', display: 'flex', flexDirection: 'column', gap: '8px' } },
          h('strong', null, 'Remote Control page failed to render'),
          h('pre', { style: { whiteSpace: 'pre-wrap', margin: 0, opacity: 0.85 } }, message),
          h('pre', { style: { whiteSpace: 'pre-wrap', margin: 0, fontSize: '10px', opacity: 0.6 } }, stack),
        )
      }
    }

    function DevicesPage() {
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(null)
      const [openPeer, setOpenPeer] = useState(null)
      const [sessions, setSessions] = useState(null)
      const [sessionId, setSessionId] = useState(null)
      // Sessions are paged: a Host can own thousands of them.
      const [sessionPage, setSessionPage] = useState({ cursor: null, total: 0, loading: false })
      const [notice, setNotice] = useState(null)
      const [wizardSkipped, setWizardSkipped] = useState(false)
      const [notify, setNotify] = useState(null)
      const [notifyStatus, setNotifyStatus] = useState(null)
      const [notifyBusy, setNotifyBusy] = useState(false)
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
      // Setup (service, pairing, notifications) is a separate tab so the chat
      // keeps the whole page instead of scrolling past configuration cards.
      // The device/session sidebar is real width, so it is hidden outright (not
      // merely folded): a folded pane still reserves its column.
      const [sidebarOpen, setSidebarOpen] = useState(true)
      const [view, setView] = useState(() => {
        try { return window.localStorage.getItem('dsh-remote-control:view') === 'settings' ? 'settings' : 'chat' } catch { return 'chat' }
      })
      const switchView = (next) => {
        setView(next)
        try { window.localStorage.setItem('dsh-remote-control:view', next) } catch { /* ignore */ }
      }

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
        // While the restore is running, sessionId is briefly null; writing that
        // would erase the very selection we are restoring.
        if (!restoredTarget.current && savedTarget.current?.sessionId && !sessionId) return
        const value = {
          peerId: openPeer.deviceId,
          sessionId: sessionId ?? null,
          scrollTop: scrollPos.current.scrollTop,
          pinned: scrollPos.current.pinned,
        }
        writeSavedTarget(value)
      }, [openPeer, sessionId])

      // Choosing a session means "start reading": give the transcript the width.
      useEffect(() => {
        if (sessionId) setSidebarOpen(false)
      }, [sessionId])

      const rotatePairing = useCallback(async (rotateSecret) => {
        if (rotateSecret && !window.confirm('Sign out every paired browser? Each phone will need the new code.')) return
        setBusy('pairing')
        try {
          const value = await api('/remote-control/api/pairing/rotate', { rotateSecret })
          setNotice(value?.secretRotated
            ? 'Pairing rotated and every paired browser was signed out. New code: ' + value.code
            : 'Pairing code rotated (paired browsers stay signed in). New code: ' + value.code)
        } catch (failure) {
          setError(failure.message)
        }
        setBusy(null)
        refresh()
      }, [refresh])

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

      const SESSION_PAGE_SIZE = 30
      const fetchSessions = useCallback(async (peerId, cursor) => {
        const query = '?limit=' + SESSION_PAGE_SIZE + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
        const value = await api('/remote-control/api/peer/' + encodeURIComponent(peerId) + '/sessions' + query)
        return {
          items: (value.items || []).slice().sort(
            (a, b) => Number(Boolean(a.blank)) - Number(Boolean(b.blank)) || (b.updatedAt || 0) - (a.updatedAt || 0),
          ),
          total: Number(value.total) || 0,
          cursor: value.nextCursor ?? null,
        }
      }, [])

      const open = useCallback(async (peer) => {
        setOpenPeer(peer)
        setSessions(null)
        setSessionId(null)
        setSessionPage({ cursor: null, total: 0, loading: false })
        try {
          const page = await fetchSessions(peer.deviceId, null)
          setSessions(page.items)
          setSessionPage({ cursor: page.cursor, total: page.total, loading: false })
          return page.items
        } catch (failure) {
          setError(failure.message)
          setSessions([])
          return []
        }
      }, [fetchSessions])

      const loadMoreSessions = useCallback(async () => {
        if (!openPeer || !sessionPage.cursor || sessionPage.loading) return
        setSessionPage((value) => ({ ...value, loading: true }))
        try {
          const page = await fetchSessions(openPeer.deviceId, sessionPage.cursor)
          setSessions((current) => current.concat(page.items))
          setSessionPage({ cursor: page.cursor, total: page.total, loading: false })
        } catch (failure) {
          setError(failure.message)
          setSessionPage((value) => ({ ...value, loading: false }))
        }
      }, [openPeer, sessionPage.cursor, sessionPage.loading, fetchSessions])

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
            // It may be past the loaded page: ask the peer about that one session
            // before claiming it is gone.
            try {
              const single = await api('/remote-control/api/peer/' + encodeURIComponent(peer.deviceId) + '/sessions?id=' + encodeURIComponent(target.sessionId))
              const found = Array.isArray(single.items) ? single.items[0] : null
              if (found) {
                setSessions((current) => [found, ...(current || []).filter((item) => item.id !== found.id)])
                setSessionId(found.id)
                return
              }
            } catch { /* fall through to the notice */ }
            const listed = items.slice(0, 3).map((item) => item.id).join(', ')
            setNotice('Saved session ' + target.sessionId + ' was not offered by the peer (' + items.length + ' listed: ' + listed + '). Pick another one.')
            console.warn('[remote-control] restore missed', { wanted: target.sessionId, peer: peer.deviceId, listed: items.map((item) => item.id) })
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

      const loadNotify = useCallback(async () => {
        try {
          const value = await api('/remote-control/api/notify')
          setNotify(value.config ?? null)
        } catch (failure) {
          setNotifyStatus({ bad: true, text: failure.message })
        }
      }, [])
      useEffect(() => { loadNotify().catch(() => {}) }, [loadNotify])

      const patchNotify = useCallback((key, value) => {
        setNotify((current) => ({ ...(current ?? {}), [key]: value }))
      }, [])

      const saveNotify = useCallback(async () => {
        if (!notify) return
        const payload = { ...notify }
        delete payload.hasSmtpPass
        delete payload.hasApiKey
        delete payload.hasToken
        // A blank secret field means "keep the stored one".
        for (const key of ['smtpPass', 'apiKey', 'token']) {
          if (!payload[key]) delete payload[key]
        }
        setNotifyBusy(true)
        setNotifyStatus(null)
        try {
          const value = await api('/remote-control/api/notify', payload)
          setNotify(value.config ?? null)
          setNotifyStatus({
            bad: value.stats?.enabled !== true,
            text: value.stats?.enabled === true ? 'Saved — notifications are active' : 'Saved, but the channel is still incomplete',
          })
        } catch (failure) {
          setNotifyStatus({ bad: true, text: failure.message })
        }
        setNotifyBusy(false)
      }, [notify])

      const testNotify = useCallback(async () => {
        setNotifyBusy(true)
        setNotifyStatus(null)
        try {
          await api('/remote-control/api/notify/test', {})
          setNotifyStatus({ bad: false, text: 'Test message sent — check the inbox' })
        } catch (failure) {
          setNotifyStatus({ bad: true, text: failure.message })
        }
        setNotifyBusy(false)
      }, [])

      const notifyField = (label, key, options = {}) => h('label', {
        key,
        style: { ...S.meta, display: 'flex', flexDirection: 'column', gap: '3px' },
      },
        label,
        h('input', {
          style: { ...S.field, minWidth: '170px' },
          type: options.secret ? 'password' : 'text',
          value: notify?.[key] ?? '',
          placeholder: options.secret && notify?.[`has${key === 'smtpPass' ? 'SmtpPass' : key === 'apiKey' ? 'ApiKey' : 'Token'}`]
            ? '•••••• (leave blank to keep)'
            : (options.placeholder ?? ''),
          onChange: (event) => patchNotify(key, event.target.value),
        }),
      )

      const notifyFields = () => {
        const kind = notify?.kind
        if (kind === 'smtp') {
          return [
            notifyField('Host', 'smtpHost', { placeholder: 'smtp.gmail.com' }),
            notifyField('Port', 'smtpPort'),
            notifyField('User', 'smtpUser'),
            notifyField('App password', 'smtpPass', { secret: true }),
            notifyField('From', 'from'),
            notifyField('To', 'to'),
            notifyField('Base URL', 'baseUrl'),
          ]
        }
        if (kind === 'mailgun') {
          return [
            notifyField('Domain', 'domain'),
            notifyField('API key', 'apiKey', { secret: true }),
            notifyField('From', 'from'),
            notifyField('To', 'to'),
            notifyField('Base URL', 'baseUrl'),
          ]
        }
        if (kind === 'webhook') {
          return [notifyField('URL', 'url'), notifyField('Bearer token', 'token', { secret: true }), notifyField('Base URL', 'baseUrl')]
        }
        if (kind === 'ntfy') {
          return [notifyField('Server', 'url'), notifyField('Topic', 'topic'), notifyField('Base URL', 'baseUrl')]
        }
        return [notifyField('Base URL', 'baseUrl')]
      }

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
          h('button', {
            type: 'button',
            style: S.button,
            title: sidebarOpen ? 'Hide the device and session list' : 'Show the device and session list',
            'aria-pressed': sidebarOpen,
            onClick: () => setSidebarOpen((value) => !value),
          }, h('svg', {
            width: 16,
            height: 16,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            'aria-hidden': true,
          },
            h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
            h('line', { x1: 15, y1: 4, x2: 15, y2: 20 }),
            sidebarOpen
              ? h('rect', { x: 15, y: 4, width: 6, height: 16, fill: 'currentColor', stroke: 'none', opacity: 0.35 })
              : null,
          )),
          h('div', { style: { display: 'flex', gap: '4px', padding: '2px', borderRadius: '8px', border: '1px solid var(--dsw-alias-line, #444)' } },
            ...['chat', 'settings'].map((name) => h('button', {
              key: name,
              type: 'button',
              style: {
                ...S.button,
                ...(view === name ? { ...S.primary } : { background: 'transparent', border: '1px solid transparent' }),
                textTransform: 'capitalize',
              },
              onClick: () => switchView(name),
            }, name)),
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
        view === 'settings'
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', minHeight: 0 } },
            state?.service
              ? h(Collapsible, { title: 'Service', summary: 'tunnel / LAN reachability', storageKey: 'service', defaultOpen: true },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
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
              ),
                )
              : null,
            state?.pairing?.code
              ? h(Collapsible, { title: 'Pairing', summary: 'code and QR for a new phone', storageKey: 'pairing', defaultOpen: false },
                  h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } },
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '240px' } },
                  h('span', { style: S.metaWrap }, 'Pairing code — enter it on the phone, or scan the code to pair automatically'),
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
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '260px' } },
                  h('span', { style: S.metaWrap }, 'Rotating the code keeps paired browsers signed in; signing them out is the second button.'),
                  h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                    h('button', { type: 'button', style: S.button, disabled: busy === 'pairing', onClick: () => rotatePairing(false) }, 'Rotate code'),
                    h('button', { type: 'button', style: S.button, disabled: busy === 'pairing', onClick: () => rotatePairing(true) }, 'Rotate + sign out devices'),
                  ),
                ),
              ),
                )
              : null,
            notify
              ? h(Collapsible, { title: 'Notifications', summary: 'approval / question delivery', storageKey: 'notifications', defaultOpen: false },
                  h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' } },
                  h('span', { style: { fontWeight: 600 } }, 'Notifications'),
                  h('span', { style: { ...S.metaWrap, flex: '1 1 240px' } }, 'approval / question reach you out of band — credentials stay in this Host'),
                ),
                h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' } },
                  h('label', { style: { ...S.meta, display: 'flex', flexDirection: 'column', gap: '3px' } },
                    'Channel',
                    h('select', {
                      style: S.field,
                      value: notify.kind,
                      onChange: (event) => patchNotify('kind', event.target.value),
                    }, ['none', 'smtp', 'mailgun', 'webhook', 'ntfy'].map((kind) => h('option', { key: kind, value: kind }, kind))),
                  ),
                  ...notifyFields(),
                ),
                h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
                  h('button', { type: 'button', style: S.button, disabled: notifyBusy, onClick: saveNotify }, 'Save'),
                  h('button', { type: 'button', style: S.button, disabled: notifyBusy || notify.kind === 'none', onClick: testNotify }, 'Send test'),
                  notifyStatus
                    ? h('span', { style: { ...S.meta, color: notifyStatus.bad ? '#ff8c8c' : '#7ee08b' } }, notifyStatus.text)
                    : null,
                ),
              ),
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

        view === 'chat'
          ? h('div', { style: S.body },
          h('div', { style: sidebarOpen ? { display: 'flex', flexDirection: 'column', minHeight: 0 } : { display: 'none' } },
              h(Collapsible, {
              title: 'Devices',
              summary: openPeer ? openPeer.deviceName : peers.length + ' found',
              storageKey: 'picker:devices',
              defaultOpen: true,
              forceClose: openPeer ? 1 : 0,
            },
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
            ),
            ),

          openPeer
            ? h('div', { style: { ...S.column, flex: 1, minWidth: 0 } },
              sessions === null
                ? h('div', { style: S.empty }, 'Loading sessions…')
                : sessions.length === 0
                  ? h('div', { style: S.empty }, 'This device has no sessions.')
                  : h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } },
                    h('div', { style: sidebarOpen ? { display: 'flex', flexDirection: 'column', minHeight: 0 } : { display: 'none' } },
              h(Collapsible, {
                      title: 'Sessions',
                      summary: (sessionId
                        ? (sessions.find((session) => session.id === sessionId)?.title || sessionId)
                        : 'pick a session') + (sessionPage.total > sessions.length ? ' · ' + sessions.length + '/' + sessionPage.total : ''),
                      storageKey: 'picker:sessions',
                      defaultOpen: true,
                      forceClose: sessionId ? 1 : 0,
                    },
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
                      sessionPage.cursor
                        ? h('button', {
                          type: 'button',
                          style: { ...S.smallButton, margin: '6px 10px' },
                          disabled: sessionPage.loading,
                          onClick: loadMoreSessions,
                        }, sessionPage.loading ? 'Loading\u2026' : 'Load more (' + sessions.length + '/' + sessionPage.total + ')')
                        : null,
                    ),
                    ),
            ),
                    sessionId
                      ? h(Chat, {
                        peerId: openPeer.deviceId,
                        onNewSession: async () => {
                          try {
                            const created = await api('/remote-control/api/peer/' + encodeURIComponent(openPeer.deviceId) + '/new-session', {})
                            await open(openPeer)
                            const createdId = created?.sessionId || created?.id || created?.session?.id
                            if (createdId) setSessionId(createdId)
                          } catch (failure) {
                            setError(failure.message)
                          }
                        },
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
        )
          : h('div', { style: { ...S.meta, padding: '18px' } }, 'Setup lives in the Settings tab. Switch back to Chat to control a device.'),
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
        }, () => h(PageErrorBoundary, null, h(DevicesPage))))
      },
    }
  },
})

