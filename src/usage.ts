/**
 * MECE usage-bucket math shared by host and client: mapping one request's
 * provider usage into the wire shape, accumulating totals, and folding a
 * complete session log the same way the host's `tokenUsage` projection does.
 * No cordis state — every function is pure and unit-tested.
 */
import type { CtmUsage, CtmUsageTotals } from './contract'

export function emptyTotals(): CtmUsageTotals {
  return { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
}

/**
 * Map a raw provider `TokenUsage` (inputTokens / cacheReadTokens /
 * cacheWriteTokens / outputTokens / reasoningTokens) onto the wire usage
 * shape. `cacheWrite` and `reasoning` stay absent unless the provider
 * actually reported a non-zero value.
 */
export function usageFromRaw(u: Record<string, unknown>): CtmUsage {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const usage: CtmUsage = {
    input: num(u.inputTokens),
    cacheRead: num(u.cacheReadTokens),
    output: num(u.outputTokens),
  }
  const cacheWrite = num(u.cacheWriteTokens)
  if (cacheWrite > 0) usage.cacheWrite = cacheWrite
  const reasoning = num(u.reasoningTokens)
  if (reasoning > 0) usage.reasoning = reasoning
  return usage
}

/** One request's wire usage re-bucketed as totals (same MECE fields). */
export function totalsFromRequest(u: CtmUsage): CtmUsageTotals {
  return {
    uncachedInput: u.input,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite ?? 0,
    output: u.output,
    ...(u.reasoning !== undefined ? { reasoning: u.reasoning } : {}),
  }
}

export function addTotals(acc: CtmUsageTotals, next: CtmUsageTotals): CtmUsageTotals {
  acc.uncachedInput += next.uncachedInput
  acc.cacheRead += next.cacheRead
  acc.cacheWrite += next.cacheWrite
  acc.output += next.output
  if (next.reasoning !== undefined) acc.reasoning = (acc.reasoning ?? 0) + next.reasoning
  return acc
}

/** Billed prompt side: the three disjoint input buckets summed. */
export function billedInput(t: CtmUsageTotals): number {
  return t.uncachedInput + t.cacheRead + t.cacheWrite
}

/** Cache-hit share of the billed prompt side (0..1); null when nothing was billed. */
export function cacheHitRate(t: CtmUsageTotals): number | null {
  const d = billedInput(t)
  return d === 0 ? null : t.cacheRead / d
}

/**
 * Sum the provider usage carried by segments (assistant segments only — the
 * host attaches `usage` nowhere else). Null when no segment carries usage,
 * so the caller can hide the figure instead of showing zeros.
 */
export function sumSegmentUsage(segments: readonly { usage?: CtmUsage | undefined }[]): CtmUsageTotals | null {
  let total: CtmUsageTotals | null = null
  for (const seg of segments) {
    if (seg.usage === undefined) continue
    total = addTotals(total ?? emptyTotals(), totalsFromRequest(seg.usage))
  }
  return total
}

/** Structural minimum the usage fold needs from a session event. */
export interface UsageEventLike {
  type?: unknown
  data?: unknown
}

/**
 * Fold a COMPLETE session log into cumulative totals, mirroring the host's
 * `tokenUsage` projection: a `assistant/chunk` usage chunk is an early
 * sample for its step and the `assistant/message` the final one, so a
 * repeated (turn, step) sample REPLACES the earlier value instead of
 * double-counting. Returns null when the log reports no usage at all.
 *
 * This is the fallback for hosts where the projection registry or the live
 * session is unavailable: correct, but it re-scans the whole log on every
 * read, so the projection path is preferred whenever it exists.
 */
export function foldUsageEvents(events: readonly UsageEventLike[]): CtmUsageTotals | null {
  const byStep = new Map<string, CtmUsageTotals>()
  for (const ev of events) {
    const d = (ev.data ?? {}) as Record<string, unknown>
    let usage: Record<string, unknown> | undefined
    if (ev.type === 'assistant/chunk') {
      const chunk = d.chunk as { type?: unknown; usage?: Record<string, unknown> } | undefined
      if (chunk?.type !== 'usage') continue
      usage = chunk.usage
    } else if (ev.type === 'assistant/message') {
      usage = d.usage as Record<string, unknown> | undefined
    } else {
      continue
    }
    if (usage === undefined) continue
    const turn = typeof d.turn === 'number' ? d.turn : 0
    const step = typeof d.step === 'number' ? d.step : 0
    byStep.set(`${turn}:${step}`, totalsFromRequest(usageFromRaw(usage)))
  }
  if (byStep.size === 0) return null
  let total = emptyTotals()
  for (const buckets of byStep.values()) total = addTotals(total, buckets)
  return total
}

/**
 * The most recent request's usage in a complete log (scan from the tail),
 * in the same totals buckets. Null when no usage was ever reported.
 */
export function lastRequestUsage(events: readonly UsageEventLike[]): CtmUsageTotals | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev?.type !== 'assistant/message') continue
    const usage = (ev.data as { usage?: Record<string, unknown> } | undefined)?.usage
    if (usage !== undefined) return totalsFromRequest(usageFromRaw(usage))
  }
  return null
}
