import { describe, it, expect } from 'vitest'
import { computeEffectiveness } from '../src/host'
import type { CtmEffectiveness, CtmSegment } from '../src/contract'

let nextId = 0
function seg(overrides: Partial<CtmSegment> = {}): CtmSegment {
  nextId += 1
  return {
    id: 'seg-' + nextId, seq: nextId, messageId: null, turn_index: nextId,
    role: 'assistant', source: 'model_output', sourceKind: null,
    content: 'content-' + nextId + '-' + 'x'.repeat(50), reasoning: '', text: '',
    toolCallId: null, token_count: 10, cache_status: 'unknown',
    effectiveness: 'effective', reason: '', strongStale: false,
    created_at: 0, parent_id: null, tags: [], protected: false,
    edited: false, deleted: false, rolledBack: false, turn: null, step: null,
    toolCalls: [], blockTypes: ['text'],
    ...overrides,
  }
}

const noOverrides = () => new Map<string, CtmEffectiveness>()

describe('computeEffectiveness', () => {
  it('marks system-injected segments as injected', () => {
    const segs = [seg({ source: 'system_inject', role: 'system' })]
    computeEffectiveness(segs, noOverrides())
    expect(segs[0]!.effectiveness).toBe('injected')
    expect(segs[0]!.reason).toBe('system_inject')
  })

  it('manual override beats every other rule', () => {
    const segs = [seg({ role: 'user', source: 'user_input' })]
    const overrides = new Map<string, CtmEffectiveness>([[segs[0]!.id, 'stale']])
    computeEffectiveness(segs, overrides)
    expect(segs[0]!.effectiveness).toBe('stale')
    expect(segs[0]!.reason).toBe('manual_override')
  })

  it('user and assistant segments are always effective', () => {
    const segs = [
      seg({ role: 'user', source: 'user_input' }),
      seg({ role: 'assistant', source: 'model_output' }),
    ]
    computeEffectiveness(segs, noOverrides())
    expect(segs.map(s => s.effectiveness)).toEqual(['effective', 'effective'])
  })

  it('tool results within the last 6 segments stay effective', () => {
    const segs = [seg({ role: 'tool', source: 'tool_call' }), seg(), seg(), seg()]
    computeEffectiveness(segs, noOverrides())
    expect(segs[0]!.effectiveness).toBe('effective')
    expect(segs[0]!.reason).toBe('recent_tool')
  })

  it('an old, dissimilar tool result goes stale (not strong without 3 assistants after)', () => {
    const segs = [
      seg({ role: 'tool', source: 'tool_call', content: 'unique tool output ' + 'q'.repeat(60) }),
      seg({ role: 'assistant' }), seg({ role: 'assistant' }),
      seg({ role: 'user', source: 'user_input' }), seg({ role: 'user', source: 'user_input' }),
      seg({ role: 'user', source: 'user_input' }), seg({ role: 'user', source: 'user_input' }),
    ]
    computeEffectiveness(segs, noOverrides())
    expect(segs[0]!.effectiveness).toBe('stale')
    expect(segs[0]!.reason).toBe('old_tool')
    expect(segs[0]!.strongStale).toBe(false)
  })

  it('an old tool result with 3+ assistant messages after it turns strong-stale', () => {
    const segs = [
      seg({ role: 'tool', source: 'tool_call', content: 'unique tool output ' + 'q'.repeat(60) }),
      seg({ role: 'assistant' }), seg({ role: 'assistant' }), seg({ role: 'assistant' }),
      seg({ role: 'assistant' }), seg({ role: 'assistant' }), seg({ role: 'assistant' }),
    ]
    computeEffectiveness(segs, noOverrides())
    expect(segs[0]!.effectiveness).toBe('stale')
    expect(segs[0]!.strongStale).toBe(true)
  })

  it('an old tool result nearly duplicating another segment is redundant', () => {
    const base = 'the quick brown fox jumps over the lazy dog '.repeat(20)
    const nearDup = base.slice(0, -1) + '!'
    const segs = [
      seg({ role: 'tool', source: 'tool_call', content: base }),
      seg({ role: 'tool', source: 'tool_call', content: nearDup }),
      seg({ role: 'assistant' }), seg({ role: 'assistant' }), seg({ role: 'assistant' }),
      seg({ role: 'assistant' }), seg({ role: 'assistant' }),
    ]
    computeEffectiveness(segs, noOverrides())
    expect(segs[0]!.effectiveness).toBe('redundant')
    expect(segs[0]!.reason).toBe('similar')
  })

  it('does not compare against system-injected segments when judging redundancy', () => {
    const base = 'repeated guardrail text '.repeat(30)
    const segs = [
      seg({ role: 'tool', source: 'tool_call', content: base }),
      seg({ role: 'system', source: 'system_inject', content: base }),
      seg({ role: 'assistant' }), seg({ role: 'assistant' }), seg({ role: 'assistant' }),
      seg({ role: 'assistant' }), seg({ role: 'assistant' }),
    ]
    computeEffectiveness(segs, noOverrides())
    expect(segs[0]!.effectiveness).toBe('stale')
  })
})
