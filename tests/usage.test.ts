import { describe, it, expect } from 'vitest'
import {
  addTotals,
  billedInput,
  cacheHitRate,
  emptyTotals,
  foldUsageEvents,
  lastRequestUsage,
  sumSegmentUsage,
  totalsFromRequest,
  usageFromRaw,
} from '../src/usage'

describe('usageFromRaw', () => {
  it('maps provider buckets onto the wire shape and drops zero cacheWrite/reasoning', () => {
    expect(usageFromRaw({ inputTokens: 10, cacheReadTokens: 90, outputTokens: 5 })).toEqual({ input: 10, cacheRead: 90, output: 5 })
  })

  it('keeps non-zero cacheWrite and reasoning', () => {
    expect(usageFromRaw({ inputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3, outputTokens: 4, reasoningTokens: 5 }))
      .toEqual({ input: 1, cacheRead: 2, cacheWrite: 3, output: 4, reasoning: 5 })
  })

  it('tolerates missing or non-numeric fields as zero', () => {
    expect(usageFromRaw({})).toEqual({ input: 0, cacheRead: 0, output: 0 })
    expect(usageFromRaw({ inputTokens: 'x', outputTokens: Number.NaN })).toEqual({ input: 0, cacheRead: 0, output: 0 })
  })
})

describe('MECE totals math', () => {
  it('billedInput sums the three disjoint prompt buckets', () => {
    expect(billedInput({ uncachedInput: 10, cacheRead: 80, cacheWrite: 10, output: 5 })).toBe(100)
  })

  it('cacheHitRate divides by the full billed prompt side; null at zero', () => {
    expect(cacheHitRate({ uncachedInput: 10, cacheRead: 80, cacheWrite: 10, output: 0 })).toBe(0.8)
    expect(cacheHitRate(emptyTotals())).toBeNull()
  })

  it('addTotals accumulates every bucket, reasoning staying optional', () => {
    const acc = emptyTotals()
    addTotals(acc, { uncachedInput: 1, cacheRead: 2, cacheWrite: 3, output: 4 })
    addTotals(acc, { uncachedInput: 10, cacheRead: 20, cacheWrite: 30, output: 40, reasoning: 7 })
    expect(acc).toEqual({ uncachedInput: 11, cacheRead: 22, cacheWrite: 33, output: 44, reasoning: 7 })
  })

  it('totalsFromRequest re-buckets one request without inventing reasoning', () => {
    expect(totalsFromRequest({ input: 1, cacheRead: 2, output: 3 })).toEqual({ uncachedInput: 1, cacheRead: 2, cacheWrite: 0, output: 3 })
  })
})

describe('sumSegmentUsage', () => {
  it('sums only segments that carry usage; null when none do', () => {
    expect(sumSegmentUsage([{}, {}])).toBeNull()
    const total = sumSegmentUsage([
      { usage: { input: 1, cacheRead: 9, output: 2 } },
      {},
      { usage: { input: 3, cacheRead: 7, output: 4, reasoning: 1 } },
    ])
    expect(total).toEqual({ uncachedInput: 4, cacheRead: 16, cacheWrite: 0, output: 6, reasoning: 1 })
  })
})

const msg = (turn: number, step: number, usage: Record<string, number>) => ({ type: 'assistant/message', data: { turn, step, usage } })
const chunk = (turn: number, step: number, usage: Record<string, number>) => ({ type: 'assistant/chunk', data: { turn, step, chunk: { type: 'usage', usage } } })

describe('foldUsageEvents', () => {
  it('returns null for a log without usage', () => {
    expect(foldUsageEvents([{ type: 'user/message', data: {} }])).toBeNull()
  })

  it('sums distinct steps (shadowed/compacted requests included, since the log is complete)', () => {
    const total = foldUsageEvents([
      msg(1, 0, { inputTokens: 10, cacheReadTokens: 90, outputTokens: 5 }),
      msg(1, 1, { inputTokens: 20, cacheReadTokens: 80, outputTokens: 6 }),
      msg(2, 0, { inputTokens: 30, cacheReadTokens: 70, outputTokens: 7 }),
    ])
    expect(total).toEqual({ uncachedInput: 60, cacheRead: 240, cacheWrite: 0, output: 18 })
  })

  it('a usage chunk is an early sample the final message replaces, never a double count', () => {
    const total = foldUsageEvents([
      chunk(1, 0, { inputTokens: 1, cacheReadTokens: 2, outputTokens: 3 }),
      msg(1, 0, { inputTokens: 10, cacheReadTokens: 90, outputTokens: 5, reasoningTokens: 4 }),
    ])
    expect(total).toEqual({ uncachedInput: 10, cacheRead: 90, cacheWrite: 0, output: 5, reasoning: 4 })
  })

  it('ignores non-usage chunks and usage-less messages', () => {
    const total = foldUsageEvents([
      { type: 'assistant/chunk', data: { turn: 1, step: 0, chunk: { type: 'text', text: 'hi' } } },
      { type: 'assistant/message', data: { turn: 1, step: 0 } },
      msg(1, 1, { inputTokens: 5, outputTokens: 1 }),
    ])
    expect(total).toEqual({ uncachedInput: 5, cacheRead: 0, cacheWrite: 0, output: 1 })
  })
})

describe('lastRequestUsage', () => {
  it('returns the newest assistant message usage from the log tail', () => {
    const last = lastRequestUsage([
      msg(1, 0, { inputTokens: 1, outputTokens: 1 }),
      msg(1, 1, { inputTokens: 2, cacheReadTokens: 8, outputTokens: 2 }),
      { type: 'user/message', data: {} },
    ])
    expect(last).toEqual({ uncachedInput: 2, cacheRead: 8, cacheWrite: 0, output: 2 })
  })

  it('skips usage-less messages and returns null when none report usage', () => {
    expect(lastRequestUsage([{ type: 'assistant/message', data: { turn: 1, step: 0 } }])).toBeNull()
  })
})
