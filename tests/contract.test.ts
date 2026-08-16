import { describe, it, expect } from 'vitest'
import {
  ctmRequestSchema,
  ctmResponseSchema,
  ctmStateSchema,
  type CtmRequest,
  type CtmSegment,
  type CtmState,
} from '../src/contract'

function makeSegment(overrides: Partial<CtmSegment> = {}): CtmSegment {
  return {
    id: 'seg-1', seq: 1, messageId: 'm1', turn_index: 1, role: 'user', source: 'user_input',
    sourceKind: null, content: 'hello', reasoning: '', text: 'hello', toolCallId: null,
    token_count: 2, cache_status: 'hit', effectiveness: 'effective', reason: 'user_input',
    strongStale: false, created_at: 1723000000000, parent_id: null, tags: [],
    protected: false, edited: false, deleted: false, rolledBack: false,
    turn: 1, step: 0, toolCalls: [], blockTypes: ['text'],
    ...overrides,
  }
}

function makeState(overrides: Partial<CtmState> = {}): CtmState {
  return {
    sessionId: 's1', version: 3, head: 'live', capturedThroughSeq: null, realtime: false,
    segments: [makeSegment()],
    summary: {
      total: { uncachedInput: 20, cacheRead: 80, cacheWrite: 0, output: 10, reasoning: 5 },
      lastRequest: { uncachedInput: 20, cacheRead: 80, cacheWrite: 0, output: 10 },
      usageSource: 'projection',
      pressure: { tokens: 100, contextWindow: 128000 },
      segmentCount: 1, activeCount: 1, rolledBackCount: 0,
      model: { provider: 'p', model: 'm' },
    },
    snapshots: [], trash: [], notice: null,
    ...overrides,
  }
}

describe('ctmRequestSchema round-trip', () => {
  const requests: CtmRequest[] = [
    { op: 'getState', sessionId: 's1' },
    { op: 'replace', sessionId: 's1', segmentId: 'seg-1', content: 'new text' },
    { op: 'delete', sessionId: 's1', segmentId: 'seg-1' },
    { op: 'rollback', sessionId: 's1', turnIndex: 2 },
    { op: 'restore', sessionId: 's1', snapshotId: 'snap-1' },
    { op: 'reset', sessionId: 's1' },
    { op: 'undo', sessionId: 's1' },
    { op: 'override', sessionId: 's1', segmentId: 'seg-1', value: 'stale' },
    { op: 'override', sessionId: 's1', segmentId: 'seg-1', value: null },
    { op: 'setRealtime', sessionId: 's1', enabled: true },
  ]

  it('every op survives a JSON round-trip', () => {
    for (const req of requests) {
      const parsed = ctmRequestSchema.parse(JSON.parse(JSON.stringify(req)))
      expect(parsed).toEqual(req)
    }
  })

  it('rejects an unknown op with a parse error (not a silent misroute)', () => {
    expect(() => ctmRequestSchema.parse({ op: 'explode', sessionId: 's1' })).toThrow()
  })

  it('rollback rejects NaN, fractional and negative turnIndex', () => {
    for (const turnIndex of [Number.NaN, 1.5, -1]) {
      expect(() => ctmRequestSchema.parse({ op: 'rollback', sessionId: 's1', turnIndex })).toThrow()
    }
  })
})

describe('ctmResponseSchema', () => {
  it('parses the ok envelope with a full state', () => {
    const parsed = ctmResponseSchema.parse({ ok: true, state: makeState() })
    expect(parsed.ok).toBe(true)
  })

  it('parses the error envelope', () => {
    const parsed = ctmResponseSchema.parse({ ok: false, error: 'boom' })
    expect(parsed).toEqual({ ok: false, error: 'boom' })
  })
})

describe('ctmStateSchema usage fields', () => {
  it('accepts a segment carrying provider usage and round-trips it', () => {
    const seg = makeSegment({
      role: 'assistant', source: 'model_output',
      usage: { input: 100, cacheRead: 2000, cacheWrite: 3, output: 50, reasoning: 20 },
    })
    const parsed = ctmStateSchema.parse(JSON.parse(JSON.stringify(makeState({ segments: [seg] }))))
    expect(parsed.segments[0]?.usage).toEqual({ input: 100, cacheRead: 2000, cacheWrite: 3, output: 50, reasoning: 20 })
  })

  it('accepts a segment without usage (non-assistant roles)', () => {
    const parsed = ctmStateSchema.parse(makeState())
    expect(parsed.segments[0]?.usage).toBeUndefined()
  })

  it('accepts empty usage read-outs (null totals, none source) and a missing pressure', () => {
    const parsed = ctmStateSchema.parse(makeState({
      summary: {
        total: null, lastRequest: null, usageSource: 'none',
        segmentCount: 1, activeCount: 1, rolledBackCount: 0, model: null,
      },
    }))
    expect(parsed.summary.usageSource).toBe('none')
    expect(parsed.summary.pressure).toBeUndefined()
  })

  it('rejects an unknown usageSource', () => {
    expect(() => ctmStateSchema.parse(makeState({
      summary: {
        total: null, lastRequest: null, usageSource: 'magic' as never,
        segmentCount: 1, activeCount: 1, rolledBackCount: 0, model: null,
      },
    }))).toThrow()
  })
})

describe('ctmStateSchema interceptError compatibility', () => {
  it('accepts a state without interceptError (older host)', () => {
    const parsed = ctmStateSchema.parse(makeState())
    expect(parsed.interceptError).toBeUndefined()
  })

  it('accepts a state carrying interceptError (newer host)', () => {
    const parsed = ctmStateSchema.parse(makeState({ interceptError: 'rewrite failed' }))
    expect(parsed.interceptError).toBe('rewrite failed')
  })

  it('accepts an explicit null interceptError', () => {
    const parsed = ctmStateSchema.parse(makeState({ interceptError: null }))
    expect(parsed.interceptError).toBeNull()
  })
})

describe('ctmNoticeSchema structured notices', () => {
  it('a notice with params survives a JSON round-trip', () => {
    const notice = { kind: 'ok', code: 'replaced', params: { later: 3 } } as const
    const parsed = ctmStateSchema.parse(JSON.parse(JSON.stringify(makeState({ notice }))))
    expect(parsed.notice).toEqual(notice)
  })

  it('params may mix string and number values', () => {
    const notice = { kind: 'ok', code: 'override_set', params: { value: 'stale', count: 2 } } as const
    const parsed = ctmStateSchema.parse(makeState({ notice }))
    expect(parsed.notice).toEqual(notice)
  })

  it('params is optional', () => {
    const parsed = ctmStateSchema.parse(makeState({ notice: { kind: 'warn', code: 'session_not_live' } }))
    expect(parsed.notice).toEqual({ kind: 'warn', code: 'session_not_live' })
  })

  it('rejects an unknown kind and non-scalar params', () => {
    expect(() => ctmStateSchema.parse(makeState({ notice: { kind: 'info', code: 'x' } as never }))).toThrow()
    expect(() => ctmStateSchema.parse(makeState({ notice: { kind: 'ok', code: 'x', params: { nested: {} } } as never }))).toThrow()
  })
})
