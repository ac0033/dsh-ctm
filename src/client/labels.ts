/** Localized label/tooltip helpers shared by the extracted view components. */
import type { CtmSegment } from '../contract'
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

export const fmtNum = (n: number | null | undefined): string => (n == null ? '—' : String(n))

export const sourceKindLabel = (t: TFunc, seg: CtmSegment): string => {
  if (seg.source === 'system_inject') {
    if (seg.sourceKind === 'system') return t('initialSystemPrompt')
    if (seg.sourceKind === 'skill-catalog') return t('skillCatalog')
    if (seg.sourceKind === 'approval-policy') return t('approvalPolicy')
    return t('systemPromptSection')
  }
  return roleLabel(t, seg.role)
}
