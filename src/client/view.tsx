/**
 * Context Transparency Manager view: orchestration only. Presentation lives in
 * the sibling modules (toolbar / turn-node / segment-card / dialogs / legend),
 * pure logic in model.ts / notices.ts / labels.ts / markdown.tsx.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CtmState } from '../contract'
import { zh, en, type CtmKey, type Lang } from './locales'
import { groupNodes, recoverTurns } from './model'
import { noticeText } from './notices'
import { roleLabel, fmtTime } from './labels'
import { useExpansion, type Shared, type EditingState } from './shared'
import { Toolbar, MinBar, Pager } from './toolbar'
import { TurnNode } from './turn-node'
import { SegmentCard } from './segment-card'
import { ConfirmModal, Editor, type ConfirmOp } from './dialogs'

export interface CtmApi {
  getState(): Promise<CtmState>
  replace(segmentId: string, content: string): Promise<CtmState>
  deleteSegment(segmentId: string): Promise<CtmState>
  rollback(turnIndex: number): Promise<CtmState>
  restore(snapshotId: string): Promise<CtmState>
  reset(): Promise<CtmState>
  undo(): Promise<CtmState>
  override(segmentId: string, value: string | null): Promise<CtmState>
  setRealtime(enabled: boolean): Promise<CtmState>
}

/** Nodes per page; a deliberate tuning point (no config wiring) — adjust here, rebuild. */
const PAGE_SIZE = 2

// Module-level cache so re-opening the tab renders instantly (no loading flash);
// reactive useSession signals and manual refresh keep it fresh while open.
const stateCache = new Map<string, CtmState>()

