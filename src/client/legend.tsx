/** Legend popover: explains the color/icon semantics of badges and cards. */
import type { Shared } from './shared'

interface LegendItem { dot: 'success' | 'warn' | 'error' | 'business' | 'neutral'; term: string; txt: string }

export function Legend({ sh }: { sh: Shared }) {
  const t = sh.t
  const items: LegendItem[] = [
    { dot: 'success', term: t('effEffective'), txt: t('legEffective') },
    { dot: 'warn', term: t('effRedundant'), txt: t('legRedundant') },
    { dot: 'error', term: t('effStale'), txt: t('legStale') },
    { dot: 'neutral', term: t('effInjected'), txt: t('legInjected') },
    { dot: 'neutral', term: t('cacheHitLabel'), txt: t('legCacheHit') },
    { dot: 'neutral', term: t('cacheMissLabel'), txt: t('legCacheMiss') },
    { dot: 'business', term: t('replace'), txt: t('legReplace') },
    { dot: 'error', term: t('delete'), txt: t('legDelete') },
    { dot: 'warn', term: `${t('markStale')} / ${t('markEffective')}`, txt: t('legMark') },
  ]
  return (
    <div className="ctm-legend-wrap" onMouseEnter={() => sh.setLegendHover(true)} onMouseLeave={() => sh.setLegendHover(false)}>
      <button type="button" className="ctm-btn subtle">{t('legend')}</button>
      {sh.legendHover && (
        <div className="ctm-legend-pop">
          <h4>{t('legTitle')}</h4>
          {items.map((it, i) => (
            <div key={i} className="ctm-legend-row">
              <span className={`ctm-dot ${it.dot}`} />
              <span><strong>{it.term}</strong> — {it.txt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
