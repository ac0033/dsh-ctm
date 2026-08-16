/**
 * Toolbar family: the main toolbar (KPIs left; buttons tiered right —
 * primary mode switch, normal refresh, subtle overflow cluster, and the
 * danger Reset isolated behind a separator), the minimized bar, and the pager.
 *
 * KPI vocabulary is MECE: uncached input / cache read / output, with cache
 * write shown only when a provider reports it, plus the derived cache-hit
 * rate and the model. Every figure is provider-measured and cumulative over
 * the complete session log; each KPI's tooltip states that basis, the data
 * source (projection or event fold), the most recent request's prompt total,
 * and the context-window occupancy when the host can read it.
 */
import type { CtmSummary } from '../contract'
import type { Shared } from './shared'
import { billedInput } from '../usage'
import { fmtHitRate, formatTokens, tpl } from './labels'
import { Legend } from './legend'

export interface ToolbarHandlers {
  onRefresh: () => void
  onToggleRealtime: () => void
  onReset: () => void
  onToggleSnapshots: () => void
  onToggleTrash: () => void
  onMinimize: () => void
  onToggleLang: () => void
}

/** Tooltip tail every usage KPI shares: source, last request, window occupancy. */
function usageNotes(sh: Shared, sum: CtmSummary): string[] {
  const t = sh.t
  const notes = [
    sum.usageSource === 'projection' ? t('sourceProjection')
      : sum.usageSource === 'events' ? t('sourceEvents')
        : t('noUsageYet'),
  ]
  if (sum.lastRequest) notes.push(tpl(t('lastRequestPrompt'), { n: formatTokens(billedInput(sum.lastRequest)) }))
  if (sum.pressure) {
    notes.push(tpl(t('pressureTip'), {
      p: Math.min(100, Math.round(sum.pressure.tokens / sum.pressure.contextWindow * 100)),
      t: formatTokens(sum.pressure.tokens),
      w: formatTokens(sum.pressure.contextWindow),
    }))
  }
  return notes
}

export function Toolbar({ sh, h }: { sh: Shared; h: ToolbarHandlers }) {
  const t = sh.t
  const sum = sh.state.summary
  const total = sum?.total ?? null
  // Mirror the webUI StatsLine gate: a session whose requests never billed
  // shows dashes instead of a zero-token row.
  const active = total !== null && (billedInput(total) > 0 || total.output > 0)
  // Non-null alias so JSX branches narrow without re-checking `active`.
  const shown = active ? total : null
  const tip = (base: string): string => (sum ? [base, ...usageNotes(sh, sum)].join('\n') : base)
  const outputTip = shown !== null && shown.reasoning !== undefined
    ? t('tipOutputKpi') + '\n' + tpl(t('reasoningIncluded'), { n: formatTokens(shown.reasoning) })
    : t('tipOutputKpi')
  return (
    <div className="ctm-sticky">
      <div className="ctm-summary">
        <div className="ctm-kpis">
          <div className="ctm-kpi" title={tip(t('tipUncachedInput'))}><span className="k">{t('uncachedInput')}</span><span className="v">{shown ? formatTokens(shown.uncachedInput) : '—'}</span></div>
          <div className="ctm-kpi" title={tip(t('tipCacheReadKpi'))}><span className="k">{t('cacheHit')}</span><span className="v">{shown ? formatTokens(shown.cacheRead) : '—'}</span></div>
          {shown !== null && shown.cacheWrite > 0 && <div className="ctm-kpi" title={tip(t('tipCacheWriteKpi'))}><span className="k">{t('cacheWrite')}</span><span className="v">{formatTokens(shown.cacheWrite)}</span></div>}
          <div className="ctm-kpi" title={tip(outputTip)}><span className="k">{t('outputTokens')}</span><span className="v">{shown ? formatTokens(shown.output) : '—'}</span></div>
          <div className="ctm-kpi" title={tip(t('tipCacheHitRate'))}><span className="k">{t('cacheHitRate')}</span><span className="v">{fmtHitRate(shown)}</span></div>
          {sum?.model && <div className="ctm-kpi"><span className="k">{t('model')}</span><span className="v"><small>{sum.model.provider + ' · ' + sum.model.model}</small></span></div>}
        </div>
        <span className="ctm-toolbar-spacer" />
        <button type="button" className={`ctm-btn ${sh.state.realtime ? 'realtime-on' : 'primary'}`} title={t('realtimeTip')} onClick={h.onToggleRealtime}>{`${t('realtime')}: ${sh.state.realtime ? t('realtimeOn') : t('realtimeOff')}`}</button>
        <button type="button" className="ctm-btn" title={t('refreshTip')} onClick={h.onRefresh}>{t('refresh')}</button>
        <span className="ctm-toolbar-group">
          <button type="button" className="ctm-btn subtle" title={t('snapshotsTip')} onClick={h.onToggleSnapshots}>{`${t('snapshots')}(${sh.state.snapshots.length})`}</button>
          <button type="button" className="ctm-btn subtle" title={t('trashTip')} onClick={h.onToggleTrash}>{`${t('trash')}(${sh.state.trash.length})`}</button>
          <Legend sh={sh} />
          <button type="button" className="ctm-btn subtle" onClick={h.onMinimize}>{'▾ ' + t('minimize')}</button>
          <button type="button" className="ctm-btn subtle" onClick={h.onToggleLang}>{t('lang')}</button>
        </span>
        <span className="ctm-toolbar-sep" />
        <button type="button" className="ctm-btn danger" title={t('resetTip')} onClick={h.onReset}>{t('reset')}</button>
      </div>
    </div>
  )
}

export function MinBar({ sh, onExpand, onToggleLang }: { sh: Shared; onExpand: () => void; onToggleLang: () => void }) {
  const t = sh.t
  const total = sh.state.summary?.total ?? null
  return (
    <div className="ctm-wrap">
      <div className="ctm-minbar">
        <button type="button" className="ctm-btn" onClick={onExpand}>{'▴ ' + t('expandView')}</button>
        <span className="ctm-hint">{`Context · ${t('totalTokens')} ${total ? formatTokens(billedInput(total)) : '—'} · ${t('cacheHitRate')} ${fmtHitRate(total)}`}</span>
        <Legend sh={sh} />
        <button type="button" className="ctm-btn subtle" onClick={onToggleLang}>{t('lang')}</button>
      </div>
    </div>
  )
}

export function Pager({ sh, page, totalPages, onPage }: { sh: Shared; page: number; totalPages: number; onPage: (f: (p: number) => number) => void }) {
  const t = sh.t
  if (totalPages <= 1) return null
  return (
    <div className="ctm-pager">
      <button type="button" className="ctm-btn" disabled={page === 0} onClick={() => onPage(p => Math.max(0, p - 1))}>{t('prevPage')}</button>
      <span className="ctm-hint">{`${t('page')} ${page + 1} ${t('of')} ${totalPages}`}</span>
      <button type="button" className="ctm-btn" disabled={page >= totalPages - 1} onClick={() => onPage(p => Math.min(totalPages - 1, p + 1))}>{t('nextPage')}</button>
    </div>
  )
}
