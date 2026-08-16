/** Context Transparency Manager view: flowchart (turn → step → tool-call), editable, effectiveness-scored. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CtmEffectiveness, CtmNotice, CtmSegment, CtmState } from '../contract'
import { zh, en, type CtmKey, type Lang } from './locales'
import { unescapeText } from './text'

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

const PAGE_SIZE = 2

// Module-level cache so re-opening the tab renders instantly (no loading flash);
// reactive useSession signals and manual refresh keep it fresh while open.
const stateCache = new Map<string, CtmState>()

interface StepGroup { key: string; label: string; num?: number; turn?: number; sourceKind?: string | null; segments: CtmSegment[] }
interface TurnGroup { key: string; kind: 'user' | 'system' | 'turn'; turn: number | null; belongsToTurn?: number; segments: CtmSegment[]; steps: StepGroup[] }

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let index = 0
  for (const match of text.matchAll(regex)) {
    const at = match.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    const tok = match[0] ?? ''
    if (tok.startsWith('**')) parts.push(<strong key={`b${index++}`}>{tok.slice(2, -2)}</strong>)
    else parts.push(<code key={`c${index++}`} className="ctm-code">{tok.slice(1, -1)}</code>)
    last = at + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function renderMarkdown(text: string): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let codeBuf: string[] = []
  let inCode = false
  let key = 0
  const flush = () => {
    if (codeBuf.length > 0) { out.push(<pre key={`code${key++}`} className="ctm-md-code">{codeBuf.join('\n')}</pre>); codeBuf = [] }
  }
  for (const line of lines) {
    if (line.trim().startsWith('```')) { if (inCode) { flush(); inCode = false } else { inCode = true }; continue }
    if (inCode) { codeBuf.push(line); continue }
    const trimmed = line.trim()
    if (trimmed === '') { flush(); continue }
    const h = trimmed.match(/^(#{1,4})\s+(.*)$/)
    if (h) { flush(); out.push(<div key={`h${key++}`} className="ctm-md-h">{renderInline(h[2])}</div>); continue }
    const ul = trimmed.match(/^[-*]\s+(.*)$/)
    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/)
    if (ul || ol) {
      out.push(<div key={`li${key++}`} className="ctm-md-list">• {renderInline((ul ?? ol)![1])}</div>)
      continue
    }
    out.push(<div key={`p${key++}`} className="ctm-md-p">{renderInline(line)}</div>)
  }
  flush()
  return out.length ? out : [<div key="fallback" className="ctm-md-p">{text}</div>]
}

/**
 * Recover a per-segment `turn`/`step` for `user/message` surface events, whose
 * data carries no turn/step (unlike `assistant/message` and `tool/result`).
 * Each null-turn segment takes the NEXT turn/step-carrying segment's turn (the
 * step that consumed it); trailing ones (the in-flight turn) take `maxTurn + 1`.
 * Done client-side too so the view stays correct even against a host that has
 * not been reloaded yet.
 */
function recoverTurns(segments: CtmSegment[]): CtmSegment[] {
  let maxTurn = 0
  for (const s of segments) if (s.turn != null && s.turn > maxTurn) maxTurn = s.turn
  const out = segments.map(s => ({ ...s }))
  const pending: number[] = []
  for (let i = 0; i < out.length; i++) {
    const s = out[i]
    if (s === undefined) continue
    if (s.turn != null) {
      for (const idx of pending) { const p = out[idx]; if (p !== undefined) { p.turn = s.turn; p.step = s.step } }
      pending.length = 0
    } else {
      pending.push(i)
    }
  }
  for (const idx of pending) { const p = out[idx]; if (p !== undefined) { p.turn = maxTurn + 1; p.step = 0 } }
  return out
}

