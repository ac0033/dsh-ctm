/**
 * Pure grouping logic: recover per-segment turn/step for user/message events
 * and fold the flat segment list into the turn → step hierarchy the view
 * renders. No React, no view state.
 */
import type { CtmSegment } from '../contract'

export interface StepGroup { key: string; label: string; num?: number; turn?: number; sourceKind?: string | null; segments: CtmSegment[] }
export interface TurnGroup { key: string; kind: 'user' | 'system' | 'turn'; turn: number | null; belongsToTurn?: number; segments: CtmSegment[]; steps: StepGroup[] }

/**
 * Recover a per-segment `turn`/`step` for `user/message` surface events, whose
 * data carries no turn/step (unlike `assistant/message` and `tool/result`).
 * Each null-turn segment takes the NEXT turn/step-carrying segment's turn (the
 * step that consumed it); trailing ones (the in-flight turn) take `maxTurn + 1`.
 * Done client-side too so the view stays correct even against a host that has
 * not been reloaded yet.
 */
export function recoverTurns(segments: CtmSegment[]): CtmSegment[] {
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

export function groupNodes(segments: CtmSegment[]): TurnGroup[] {
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
