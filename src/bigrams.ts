/**
 * 2-gram (bigram) set similarity behind a small LRU cache.
 *
 * The effectiveness engine compares every older tool result against every
 * other segment on each state read; building the bigram sets is the dominant
 * cost. A set is a pure function of the content string, so caching it by
 * content is always correct, and repeated reads (the common case: one new
 * segment, everything else unchanged) skip all rebuilding. Kept free of
 * cordis state so it can be unit-tested directly.
 */

/** Upper bound of cached bigram sets; least-recently-used entries are evicted beyond it. */
export const BIGRAM_CACHE_CAP = 500

/** The set of consecutive character pairs of one content string. */
export function bigramsOf(content: string): Set<string> {
  const set = new Set<string>()
  for (let k = 0; k < content.length - 1; k++) set.add(content.slice(k, k + 2))
  return set
}

export interface BigramCache {
  get(content: string): Set<string>
  readonly size: number
}

/** LRU cache over bigram sets, keyed by content string (Map insertion order doubles as recency). */
export function createBigramCache(cap: number = BIGRAM_CACHE_CAP): BigramCache {
  const map = new Map<string, Set<string>>()
  return {
    get(content: string): Set<string> {
      const hit = map.get(content)
      if (hit !== undefined) {
        map.delete(content)
        map.set(content, hit)
        return hit
      }
      const built = bigramsOf(content)
      map.set(content, built)
      if (map.size > cap) {
        const oldest = map.keys().next()
        if (!oldest.done) map.delete(oldest.value)
      }
      return built
    },
    get size() {
      return map.size
    },
  }
}

/** Jaccard similarity of two bigram sets; empty/empty is defined as 0 (nothing to compare). */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size + b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}