export function CtmView(props: CtmApi & { sessionId?: string; useSession?: (sel: (s: any) => any) => any }) {
  const { getState, replace, deleteSegment, rollback, restore, reset, undo, override, setRealtime, sessionId, useSession } = props

  const [lang, setLang] = useState<Lang>('en')
  const [state, setState] = useState<CtmState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expTurns, setExpTurns] = useState<Record<string, boolean>>({})
  const [expSteps, setExpSteps] = useState<Record<string, boolean>>({})
  const [expTools, setExpTools] = useState<Record<string, boolean>>({})
  const [expContent, setExpContent] = useState<Record<string, boolean>>({})
  const [expThink, setExpThink] = useState<Record<string, boolean>>({})
  const [explainPin, setExplainPin] = useState<Record<string, boolean>>({})
  const [explainHover, setExplainHover] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [legendHover, setLegendHover] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string; role: string; turnIndex: number } | null>(null)
  const [confirmOp, setConfirmOp] = useState<{ name: string; args: Record<string, unknown> } | null>(null)
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

  const toggle = (key: string, map: Record<string, boolean>, setMap: (f: (p: Record<string, boolean>) => Record<string, boolean>) => void) => {
    setMap(p => ({ ...p, [key]: !p[key] }))
  }

  const roleLabel = (role: string): string => role === 'system' ? t('roleSystem') : role === 'user' ? t('roleUser') : role === 'assistant' ? t('roleAssistant') : role === 'tool' ? t('roleTool') : role
  const cacheLabel = (cs: string): string => cs === 'hit' ? t('cacheHitLabel') : cs === 'miss' ? t('cacheMissLabel') : cs === 'partial' ? t('cachePartial') : t('cacheUnknown')
  const effLabel = (eff: string): string => eff === 'effective' ? t('effEffective') : eff === 'redundant' ? t('effRedundant') : eff === 'stale' ? t('effStale') : eff === 'injected' ? t('effInjected') : eff
  const cacheTip = (cs: string): string => cs === 'hit' ? t('tipCacheHit') : cs === 'miss' ? t('tipCacheMiss') : cs === 'partial' ? t('tipCachePartial') : ''
  const effTip = (eff: string): string => eff === 'effective' ? t('tipEffective') : eff === 'redundant' ? t('tipRedundant') : eff === 'stale' ? t('tipStale') : eff === 'injected' ? t('tipInjected') : ''
  const fmtTime = (tm: number): string => (tm ? new Date(tm).toLocaleTimeString() : '')
  const fmtNum = (n: number | null | undefined): string => (n == null) ? '—' : String(n)

  const sourceKindLabel = (seg: CtmSegment): string => {
    if (seg.source === 'system_inject') {
      if (seg.sourceKind === 'system') return t('initialSystemPrompt')
      if (seg.sourceKind === 'skill-catalog') return t('skillCatalog')
      if (seg.sourceKind === 'approval-policy') return t('approvalPolicy')
      return t('systemPromptSection')
    }
    return roleLabel(seg.role)
  }

  const borderClass = (seg: CtmSegment): string => {
    if (seg.source === 'system_inject' || seg.source === 'summary_compress') return 'system'
    if (seg.strongStale) return 'red'
    if (seg.effectiveness === 'redundant' || seg.effectiveness === 'stale') return 'yellow'
    if (seg.cache_status === 'hit') return 'green'
    if (seg.cache_status === 'miss') return 'blue'
    return ''
  }

  const noticeText = (notice: CtmNotice | null): string | null => {
    if (!notice) return null
    const c = notice.text
    if (/^replaced_\d+$/.test(c)) return lang === 'zh' ? `已替换；该片段及其后 ${c.split('_')[1]} 条消息缓存失效（前缀断裂）` : `Replaced; this segment and the next ${c.split('_')[1]} messages lost their cache (prefix break).`
    if (/^replaced_queued_\d+$/.test(c)) return lang === 'zh' ? `已替换并入队：将在模型下一步推理时写入日志生效；该片段及其后 ${c.split('_')[2]} 条消息缓存失效（前缀断裂）` : `Replaced and queued: logged at the model's next step; this segment and the next ${c.split('_')[2]} messages lose their cache (prefix break).`
    if (/^rolled_back_\d+$/.test(c)) return lang === 'zh' ? `已回退；其后 ${c.split('_').slice(2).join('_')} 条标记为 stale（保留未删除）` : `Rolled back; ${c.split('_').slice(2).join('_')} later segments marked stale (kept).`
    if (/^rollback_queued_\d+$/.test(c)) return lang === 'zh' ? `已回退并入队：其后 ${c.split('_')[2]} 条将在下一步被一条占位标记替换（写入会话日志）` : `Rolled back and queued: ${c.split('_')[2]} later segments will be replaced by one placeholder marker at the next step (logged).`
    if (/^deleted_\d+$/.test(c)) return lang === 'zh' ? `已删除 ${c.split('_')[1]} 条片段（软删除，可撤销）` : `Deleted ${c.split('_')[1]} segments (soft delete, undoable).`
    if (/^realtime_on_queued_\d+$/.test(c)) return lang === 'zh' ? `真实生效已开启：${c.split('_')[3]} 项视图编辑已入队，将在模型下一步推理时写入日志生效` : `Apply-for-real ON: ${c.split('_')[3]} view edit(s) queued; they are logged and take effect at the model's next step.`
    if (/^override_(\w+)$/.test(c)) return (lang === 'zh' ? '已手动标记为 ' : 'Manually marked as ') + effLabel(c.slice(9))
    const map: Record<string, CtmKey> = {
      segment_not_found: 'segNotFound', cannot_replace_system: 'cannotReplaceSystem', tool_readonly: 'toolReadonly',
      invalid_turn: 'invalidTurn', snapshot_not_found: 'snapshotNotFound', restored: 'restored', reset: 'resetDone',
      cannot_delete_system: 'cannotDeleteSystem', cannot_delete_current_user: 'cannotDeleteUser', nothing_to_delete: 'nothingDelete',
      nothing_to_undo: 'nothingUndo', undone: 'undoneNotice', override_cleared: 'overrideCleared', invalid_effectiveness: 'invalidEff',
      realtime_on: 'realtimeOnNotice', realtime_off: 'realtimeOffNotice',
      deleted_queued: 'deletedQueued', replaced_system: 'replacedSystem', session_not_live: 'sessionNotLive',
      segment_gone: 'segmentGone', unbalanced_edit: 'unbalancedEdit', tool_result_changed: 'toolResultChanged',
      invalid_template: 'invalidTemplate', undone_queued: 'undoneQueued', undo_unavailable: 'undoUnavailable',
    }
    if (map[c] !== undefined) return t(map[c])
    return c
  }

  const groupNodes = (segments: CtmSegment[]): TurnGroup[] => {
    const sys: CtmSegment[] = []
    const usr: CtmSegment[] = []
    const byTurn = new Map<number, CtmSegment[]>()
    const turnNums: number[] = []
    for (const s of segments) {
      // All system-injected content — the per-turn system prompt (sourceKind
      // 'system'), runtime context, skill catalog, approval policy — shares one
      // "system prompt" node, listed in surface order so the first item is the
      // turn-1 system prompt (segment 0).
      if (s.source === 'system_inject') sys.push(s)
      else if (s.role === 'user' && s.source === 'user_input') usr.push(s)
      else if (s.turn != null) { const arr = byTurn.get(s.turn) ?? []; arr.push(s); byTurn.set(s.turn, arr); turnNums.push(s.turn) }
      else usr.push(s)
    }
    const firstTurn = turnNums.length ? Math.min(...turnNums) : 1
    const nodes: TurnGroup[] = []
    if (usr.length) nodes.push({ key: 'input', kind: 'user', turn: null, belongsToTurn: firstTurn, segments: usr, steps: [] })
    if (sys.length) nodes.push({ key: 'sys', kind: 'system', turn: null, belongsToTurn: firstTurn, segments: sys, steps: [] })
    for (const tn of [...byTurn.keys()].sort((a, b) => a - b)) nodes.push({ key: `turn-${tn}`, kind: 'turn', turn: tn, segments: byTurn.get(tn)!, steps: [] })
    for (const node of nodes) {
      if (node.kind !== 'turn') {
        node.steps = node.segments.map((s, idx) => ({ key: `${node.key}::seg-${s.id}`, label: s.role, num: idx + 1, turn: s.turn ?? undefined, sourceKind: s.sourceKind, segments: [s] }))
      } else {
        const byStep = new Map<string, CtmSegment[]>()
        for (const s of node.segments) { const k = s.step == null ? 'step-null' : `step-${s.step}`; const arr = byStep.get(k) ?? []; arr.push(s); byStep.set(k, arr) }
        const keys = [...byStep.keys()].sort((a, b) => { const na = a === 'step-null' ? -1 : parseInt(a.slice(5), 10); const nb = b === 'step-null' ? -1 : parseInt(b.slice(5), 10); return na - nb })
        node.steps = keys.map(k => ({ key: `${node.key}::${k}`, label: k, segments: byStep.get(k)! }))
      }
    }
    return nodes
  }

  const opInfo = (name: string): { title: string; impact: string; risk: string } => {
    const zhL = lang === 'zh'
    if (name === 'replace') return { title: t('replace'), impact: zhL ? '只修改该片段的正文内容；该片段及其后所有片段的缓存标记都会失效（前缀缓存断裂）。' : "Only edits this segment's text; it and every later segment lose their cache mark (prefix break).", risk: zhL ? (state?.realtime ? '「真实生效」已开启：替换会在模型下一步推理时写入会话日志后生效（期间标记「待生效」）。' : '当前「真实生效」关闭：仅修改视图，不改变模型真实收到的内容。') : (state?.realtime ? 'Apply-for-real is ON: the replacement is written to the session log at the model\'s next step (shown as "pending" until then).' : 'Apply-for-real is OFF: view-only; the model still receives the original content.') }
    if (name === 'delete') return { title: t('delete'), impact: zhL ? '把该片段软删除（进回收站，本会话可撤销）；turn_index 保留空洞；缓存预测重算。' : 'Soft-deletes the segment (to trash, undoable this session); turn_index keeps its hole; cache prediction recalculates.', risk: zhL ? (state?.realtime ? '「真实生效」已开启：该片段将在模型下一步推理时被一条占位标记替换并写入会话日志（replay 与 token 计量自动一致）。' : '当前「真实生效」关闭：仅从视图移除，不改变模型真实收到的内容。') : (state?.realtime ? 'Apply-for-real is ON: at the model\'s next step the segment is replaced by a placeholder marker, written to the session log (replay and token accounting stay consistent).' : 'Apply-for-real is OFF: view-only; the model still receives this segment.') }
    if (name === 'rollback') return { title: t('rollback'), impact: zhL ? '把该轮次之后的所有片段标记为 stale（保留不删除），并生成一个快照。' : 'Marks every later segment stale (kept, not deleted) and creates a snapshot.', risk: zhL ? (state?.realtime ? '「真实生效」已开启：回退区间将在下一步被单条占位标记替换并写入会话日志；原始内容仍留在日志的 transcript 里。' : '这些片段会进入「已回退」折叠区，可随时前滚恢复。') : (state?.realtime ? 'Apply-for-real is ON: the rolled-back range is replaced by one placeholder marker at the next step and logged; the originals stay in the log transcript.' : 'They move to the rolled-back folded area; you can roll forward anytime.') }
    if (name === 'override') return { title: `${t('markStale')} / ${t('markEffective')}`, impact: zhL ? '仅手动覆盖该片段的有效性标记（影响颜色与建议），不改变内容。' : 'Only overrides the effectiveness label (color/suggestion); content unchanged.', risk: zhL ? '无风险（纯标注，可再次点击取消覆盖）。' : 'No risk (label only; click again to clear).' }
    if (name === 'reset') return { title: t('reset'), impact: zhL ? '清空所有编辑（替换/删除/回退/快照），回到最新实时上下文。' : 'Clears all edits (replace/delete/rollback/snapshots) and returns to the latest live context.', risk: zhL ? '不可撤销——之前的编辑会全部丢失。' : 'Irreversible — all prior edits are lost.' }
    if (name === 'restore') return { title: t('restore'), impact: zhL ? '恢复到该快照保存时的上下文（逐字节一致），并清除此后的编辑。' : 'Restores the context exactly as saved in that snapshot; clears later edits.', risk: zhL ? '快照之后的编辑会丢失。' : 'Edits made after the snapshot are lost.' }
    if (name === 'undo') return { title: t('undo'), impact: zhL ? '撤销最近一次操作：还未生效的排队编辑直接移除；已写入日志的编辑会在模型下一步以一条反向修改还原。仅支持撤销最近一组操作。' : 'Undoes the most recent operation: a queued (not yet applied) edit is simply removed; an already-logged edit is reversed by a counter-edit at the model\'s next step. Only the latest operation can be undone.', risk: zhL ? '无风险。' : 'No risk.' }
    if (name === 'setRealtime') return { title: t('realtime'), impact: zhL ? '开启后，替换/删除/回退会在模型下一步推理时写入会话日志并真正生效（真正节省 token）；已做的视图编辑会一并入队。' : 'When ON, replace/delete/rollback are written to the session log at the model\'s next step and truly take effect (really saves tokens); pending view edits are queued too.', risk: zhL ? '写入日志的编辑不可抹除，只能再写一条反向修改还原；replay 与 token 计量始终与模型实际所见一致。' : 'A logged edit cannot be erased, only reversed by a counter-edit; replay and token accounting always match what the model actually saw.' }
    return { title: t('confirmTitle'), impact: '', risk: '' }
  }

  const askConfirm = (name: string, args: Record<string, unknown>) => setConfirmOp({ name, args })

  const nodeSuggestion = (node: TurnGroup): string => {
    if (node.kind === 'system') return `**${t('suggestion')}：**\n- ${lang === 'zh' ? '无需处理（系统注入内容不可删除，且模型每次推理都需要）。' : 'No action needed (system-injected content cannot be deleted and is needed every step).'}`
    if (node.kind === 'user') return `**${t('suggestion')}：**\n- ${lang === 'zh' ? '保留（这是你的实际请求，模型依赖它才能回答）。' : 'Keep it (this is your actual request; the model needs it to answer).'}`
    const stale = node.segments.filter(s => s.effectiveness === 'stale').length
    const redundant = node.segments.filter(s => s.effectiveness === 'redundant').length
    const lines: string[] = []
    if (stale + redundant > 0) lines.push(`- ${lang === 'zh' ? `该轮次有 ${stale} 条过期、${redundant} 条冗余片段，可删除以节省 Token（模型已不再使用这些内容）。` : `This turn has ${stale} stale and ${redundant} redundant segments; delete them to save tokens (the model no longer uses them).`}`)
    lines.push(`- ${lang === 'zh' ? '其余「有效」片段请保留（是对话主线，删除会影响回答质量）。' : 'Keep the remaining effective segments (they are the conversation backbone; deleting them harms answer quality).'}`)
    return `**${t('suggestion')}：**\n${lines.join('\n')}`
  }

  const nodeExplain = (node: TurnGroup): string => {
    let head: string
    if (node.kind === 'turn') head = `**${t('turn')} ${node.turn}** = ${t('expTurn')}`
    else if (node.kind === 'system') head = `**${t('systemInput')}** = ${t('expSystem')}`
    else head = `**${t('userInput')}** = ${t('expUserInput')}`
    return `${head}\n\n- **${node.segments.length} ${t('seg')}** = ${t('expSegCount')}\n\n${nodeSuggestion(node)}`
  }

  const renderContent = (seg: CtmSegment) => {
    // Raw text, never unescapeText: real prose can contain literal backslash
    // sequences (regexes, Windows paths) that unescaping would silently corrupt.
    const raw = seg.content
    const long = raw.length > 240
    const open = !!expContent[seg.id]
    const show = long ? (open ? raw : raw.slice(0, 240) + '…') : raw
    return (
      <div>
        <div className={`ctm-content${long && !open ? ' trunc' : ''}`}>{renderMarkdown(show)}</div>
        {long && <button type="button" className="ctm-btn" onClick={() => toggle(seg.id, expContent, setExpContent)}>{open ? t('collapse') : t('expand')}</button>}
      </div>
    )
  }

  const renderToolCalls = (seg: CtmSegment) => {
    if (!seg.toolCalls?.length) return null
    const open = !!expTools[seg.id]
    return (
      <div className="ctm-tools">
        <button type="button" className="ctm-btn" onClick={() => toggle(seg.id, expTools, setExpTools)}>{(open ? t('collapse') : t('expand')) + ' ' + seg.toolCalls.length + ' ' + t('toolCalls')}</button>
        {open && seg.toolCalls.map((tc, i) => (
          <div key={i} className="ctm-toolitem">{'▸ ' + (tc.name ?? '') + '\n' + unescapeText(String(tc.arguments ?? ''))}</div>
        ))}
      </div>
    )
  }

  const renderSegment = (seg: CtmSegment) => {
    const isSystem = seg.source === 'system_inject'
    const isUserInput = seg.role === 'user' && seg.source === 'user_input'
    const isEditing = editing?.id === seg.id
    const thinkOpen = !!expThink[seg.id]
    const body = isEditing ? (
      <div className="ctm-hint">{t('editing')}…</div>
    ) : (
      <div>
        {renderContent(seg)}
        {seg.reasoning && seg.role === 'assistant' && (
          <div>
            <button type="button" className="ctm-btn" onClick={() => toggle(seg.id, expThink, setExpThink)}>{(thinkOpen ? t('collapse') : t('expand')) + ' ' + t('thinking')}</button>
            {thinkOpen && <div className="ctm-thinking">{seg.reasoning}</div>}
          </div>
        )}
        {renderToolCalls(seg)}
        <div className="ctm-actions">
          {!isSystem && seg.role !== 'tool' && <button type="button" className="ctm-btn" disabled={busy} onClick={() => setEditing({ id: seg.id, text: seg.content, role: roleLabel(seg.role), turnIndex: seg.turn_index })}>{t('replace')}</button>}
          {seg.id === 'seg-system' && <button type="button" className="ctm-btn" disabled={busy} onClick={() => setEditing({ id: seg.id, text: seg.content, role: roleLabel(seg.role), turnIndex: seg.turn_index })}>{t('replace')}</button>}
          {!isSystem && <button type="button" className="ctm-btn danger" disabled={busy} onClick={() => askConfirm('delete', { segmentId: seg.id })}>{t('delete')}</button>}
          {isUserInput && <button type="button" className="ctm-btn" title={t('rollbackTip')} disabled={busy} onClick={() => askConfirm('rollback', { turnIndex: seg.turn_index })}>{t('rollback')}</button>}
          {!isSystem && <button type="button" className="ctm-btn" disabled={busy} onClick={() => askConfirm('override', { segmentId: seg.id, value: seg.effectiveness === 'effective' ? 'stale' : 'effective' })}>{seg.effectiveness === 'effective' ? t('markStale') : t('markEffective')}</button>}
        </div>
      </div>
    )
    return (
      <div key={seg.id} className={`ctm-card ${borderClass(seg)}`}>
        <dl className="ctm-dl">
          <dt>{t('role')}</dt><dd>{roleLabel(seg.role)}{seg.turn != null ? ` · ${t('turn')} ${seg.turn}${seg.step != null ? '.' + seg.step : ''}` : ''}</dd>
          <dt>{t('cache')}</dt><dd><span className={`ctm-badge ${seg.cache_status || 'unknown'}`} title={cacheTip(seg.cache_status)}>{cacheLabel(seg.cache_status)}</span></dd>
          <dt>{t('eff')}</dt><dd><span className={`ctm-badge eff-${seg.effectiveness || 'effective'}`} title={effTip(seg.effectiveness)}>{effLabel(seg.effectiveness)}</span></dd>
          <dt>{t('seg')}</dt><dd>{`#${seg.turn_index} · ${fmtTime(seg.created_at)}${seg.edited ? ' · ' + t('edited') : ''}`}{seg.pending && <span className="ctm-badge unknown" title={t('pendingTip')}>{t('pending')}</span>}</dd>
        </dl>
        {body}
      </div>
    )
  }

  const renderStep = (step: StepGroup) => {
    const segs = step.segments
    const assistant = segs.filter(s => s.role === 'assistant')
    const tools = segs.filter(s => s.role === 'tool')
    const other = segs.filter(s => s.role !== 'assistant' && s.role !== 'tool')
    const open = !!expSteps[step.key]
    const baseLabel = step.sourceKind ? sourceKindLabel(segs[0]) : roleLabel(step.label)
    const label = step.num != null ? `${baseLabel} ${step.num}` : (step.label.startsWith('step-') ? `${t('step')} ${step.label.slice(5)}` : baseLabel)
    return (
      <div className="ctm-step">
        <div className="ctm-step-head" onClick={() => toggle(step.key, expSteps, setExpSteps)}>
          <span>{(open ? '▾ ' : '▸ ') + label}{assistant.length ? ` · ${assistant.length} ${t('assistant')}` : ''}{tools.length ? ` · ${tools.length} ${t('toolResults')}` : ''}{other.length ? ` · ${other.length}` : ''}</span>
          <span className="ctm-node-sub">{step.turn != null ? <span className="ctm-turn-label">{`${t('turn')} ${step.turn}`}</span> : null}{' '}{segs.length} {t('seg')}</span>
        </div>
        {open && <div>{[...other, ...assistant, ...tools].map(renderSegment)}</div>}
      </div>
    )
  }

  const renderNode = (node: TurnGroup) => {
    const open = !!expTurns[node.key]
    const explainOpen = !!explainPin[node.key] || explainHover === node.key
    const title = node.kind === 'system' ? t('systemInput') : node.kind === 'user' ? t('userInput') : `${t('turn')} ${node.turn}`
    return (
      <div key={node.key} className={`ctm-node ${node.kind === 'system' ? 'system' : ''}`}>
        <div className="ctm-node-head">
          <div className="ctm-node-title-wrap" onClick={() => toggle(node.key, expTurns, setExpTurns)}>
            <div className="ctm-node-title">{(open ? '▾ ' : '▸ ') + title}</div>
            <div className="ctm-node-sub">{node.segments.length} {t('seg')}</div>
          </div>
          <div className="ctm-node-actions">
            <div className="ctm-explain-wrap" onMouseEnter={() => setExplainHover(node.key)} onMouseLeave={() => setExplainHover(null)}>
              <button type="button" className="ctm-btn" onClick={() => toggle(node.key, explainPin, setExplainPin)}>{t('explain')}</button>
              {explainOpen && <div className="ctm-explain">{renderMarkdown(nodeExplain(node))}</div>}
            </div>
          </div>
        </div>
        {open && <div>{node.steps.map(renderStep)}</div>}
      </div>
    )
  }

  const renderLegend = () => {
    const items: { dot: string; dash?: boolean; term: string; txt: string }[] = [
      { dot: 'var(--dsw-alias-state-success-primary)', term: t('cacheHitLabel'), txt: t('legCacheHit') },
      { dot: 'var(--dsw-alias-brand-primary)', term: t('cacheMissLabel'), txt: t('legCacheMiss') },
      { dot: 'var(--dsw-alias-state-success-primary)', term: t('effEffective'), txt: t('legEffective') },
      { dot: 'var(--dsw-alias-state-warn-primary)', term: t('effRedundant'), txt: t('legRedundant') },
      { dot: 'var(--dsw-alias-state-warn-primary)', term: t('effStale'), txt: t('legStale') },
      { dot: 'transparent', dash: true, term: t('effInjected'), txt: t('legInjected') },
      { dot: '#9b59b6', term: t('replace'), txt: t('legReplace') },
      { dot: '#e74c3c', term: t('delete'), txt: t('legDelete') },
      { dot: '#e67e22', term: `${t('markStale')} / ${t('markEffective')}`, txt: t('legMark') },
    ]
    return (
      <div className="ctm-legend-wrap" onMouseEnter={() => setLegendHover(true)} onMouseLeave={() => setLegendHover(false)}>
        <button type="button" className="ctm-btn">{t('legend')}</button>
        {legendHover && (
          <div className="ctm-legend-pop">
            <h4>{t('legTitle')}</h4>
            {items.map((it, i) => (
              <div key={i} className="ctm-legend-row">
                {it.dot && <span className="ctm-dot" style={it.dash ? { background: 'transparent', border: '1px dashed var(--dsw-alias-border-l2)' } : { background: it.dot }} />}
                <span><strong>{it.term}</strong> — {it.txt}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const recoveredSegments = useMemo(() => (state ? recoverTurns(state.segments) : []), [state])
  const nodes = useMemo(() => (state ? groupNodes(recoveredSegments) : []), [state, recoveredSegments])
  const sum = state?.summary
  const totalPages = Math.max(1, Math.ceil(nodes.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageNodes = nodes.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const confirmInfo = confirmOp ? opInfo(confirmOp.name) : null

  if (loading && !state) return <div className="ctm-wrap"><div className="ctm-empty">{t('loading')}</div></div>
  if (error && !state) return <div className="ctm-wrap"><div className="ctm-notice error">{t('loadFailed')}：{error}</div></div>
  if (!state) return <div className="ctm-wrap"><div className="ctm-empty">{t('noSession')}</div></div>

  if (minimized) {
    return (
      <div className="ctm-wrap">
        <div className="ctm-minbar">
          <button type="button" className="ctm-btn" onClick={() => setMinimized(false)}>{'▴ ' + t('expandView')}</button>
          <span className="ctm-hint">{`Context · ${t('totalTokens')} ${fmtNum(sum?.inputTokens)} · ${t('cacheHit')} ${fmtNum(sum?.cachedTokens)}`}</span>
          {renderLegend()}
          <button type="button" className="ctm-btn" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>{t('lang')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ctm-wrap">
      <div className="ctm-sticky">
        <div className="ctm-summary">
          <div className="ctm-kpi"><span className="k">{t('totalTokens')}</span><span className="v">{fmtNum(sum?.inputTokens)}</span></div>
          <div className="ctm-kpi"><span className="k">{t('cacheHit')}</span><span className="v">{fmtNum(sum?.cachedTokens)}</span></div>
          <div className="ctm-kpi"><span className="k">{t('outputTokens')}</span><span className="v">{fmtNum(sum?.outputTokens)}</span></div>
          <div className="ctm-kpi"><span className="k">{t('reasoningTokens')}</span><span className="v">{fmtNum(sum?.reasoningTokens)}</span></div>
          {sum?.model && <div className="ctm-kpi"><span className="k">{t('model')}</span><span className="v"><small>{sum.model.provider + ' · ' + sum.model.model}</small></span></div>}
          <button type="button" className={`ctm-btn ${state.realtime ? 'realtime-on' : ''}`} title={t('realtimeTip')} onClick={() => { if (state.realtime) void run(() => setRealtime(false)); else askConfirm('setRealtime', { enabled: true }) }}>{`${t('realtime')}: ${state.realtime ? t('realtimeOn') : t('realtimeOff')}`}</button>
          <button type="button" className="ctm-btn primary" title={t('refreshTip')} onClick={() => void load()}>{t('refresh')}</button>
          <button type="button" className="ctm-btn" title={t('resetTip')} onClick={() => askConfirm('reset', {})}>{t('reset')}</button>
          <button type="button" className="ctm-btn" title={t('snapshotsTip')} onClick={() => setShowSnap(v => !v)}>{`${t('snapshots')}(${state.snapshots.length})`}</button>
          <button type="button" className="ctm-btn" title={t('trashTip')} onClick={() => setShowTrash(v => !v)}>{`${t('trash')}(${state.trash.length})`}</button>
          <button type="button" className="ctm-btn" onClick={() => setMinimized(true)}>{'▾ ' + t('minimize')}</button>
          {renderLegend()}
          <button type="button" className="ctm-btn" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>{t('lang')}</button>
        </div>
      </div>

      {state.notice && <div className={`ctm-notice ${state.notice.kind || 'ok'}`}>{noticeText(state.notice)}</div>}
      {(state.interceptError ?? null) !== null && <div className="ctm-notice warn">{t('interceptFailed')}：{state.interceptError}</div>}
      {(state.applyError ?? null) !== null && <div className="ctm-notice error">{t('applyFailed')}：{state.applyError}</div>}
      {error && <div className="ctm-notice error">{t('opFailed')}：{error}</div>}

      {showSnap && state.snapshots.length > 0 && (
        <div>
          <div className="ctm-section-title">{`${t('snapshots')}（HEAD：${state.head}）`}</div>
          {state.snapshots.map(s => (
            <div key={s.id} className="ctm-actions">
              <span className="ctm-hint">{`${s.label} · ${s.segmentCount} · ${fmtTime(s.createdAt)}`}</span>
              <button type="button" className="ctm-btn" disabled={busy} onClick={() => askConfirm('restore', { snapshotId: s.id })}>{t('restore')}</button>
            </div>
          ))}
        </div>
      )}

      {showTrash && state.trash.length > 0 && (
        <div>
          <div className="ctm-section-title">{t('trash')}</div>
          {state.trash.map(tt => <div key={tt.id} className="ctm-hint">{`#${tt.turn_index} · ${roleLabel(tt.role)} · ${(tt.content || '').slice(0, 60)}`}</div>)}
          <button type="button" className="ctm-btn" disabled={busy} onClick={() => askConfirm('undo', {})}>{t('undo')}</button>
        </div>
      )}

      {totalPages > 1 && (
        <div className="ctm-pager">
          <button type="button" className="ctm-btn" disabled={safePage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>{t('prevPage')}</button>
          <span className="ctm-hint">{`${t('page')} ${safePage + 1} ${t('of')} ${totalPages}`}</span>
          <button type="button" className="ctm-btn" disabled={safePage >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>{t('nextPage')}</button>
        </div>
      )}

      <div className="ctm-flow">{pageNodes.map(renderNode)}</div>

      {(sum?.rolledBackCount ?? 0) > 0 && (
        <div>
          <div className="ctm-section-title">{`${t('rolledBackSection')}（${sum?.rolledBackCount}）`}</div>
          {showRolledBack ? <div>{recoveredSegments.filter(s => s.rolledBack).map(renderSegment)}</div> : <button type="button" className="ctm-btn" onClick={() => setShowRolledBack(true)}>{t('showRolledBack')}</button>}
        </div>
      )}

      {editing && (
        <div className="ctm-editor">
          <div className="ctm-node-title">{`${t('replace')} · ${editing.role} #${editing.turnIndex}`}</div>
          <textarea className="ctm-textarea" value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} />
          <div className="ctm-actions">
            <button type="button" className="ctm-btn primary" disabled={busy} onClick={() => askConfirm('replace', { segmentId: editing.id, content: editing.text })}>{t('save')}</button>
            <button type="button" className="ctm-btn" disabled={busy} onClick={() => setEditing(null)}>{t('cancel')}</button>
          </div>
        </div>
      )}

      {confirmOp && (
        <div className="ctm-modal-overlay" onClick={() => setConfirmOp(null)}>
          <div className="ctm-modal" onClick={e => e.stopPropagation()}>
            <div className="ctm-node-title">{`${t('confirmTitle')}：${confirmInfo?.title ?? ''}`}</div>
            <div className="ctm-modal-row"><b>{t('impact')}</b>{confirmInfo?.impact ?? ''}</div>
            <div className="ctm-modal-row"><b>{t('risk')}</b>{confirmInfo?.risk ?? ''}</div>
            <div className="ctm-actions">
              <button type="button" className="ctm-btn danger" disabled={busy} onClick={() => { const op = confirmOp; setConfirmOp(null); const fn = op.name; if (fn === 'replace') void run(() => replace(op.args.segmentId as string, op.args.content as string)); else if (fn === 'delete') void run(() => deleteSegment(op.args.segmentId as string)); else if (fn === 'rollback') void run(() => rollback(op.args.turnIndex as number)); else if (fn === 'restore') void run(() => restore(op.args.snapshotId as string)); else if (fn === 'reset') void run(reset); else if (fn === 'undo') void run(undo); else if (fn === 'override') void run(() => override(op.args.segmentId as string, op.args.value as string | null)); else if (fn === 'setRealtime') void run(() => setRealtime(true)) }}>{t('confirm')}</button>
              <button type="button" className="ctm-btn" onClick={() => setConfirmOp(null)}>{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CtmView
