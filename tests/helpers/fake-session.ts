/**
 * High-fidelity fake of the DSH session for integration tests. It mirrors the
 * canonical surface fold (`packages/core/session/src/surface.ts`: surfaceOp
 * validation, sourceEventSeqs provenance completeness, replace splice,
 * tool/result rewrite restriction, deriveEventMessage projection) and the
 * relational invariant (`packages/core/session/src/invariant.ts`: turn/step
 * sequencing, tool/result replacement requires an open turn, tool/result
 * append requires a pending tool/call in the open step). Behavior here is
 * transcribed from those two modules, not simplified from intuition.
 */

export interface FakeSurfaceOpReplace { op: 'replace'; startSeq: number; endSeq: number }
export type FakeSurfaceOp = 'append' | FakeSurfaceOpReplace

export interface FakeEvent {
  seq: number
  type: string
  data: any
  surfaceOp?: FakeSurfaceOp
  sourceEventSeqs?: number[]
}

export interface FakeAppendIntent {
  surfaceOp: FakeSurfaceOp
  sourceEventSeqs?: number[]
}

const SURFACE_EVENT_TYPES = new Set<string>(['system/message', 'user/message', 'assistant/message', 'tool/result'])

function isEventSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Deep structural equality over the JSON value domain (surface.ts isDeepEqualJson). */
function isDeepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => isDeepEqualJson(item, b[i]))
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const aKeys = Object.keys(a)
  const bRecord = b as Record<string, unknown>
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every(key => Object.hasOwn(bRecord, key) && isDeepEqualJson((a as Record<string, unknown>)[key], bRecord[key]))
}

export class FakeSession {
  readonly events: FakeEvent[] = []
  private readonly nodeSeqs: number[] = []
  private replaceGeneration = 0
  // Relational invariant trace (invariant.ts SessionTrace).
  private openTurn: number | null = null
  private openStep: number | null = null
  private nextTurn = 1
  private nextStep = 1
  private readonly pendingCalls = new Set<string>()

  constructor(readonly id: string) {}

  /** Live surface view, same shape the real SessionSurface exposes. */
  get surface(): { nodes: readonly number[] } {
    return { nodes: this.nodeSeqs }
  }

  /** Immutable-style log snapshot exposed by Session V3. */
  snapshotEvents(): readonly FakeEvent[] {
    return [...this.events]
  }

  /** Positional event lookup exposed by Session V3. */
  eventAt(seq: number): FakeEvent | undefined {
    return this.events[seq]
  }

  /** Test sugar: open the next turn (the flush window edits land in). */
  beginTurn(): number {
    const turn = this.nextTurn
    this.append('turn/start', { turn })
    return turn
  }

  /** Test sugar: close the currently open turn. */
  endTurn(): void {
    if (this.openTurn === null) throw new Error('no open turn to end')
    this.append('turn/end', { turn: this.openTurn })
  }

  /**
   * Append one event, validating the surface contract and the relational
   * invariant BEFORE the log changes, exactly like the real Session.append
   * (surface validateNext + internal/dispatch invariant validation, then commit).
   */
  append(type: string, data: unknown, intent?: FakeAppendIntent): FakeEvent {
    const seq = this.events.length
    const event: FakeEvent = {
      seq,
      type,
      data: structuredClone(data),
      ...(intent?.surfaceOp !== undefined ? { surfaceOp: intent.surfaceOp } : {}),
      ...(intent?.sourceEventSeqs !== undefined ? { sourceEventSeqs: [...intent.sourceEventSeqs] } : {}),
    }
    this.assertInvariant(event)
    this.foldSurface(event)
    this.events.push(event)
    return event
  }

  /** Relational invariant over one candidate event (invariant.ts validateEvent + applyTransition). */
  private assertInvariant(event: FakeEvent): void {
    const fail = (msg: string): never => { throw new Error(msg) }
    const requireOpenStep = (kind: string, turn: number, step: number): void => {
      if (this.openTurn !== turn || this.openStep !== step) {
        fail(`${kind} names turn ${turn}/step ${step} but open is turn ${this.openTurn}/step ${this.openStep}`)
      }
    }
    const d = event.data ?? {}
    switch (event.type) {
      case 'turn/start': {
        if (this.openTurn !== null) fail(`turn/start ${d.turn} while turn ${this.openTurn} is still open`)
        if (d.turn !== this.nextTurn) fail(`turn/start expected turn ${this.nextTurn}, got ${d.turn}`)
        this.openTurn = d.turn
        this.nextStep = 1
        break
      }
      case 'turn/end': {
        if (this.openTurn !== d.turn) fail(`turn/end ${d.turn} does not match open turn ${this.openTurn}`)
        if (this.openStep !== null) fail(`turn/end ${d.turn} while step ${this.openStep} is still open`)
        this.openTurn = null
        this.nextTurn += 1
        break
      }
      case 'step/start': {
        if (this.openTurn !== d.turn) fail(`step/start in turn ${d.turn} but open turn is ${this.openTurn}`)
        if (this.openStep !== null) fail(`step/start ${d.step} while step ${this.openStep} is still open`)
        if (d.step !== this.nextStep) fail(`step/start expected step ${this.nextStep} in turn ${d.turn}, got ${d.step}`)
        this.openStep = d.step
        break
      }
      case 'step/end': {
        requireOpenStep('step/end', d.turn, d.step)
        this.pendingCalls.clear()
        this.openStep = null
        this.nextStep += 1
        break
      }
      case 'assistant/attempt':
      case 'assistant/message': {
        requireOpenStep(event.type, d.turn, d.step)
        break
      }
      case 'tool/call': {
        requireOpenStep('tool/call', d.turn, d.step)
        this.pendingCalls.add(d.callId)
        break
      }
      case 'tool/result': {
        // A content rewrite cites its replaced event and only needs an open
        // turn; a fresh result needs the matching pending call in the open step.
        if (event.surfaceOp !== 'append') {
          if (this.openTurn === null) fail('tool/result surface replacement appended outside any open turn')
          break
        }
        requireOpenStep('tool/result', d.turn, d.step)
        const callId = d.message?.source?.callId
        if (!this.pendingCalls.has(callId)) fail(`tool/result for ${callId} with no prior tool/call in this step`)
        this.pendingCalls.delete(callId)
        break
      }
      case 'system/message':
        requireOpenStep('system/message', d.turn, d.step)
        break
      case 'user/message':
        break
      default:
        break
    }
  }

