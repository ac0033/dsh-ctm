/** Localized label/tooltip helpers shared by the extracted view components. */
import type { CtmSegment, CtmUsageTotals } from '../contract'
import { billedInput, cacheHitRate } from '../usage'
import type { CtmKey } from './locales'

export type TFunc = (k: CtmKey) => string

export const roleLabel = (t: TFunc, role: string): string =>
  role === 'system' ? t('roleSystem') : role === 'user' ? t('roleUser') : role === 'assistant' ? t('roleAssistant') : role === 'tool' ? t('roleTool') : role

export const cacheLabel = (t: TFunc, cs: string): string =>
  cs === 'hit' ? t('cacheHitLabel') : cs === 'miss' ? t('cacheMissLabel') : cs === 'partial' ? t('cachePartial') : t('cacheUnknown')

export const effLabel = (t: TFunc, eff: string): string =>
  eff === 'effective' ? t('effEffective') : eff === 'redundant' ? t('effRedundant') : eff === 'stale' ? t('effStale') : eff === 'injected' ? t('effInjected') : eff

export const cacheTip = (t: TFunc, cs: string): string =>
  cs === 'hit' ? t('tipCacheHit') : cs === 'miss' ? t('tipCacheMiss') : cs === 'partial' ? t('tipCachePartial') : ''

export const effTip = (t: TFunc, eff: string): string =>
  eff === 'effective' ? t('tipEffective') : eff === 'redundant' ? t('tipRedundant') : eff === 'stale' ? t('tipStale') : eff === 'injected' ? t('tipInjected') : ''

export const fmtTime = (tm: number): string => (tm ? new Date(tm).toLocaleTimeString() : '')

/** Fill `{key}` slots in a locale template (same convention as host notices). */
export const tpl = (s: string, params: Record<string, string | number>): string =>
  s.replace(/\{(\w+)\}/g, (slot, name) => (params[name] !== undefined ? String(params[name]) : slot))

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three
 * digits) — the same rounding the webUI StatsLine uses.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

export const fmtTokens = (n: number | null | undefined): string => (n == null ? '—' : formatTokens(n))

/** Cache-hit rate as a display string; '—' until anything was billed. */
export const fmtHitRate = (totals: CtmUsageTotals | null | undefined): string => {
  if (totals == null) return '—'
  const rate = cacheHitRate(totals)
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

/**
 * One compact usage line over MECE totals, e.g. zh "输入 12.3K · 命中 91% ·
 * 输出 1.2K" / en "12.3K in · 91% hit · 1.2K out". The hit segment drops out
 * when nothing was billed or the caller passes `withHit: false`.
 */
export function usageLine(t: TFunc, totals: CtmUsageTotals, withHit: boolean): string {
  const parts = [tpl(t('usageIn'), { n: formatTokens(billedInput(totals)) })]
  if (withHit) {
    const rate = cacheHitRate(totals)
    if (rate !== null) parts.push(tpl(t('usageHit'), { n: `${Math.round(rate * 100)}%` }))
  }
  parts.push(tpl(t('usageOut'), { n: formatTokens(totals.output) }))
  return parts.join(' · ')
}

export const sourceKindLabel = (t: TFunc, seg: CtmSegment): string => {
  if (seg.source === 'system_inject') {
    if (seg.sourceKind === 'system') return t('initialSystemPrompt')
    if (seg.sourceKind === 'skill-catalog') return t('skillCatalog')
    if (seg.sourceKind === 'approval-policy') return t('approvalPolicy')
    return t('systemPromptSection')
  }
  return roleLabel(t, seg.role)
}
