import { randomUUID } from 'node:crypto'

/**
 * Human-in-the-loop bridge.
 *
 * DSH dispatches approvals and questions through an agent-scoped waterfall: a
 * listener either returns a decision (claiming the request) or calls `next()` to
 * delegate to the next answerer — the shipped local UI plus the Remote client.
 *
 * This bridge behaves like the peer fabric does for pairing: it forwards with
 * `next()` so the local UI still shows the prompt, meanwhile offers the same
 * request to paired remote pages, and settles with whichever side answers
 * first. There is deliberately no timeout: `ApprovalService` settles only on an
 * answer or on `request.signal` abort, so a parked request stays answerable
 * exactly as long as the local card does.
 */
/**
 * Read the owning session id off an approval or question request. The shipped
 * code uses `agent.session.id`; the flat `agent.sessionId` is accepted as a
 * fallback so a shape change cannot silently disable the bridge.
 */
function sessionIdOf(request) {
  const agent = request?.agent
  return String(agent?.session?.id ?? agent?.sessionId ?? '')
}

export function createHitl({ broadcast = () => {}, log = console, takeover = 'race' } = {}) {
  // `race` forwards with next() so the local UI shows the prompt too, and the
  // first answer wins. `claim` never forwards, so the local UI shows nothing:
  // the page is the only answerer while it is watching.
  const mode = takeover === 'claim' ? 'claim' : 'race'
  const pending = new Map() // requestId -> entry
  const watching = new Map() // sessionId -> open stream count
  const asked = new Map() // approvalId -> { sessionId, callId }
  const closed = new Set()

  function watch(sessionId) {
    if (!sessionId) return
    watching.set(sessionId, (watching.get(sessionId) ?? 0) + 1)
  }

  function unwatch(sessionId) {
    if (!sessionId) return
    const next = (watching.get(sessionId) ?? 0) - 1
    if (next > 0) watching.set(sessionId, next)
    else watching.delete(sessionId)
  }

  function watched(sessionId) {
    return (watching.get(sessionId) ?? 0) > 0
  }

  function summary(entry) {
    return {
      requestId: entry.requestId,
      kind: entry.kind,
      sessionId: entry.sessionId,
      toolName: entry.toolName ?? '',
      callId: entry.callId ?? '',
      reason: entry.reason ?? '',
      displayReason: entry.displayReason ?? '',
      questions: entry.questions ?? null,
      intent: entry.intent ?? null,
      ageMs: Date.now() - entry.at,
    }
  }

  function pendingFor(sessionId) {
    const out = []
    for (const entry of pending.values()) {
      if (entry.sessionId === sessionId) out.push(summary(entry))
    }
    return out
  }

  /** Every pending request, for diagnostics: a stuck entry means a waiter that never settled. */
  function pendingAll() {
    return [...pending.values()].map(summary)
  }

  function settle(entry, value, error) {
    if (entry.done) return
    entry.done = true
    pending.delete(entry.requestId)
    broadcast(entry.sessionId, { type: 'hitl/settled', requestId: entry.requestId })
    if (error) entry.reject(error)
    else entry.resolve(value)
  }

  /**
   * Park one request until the remote page or the local chain answers.
   * `kind` distinguishes the two waterfalls; `onAbort` is the value to settle
   * with when the request is withdrawn.
   */
  function park(kind, sessionId, detail, runLocal, onAbort) {
    const requestId = randomUUID()
    let resolve
    let reject
    const settled = new Promise((res, rej) => { resolve = res; reject = rej })
    const entry = { requestId, kind, sessionId, done: false, at: Date.now(), resolve, reject, ...detail }
    pending.set(requestId, entry)
    broadcast(sessionId, { type: 'hitl/request', ...summary(entry) })

    const local = Promise.resolve().then(runLocal).catch((error) => {
      log.warn?.(`[remote-control] local ${kind} answerer failed: ${error?.message || error}`)
      return kind === 'approval' ? 'unavailable' : undefined
    })

    const signal = detail.signal
    if (signal?.aborted) {
      settle(entry, onAbort.value, onAbort.error)
    } else {
      signal?.addEventListener('abort', () => settle(entry, onAbort.value, onAbort.error), { once: true })
    }

    // First answer wins. `unavailable` from the local chain means "no local
    // answerer is attached", which must not consume the request: keep waiting
    // for the page, exactly as an unanswered local card would.
    void local.then((value) => {
      if (kind === 'approval') {
        if (value !== undefined && value !== 'unavailable') settle(entry, value)
        // No local answerer at all and nobody watching: fail closed rather than
        // parking a request no reachable UI could ever show.
        else if (value === 'unavailable' && !watched(sessionId)) settle(entry, 'unavailable')
      } else if (value !== undefined) {
        settle(entry, value)
      }
    })

    void settled.then(() => {
      closed.add(requestId)
      setTimeout(() => closed.delete(requestId), 1000).unref?.()
    })

    return settled
  }

  async function handleApproval(request, next) {
    const sessionId = sessionIdOf(request)
    if (!sessionId) return next()
    // Always register the request so a page that connects later can still see
    // and answer it. Only the initial prompt is claimed: `claim` mode keeps the
    // desktop quiet while a page is watching, otherwise the desktop prompts.
    const forwardLocal = mode === 'race' || !watched(sessionId)
    return park('approval', sessionId, {
      toolName: String(request.toolName ?? ''),
      callId: request.callId ? String(request.callId) : '',
      reason: request.reason ?? '',
      displayReason: request.displayReason ?? '',
      signal: request.signal,
    }, forwardLocal ? () => next() : () => undefined, { value: 'unavailable' })
  }

  async function handleQuestion(request, next) {
    const sessionId = sessionIdOf(request)
    if (!sessionId) return next()
    const forwardLocal = mode === 'race' || !watched(sessionId)
    return park('question', sessionId, {
      questions: request.questions ?? null,
      intent: request.intent ?? null,
      signal: request.signal,
    }, forwardLocal ? () => next() : () => undefined, { error: new Error('the question was withdrawn before anyone answered') })
  }

  /**
   * Answer a parked request from the page. Returns false when the request is
   * unknown (already answered elsewhere, withdrawn, or never ours).
   */
  function answer(requestId, payload) {
    const entry = pending.get(String(requestId ?? ''))
    if (!entry || entry.done) return false

    if (entry.kind === 'approval') {
      const decision = payload?.decision
      if (decision !== 'allow' && decision !== 'deny') return false
      settle(entry, decision === 'allow' ? 'allowed-once' : 'rejected')
      return true
    }

    const answers = Array.isArray(payload?.answers) ? payload.answers : null
    if (!answers) return false
    settle(entry, { answers })
    return true
  }

  /**
   * Remember which tool call an approval id belongs to. `approval/asked` carries
   * both; `approval/decided` carries only the id, so this is the join key.
   */
  function noteAsked(sessionId, approvalId, callId) {
    if (!approvalId || !callId) return
    asked.set(String(approvalId), { sessionId: String(sessionId ?? ''), callId: String(callId) })
    if (asked.size > 500) asked.delete(asked.keys().next().value)
  }

  /**
   * The Host appended `approval/decided`, so the decision is final no matter who
   * made it. Any entry we still hold for that call can never be answered and
   * would otherwise linger as a ghost card, so drop it.
   */
  function settleDecided(sessionId, approvalId) {
    const key = String(approvalId ?? '')
    const record = asked.get(key)
    if (!record) return 0
    asked.delete(key)
    let removed = 0
    for (const entry of [...pending.values()]) {
      if (entry.kind !== 'approval' || entry.callId !== record.callId) continue
      if (record.sessionId && entry.sessionId !== record.sessionId) continue
      settle(entry, 'unavailable')
      removed++
    }
    return removed
  }

  function close() {
    for (const entry of [...pending.values()]) {
      settle(entry, entry.kind === 'approval' ? 'unavailable' : undefined,
        entry.kind === 'approval' ? undefined : new Error('the Host stopped listening'))
    }
    pending.clear()
    watching.clear()
  }

  return {
    handleApproval,
    handleQuestion,
    answer,
    watch,
    unwatch,
    watched,
    pendingFor,
    pendingAll,
    noteAsked,
    settleDecided,
    stats: () => ({ pending: pending.size, sessions: watching.size, takeover: mode }),
    close,
  }
}
