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
      inputTokens: 100, cachedTokens: 80, outputTokens: 10, reasoningTokens: 5,
      inputTokensActual: true, segmentCount: 1, activeCount: 1, rolledBackCount: 0,
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