export function CtmView(props: CtmApi & { sessionId?: string; useSession?: (sel: (s: any) => any) => any }) {
  const { getState, replace, deleteSegment, rollback, restore, reset, undo, override, setRealtime, sessionId, useSession } = props

  const [lang, setLang] = useState<Lang>('en')
  const [state, setState] = useState<CtmState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const expansion = useExpansion()
  const [explainHover, setExplainHover] = useState<string | null>(null)
  const [legendHover, setLegendHover] = useState(false)
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [confirmOp, setConfirmOp] = useState<ConfirmOp | null>(null)
  const [busy, setBusy] = useState(false)
  const [showSnap, setShowSnap] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const inFlightRef = useRef(false)
  const pendingRefreshRef = useRef(false)
  // Newest host state version applied so far (per session); a late response
  // with an older version is dropped so a stale read can never overwrite a
  // mutation that landed after it (the host bumps `version` on every compute).
  const lastVersionRef = useRef(0)
  // Mirrors `editing` so the stable load() callback can skip clobbering an
  // open editor during silent refreshes.
  const editingRef = useRef(editing)
  useEffect(() => { editingRef.current = editing }, [editing])
  const [showRolledBack, setShowRolledBack] = useState(false)
  const [minimized, setMinimized] = useState(false)

  // Reactive conversation signals supplied by the framework (the same
  // SnapshotSelectorHook the Trajectory view reads via useSession). `nodeCount`
  // bumps on every newly finalized surface node (user input, injected context,
  // assistant message, tool result) and `running` flips at turn boundaries —
  // both advance the model surface that the host re-reads on getState. React
  // re-renders on each change, so we re-read immediately instead of polling.
  const nodeCount = useSession ? useSession((s: any) => s?.chat?.legacy?.nodes?.length ?? 0) : 0
  const running = useSession ? useSession((s: any) => !!s?.running) : false

  const dict = lang === 'zh' ? zh : en
  const t = useCallback((k: CtmKey): string => (dict[k] ?? en[k] ?? k) as string, [dict])

  // Apply a host response unless it is stale (its version is older than the
  // newest one already applied). Returns whether the state was applied.
  const applyState = useCallback((s: CtmState): boolean => {
    if (s.version < lastVersionRef.current) return false
    lastVersionRef.current = s.version
    if (sessionId) stateCache.set(sessionId, s)
    setState(s)
    return true
  }, [sessionId])

  const load = useCallback(async (silent?: boolean) => {
    if (inFlightRef.current) { pendingRefreshRef.current = true; return }
    inFlightRef.current = true
    if (!silent) setLoading(true)
    setError(null)
    try {
      const s = await getState()
      // While the editor is open, silent (reactive) refreshes must not swap
      // the content underneath the draft — a manual refresh still applies.
      if (!(silent && editingRef.current !== null)) applyState(s)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally {
      inFlightRef.current = false
      setLoading(false)
      // A refresh was requested while this read was in flight (the surface
      // advanced again); re-read once so the view never settles on stale data.
      if (pendingRefreshRef.current) { pendingRefreshRef.current = false; void load(true) }
    }
  }, [getState, applyState])

  useEffect(() => {
    // Initial load for the current session: from the module cache if available,
    // otherwise a fresh (loading-visible) read. Re-runs only when the session
    // changes; the second effect below keeps the view live while it stays open.
    const cached = sessionId ? stateCache.get(sessionId) : undefined
    lastVersionRef.current = cached?.version ?? 0
    if (cached) { setState(cached); setLoading(false) }
    void load(cached !== undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    // Live refresh: re-read the host surface the moment the conversation
    // advances (a new node finalized or a turn starts/ends) instead of waiting
    // for a timer. The very first render is owned by the initial effect above.
    if (state === null) return
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, nodeCount, running])

  const run = useCallback(async (fn: () => Promise<CtmState>) => {
    setBusy(true)
    setError(null)
    try { const s = await fn(); if (applyState(s)) setEditing(null) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }, [applyState])

  const askConfirm = useCallback((name: string, args: Record<string, unknown>) => setConfirmOp({ name, args }), [])

  const execOp = useCallback((name: string, args: Record<string, unknown>) => {
    if (name === 'replace') void run(() => replace(args.segmentId as string, args.content as string))
    else if (name === 'delete') void run(() => deleteSegment(args.segmentId as string))
    else if (name === 'rollback') void run(() => rollback(args.turnIndex as number))
    else if (name === 'restore') void run(() => restore(args.snapshotId as string))
    else if (name === 'reset') void run(reset)
    else if (name === 'undo') void run(undo)
    else if (name === 'override') void run(() => override(args.segmentId as string, args.value as string | null))
    else if (name === 'setRealtime') void run(() => setRealtime(true))
  }, [run, replace, deleteSegment, rollback, restore, reset, undo, override, setRealtime])

  const recoveredSegments = useMemo(() => (state ? recoverTurns(state.segments) : []), [state])
  const nodes = useMemo(() => (state ? groupNodes(recoveredSegments) : []), [state, recoveredSegments])
  const totalPages = Math.max(1, Math.ceil(nodes.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageNodes = nodes.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  if (loading && !state) return <div className="ctm-wrap"><div className="ctm-empty">{t('loading')}</div></div>
  if (error && !state) return <div className="ctm-wrap"><div className="ctm-notice error">{t('loadFailed')}：{error}</div></div>
  if (!state) return <div className="ctm-wrap"><div className="ctm-empty">{t('noSession')}</div></div>

  // The Shared bundle: every extracted component receives view state through
  // this one prop instead of a long parameter list.
  const sh: Shared = {
    t, lang, busy, state,
    isOpen: expansion.isOpen, toggle: expansion.toggle,
    explainHover, setExplainHover, legendHover, setLegendHover,
    editing, setEditing, askConfirm,
  }

  if (minimized) {
    return <MinBar sh={sh} onExpand={() => setMinimized(false)} onToggleLang={() => setLang(lang === 'en' ? 'zh' : 'en')} />
  }

  const sum = state.summary
  return (
    <div className="ctm-wrap">
      <Toolbar sh={sh} h={{
        onRefresh: () => void load(),
        onToggleRealtime: () => { if (state.realtime) void run(() => setRealtime(false)); else askConfirm('setRealtime', { enabled: true }) },
        onReset: () => askConfirm('reset', {}),
        onToggleSnapshots: () => setShowSnap(v => !v),
        onToggleTrash: () => setShowTrash(v => !v),
        onMinimize: () => setMinimized(true),
        onToggleLang: () => setLang(lang === 'en' ? 'zh' : 'en'),
      }} />

      {state.notice && <div className={`ctm-notice ${state.notice.kind || 'ok'}`}>{noticeText(state.notice, t)}</div>}
      {(state.interceptError ?? null) !== null && <div className="ctm-notice warn">{t('interceptFailed')}：{state.interceptError}</div>}
      {(state.applyError ?? null) !== null && <div className="ctm-notice error">{t('applyFailed')}：{state.applyError}</div>}
      {error && <div className="ctm-notice error">{t('opFailed')}：{error}</div>}

      {showSnap && state.snapshots.length > 0 && (
        <div>
          <div className="ctm-section-title">{`${t('snapshots')}（HEAD：${state.head}）`}</div>
          {state.snapshots.map(s => (
            <div key={s.id} className="ctm-actions">
              <span className="ctm-hint">{`${s.label} · ${s.segmentCount} · ${fmtTime(s.createdAt)}`}</span>
              <button type="button" className="ctm-btn subtle" disabled={busy} onClick={() => askConfirm('restore', { snapshotId: s.id })}>{t('restore')}</button>
            </div>
          ))}
        </div>
      )}

      {showTrash && state.trash.length > 0 && (
        <div>
          <div className="ctm-section-title">{t('trash')}</div>
          {state.trash.map(tt => <div key={tt.id} className="ctm-hint">{`#${tt.turn_index} · ${roleLabel(t, tt.role)} · ${(tt.content || '').slice(0, 60)}`}</div>)}
          <button type="button" className="ctm-btn subtle" disabled={busy} onClick={() => askConfirm('undo', {})}>{t('undo')}</button>
        </div>
      )}

      <Pager sh={sh} page={safePage} totalPages={totalPages} onPage={setPage} />

      <div className="ctm-flow">{pageNodes.map(node => <TurnNode key={node.key} node={node} sh={sh} />)}</div>

      {(sum.rolledBackCount ?? 0) > 0 && (
        <div>
          <div className="ctm-section-title">{`${t('rolledBackSection')}（${sum.rolledBackCount}）`}</div>
          {showRolledBack
            ? (
              <div>
                <div>{recoveredSegments.filter(s => s.rolledBack).map(seg => <SegmentCard key={seg.id} seg={seg} sh={sh} />)}</div>
                <button type="button" className="ctm-btn subtle" onClick={() => setShowRolledBack(false)}>{t('collapse')}</button>
              </div>
            )
            : <button type="button" className="ctm-btn subtle" onClick={() => setShowRolledBack(true)}>{t('showRolledBack')}</button>}
        </div>
      )}

      <Editor sh={sh} />

      {confirmOp && <ConfirmModal sh={sh} op={confirmOp} onClose={() => setConfirmOp(null)} onExec={execOp} />}
    </div>
  )
}

export default CtmView
