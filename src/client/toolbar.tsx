/**
 * Toolbar family: the main toolbar (KPIs left; buttons tiered right —
 * primary mode switch, normal refresh, subtle overflow cluster, and the
 * danger Reset isolated behind a separator), the minimized bar, and the pager.
 */
import type { Shared } from './shared'
import { fmtNum } from './labels'
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

export function Toolbar({ sh, h }: { sh: Shared; h: ToolbarHandlers }) {
  const t = sh.t
  const sum = sh.state.summary
  return (
    <div className="ctm-sticky">
      <div className="ctm-summary">
        <div className="ctm-kpis">
          <div className="ctm-kpi"><span className="k">{t('totalTokens')}</span><span className="v">{fmtNum(sum?.inputTokens)}</span></div>
          <div className="ctm-kpi"><span className="k">{t('cacheHit')}</span><span className="v">{fmtNum(sum?.cachedTokens)}</span></div>
          <div className="ctm-kpi"><span className="k">{t('outputTokens')}</span><span className="v">{fmtNum(sum?.outputTokens)}</span></div>
          <div className="ctm-kpi"><span className="k">{t('reasoningTokens')}</span><span className="v">{fmtNum(sum?.reasoningTokens)}</span></div>
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
  const sum = sh.state.summary
  return (
    <div className="ctm-wrap">
      <div className="ctm-minbar">
        <button type="button" className="ctm-btn" onClick={onExpand}>{'▴ ' + t('expandView')}</button>
        <span className="ctm-hint">{`Context · ${t('totalTokens')} ${fmtNum(sum?.inputTokens)} · ${t('cacheHit')} ${fmtNum(sum?.cachedTokens)}`}</span>
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