  /** Canonical surface fold over one candidate event (surface.ts planSurfaceEvent + applySurfacePlan). */
  private foldSurface(event: FakeEvent): void {
    if (!SURFACE_EVENT_TYPES.has(event.type)) {
      if (event.surfaceOp !== undefined) {
        throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry surfaceOp`)
      }
      if (event.sourceEventSeqs !== undefined) {
        throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry sourceEventSeqs`)
      }
      return
    }
    const op = event.surfaceOp
    if (op === undefined) {
      throw new Error(`session event "${event.type}" is surface-eligible and requires a surfaceOp marker`)
    }
    if (op === 'append') {
      this.assertProvenance(event, [])
      this.nodeSeqs.push(event.seq)
      return
    }
    if (typeof op !== 'object' || op === null || op.op !== 'replace' || !isEventSeq(op.startSeq) || !isEventSeq(op.endSeq)) {
      throw new Error(`session event "${event.type}" carries an invalid replace surfaceOp`)
    }
    const startIdx = this.nodeSeqs.indexOf(op.startSeq)
    if (startIdx === -1) throw new Error(`surface replace: start seq ${op.startSeq} not found in surface`)
    const endIdx = this.nodeSeqs.indexOf(op.endSeq)
    if (endIdx === -1) throw new Error(`surface replace: end seq ${op.endSeq} not found in surface`)
    if (startIdx > endIdx) {
      throw new Error(`surface replace: start seq ${op.startSeq} (index ${startIdx}) is after end seq ${op.endSeq} (index ${endIdx})`)
    }
    const shadowedSeqs = this.nodeSeqs.slice(startIdx, endIdx + 1)
    this.assertProvenance(event, shadowedSeqs)
    this.assertToolResultRewrite(event, shadowedSeqs)
    this.nodeSeqs.splice(startIdx, endIdx - startIdx + 1, event.seq)
    this.replaceGeneration += 1
  }

  /** sourceEventSeqs validity + shadowed-node completeness (surface.ts assertProvenance). */
  private assertProvenance(event: FakeEvent, shadowedSeqs: readonly number[]): void {
    const raw = event.sourceEventSeqs
    const sources = new Set<number>()
    if (raw !== undefined) {
      if (raw.length === 0 && event.type !== 'assistant/message') {
        throw new Error('sourceEventSeqs must not be empty except on assistant/message')
      }
      for (const source of raw) {
        if (!isEventSeq(source)) {
          throw new Error(`session event "${event.type}" sourceEventSeqs must densely contain non-negative safe integers`)
        }
        if (sources.has(source)) throw new Error('sourceEventSeqs must not contain duplicates')
        if (source >= event.seq) {
          throw new Error(`sourceEventSeqs must reference earlier events: ${source} >= current seq ${event.seq}`)
        }
        sources.add(source)
      }
    }
    const missing = shadowedSeqs.filter(seq => !sources.has(seq))
    if (missing.length > 0) {
      throw new Error(`surface replace: sourceEventSeqs must include every shadowed surface node; missing ${missing.join(', ')}`)
    }
  }

  /** A tool/result replace may only rewrite one current result's content (surface.ts assertToolResultRewrite). */
  private assertToolResultRewrite(event: FakeEvent, shadowedSeqs: readonly number[]): void {
    if (event.type !== 'tool/result') return
    if (shadowedSeqs.length !== 1) {
      throw new Error('tool/result surface replacement must rewrite exactly one current node')
    }
    const original = this.eventAt(shadowedSeqs[0]!)
    if (original?.type !== 'tool/result') {
      throw new Error('tool/result surface replacement must target a current tool/result')
    }
    const normalize = (data: any): unknown => {
      const result = data.message.content[0]
      return { ...data, message: { ...data.message, content: [{ ...result, content: null }] } }
    }
    if (!isDeepEqualJson(normalize(original.data), normalize(event.data))) {
      throw new Error('tool/result surface replacement may change only content')
    }
  }

  /** surface.ts deriveEventMessage: null for non-surface events and empty-content system/assistant messages. */
  private deriveEventMessage(event: FakeEvent): any | null {
    switch (event.type) {
      case 'user/message':
        return event.data
      case 'system/message':
      case 'assistant/message':
        if (event.data.message.content.length === 0) return null
        return event.data.message
      case 'tool/result':
        return event.data.message
      default:
        return null
    }
  }

  /** Model-visible history: the projection folded over the CURRENT surface only. */
  deriveMessages(): any[] {
    const out: any[] = []
    for (const seq of this.nodeSeqs) {
      const msg = this.deriveEventMessage(this.eventAt(seq)!)
      if (msg !== null) out.push(msg)
    }
    return out
  }
}
