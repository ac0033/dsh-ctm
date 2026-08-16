import { describe, it, expect } from 'vitest'
import { BIGRAM_CACHE_CAP, bigramsOf, createBigramCache, jaccardSimilarity } from '../src/bigrams'

describe('bigramsOf', () => {
  it('collects every consecutive character pair', () => {
    expect([...bigramsOf('abcd')].sort()).toEqual(['ab', 'bc', 'cd'])
  })

  it('is empty for strings shorter than two characters', () => {
    expect(bigramsOf('').size).toBe(0)
    expect(bigramsOf('x').size).toBe(0)
  })

  it('deduplicates repeated pairs', () => {
    expect(bigramsOf('abab').size).toBe(2)
  })
})

describe('jaccardSimilarity', () => {
  it('is 1 for identical non-empty sets and 0 for disjoint sets', () => {
    const a = bigramsOf('the quick brown fox')
    expect(jaccardSimilarity(a, bigramsOf('the quick brown fox'))).toBe(1)
    expect(jaccardSimilarity(bigramsOf('aaaa'), bigramsOf('bbbb'))).toBe(0)
  })

  it('defines empty/empty as 0 (nothing to compare)', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0)
    expect(jaccardSimilarity(new Set(), bigramsOf('ab'))).toBe(0)
  })
})

describe('createBigramCache', () => {
  it('returns the identical Set instance on a repeat get (no rebuild)', () => {
    const cache = createBigramCache()
    const first = cache.get('some content string')
    expect(cache.get('some content string')).toBe(first)
  })

  it('evicts the least-recently-used entry beyond the cap', () => {
    const cache = createBigramCache(3)
    const aFirst = cache.get('a')
    cache.get('b')
    cache.get('c')
    cache.get('d') // evicts 'a'
    expect(cache.size).toBe(3)
    const d = cache.get('d')
    expect(cache.get('d')).toBe(d) // still cached
    // 'a' was evicted: getting it again builds a fresh Set instance.
    expect(cache.get('a')).not.toBe(aFirst)
  })

  it('a get refreshes recency, so the touched entry survives the next eviction', () => {
    const cache = createBigramCache(2)
    const a = cache.get('a')
    cache.get('b')
    expect(cache.get('a')).toBe(a) // touch 'a'; 'b' is now the coldest
    cache.get('c') // evicts 'b', keeps 'a'
    expect(cache.get('a')).toBe(a)
    expect(cache.size).toBe(2)
  })

  it('defaults to the documented cap', () => {
    expect(BIGRAM_CACHE_CAP).toBe(500)
    const cache = createBigramCache()
    for (let i = 0; i < BIGRAM_CACHE_CAP + 10; i++) cache.get('content-' + i)
    expect(cache.size).toBe(BIGRAM_CACHE_CAP)
  })
})
