/**
 * Segment card: one context segment. The visual hierarchy is deliberately
 * single-dimension — effectiveness owns the color channel (3px left bar +
 * colored badge), cache is a neutral badge with a ✓/✗ glyph, and the action
 * buttons stay subtle so they never compete with the content.
 */
import type { CtmSegment } from '../contract'
import type { Shared } from './shared'
import { renderMarkdown } from './markdown'
import { roleLabel, cacheLabel, effLabel, cacheTip, effTip, fmtTime } from './labels'
import { unescapeText } from './text'

/** Characters of segment content shown before the fold; a deliberate tuning
 *  point (no config wiring) — adjust here, rebuild. */
const CONTENT_FOLD_CHARS = 240

function SegmentContent({ seg, sh }: { seg: CtmSegment; sh: Shared }) {
  // Raw text, never unescapeText: real prose can contain literal backslash
  // sequences (regexes, Windows paths) that unescaping would silently corrupt.
  const raw = seg.content
  const long = raw.length > CONTENT_FOLD_CHARS
  const open = sh.isOpen('content', seg.id)
  const show = long ? (open ? raw : raw.slice(0, CONTENT_FOLD_CHARS) + '…') : raw
  return (
    <div>
      <div className={`ctm-content${long && !open ? ' trunc' : ''}`}>{renderMarkdown(show)}</div>
      {long && <button type="button" className="ctm-btn subtle" onClick={() => sh.toggle('content', seg.id)}>{open ? sh.t('collapse') : sh.t('expand')}</button>}
    </div>
  )
}

function ToolCalls({ seg, sh }: { seg: CtmSegment; sh: Shared }) {
  if (!seg.toolCalls?.length) return null
  const open = sh.isOpen('tools', seg.id)
  return (
    <div className="ctm-tools">
      <button type="button" className="ctm-btn subtle" onClick={() => sh.toggle('tools', seg.id)}>{(open ? sh.t('collapse') : sh.t('expand')) + ' ' + seg.toolCalls.length + ' ' + sh.t('toolCalls')}</button>
      {open && seg.toolCalls.map((tc, i) => (
        <div key={i} className="ctm-toolitem">{'▸ ' + (tc.name ?? '') + '\n' + unescapeText(String(tc.arguments ?? ''))}</div>
      ))}
    </div>
  )
}

export function SegmentCard({ seg, sh }: { seg: CtmSegment; sh: Shared }) {
  const t = sh.t
  const isSystem = seg.source === 'system_inject'
  const isUserInput = seg.role === 'user' && seg.source === 'user_input'
  const isEditing = sh.editing?.id === seg.id
  const eff = seg.effectiveness || 'effective'
  const thinkOpen = sh.isOpen('think', seg.id)

  // One muted meta line replaces the old 4-row dl table; badges sit inline.
  const meta = [
    roleLabel(t, seg.role),
    seg.turn != null ? `${t('turn')} ${seg.turn}${seg.step != null ? '.' + seg.step : ''}` : null,
    `#${seg.turn_index}`,
    fmtTime(seg.created_at),
    seg.edited ? t('edited') : null,
  ].filter(Boolean).join(' · ')
  // Double encoding beyond hue: redundant carries ≈, strong-stale carries ⚠.
  const effPrefix = seg.strongStale ? '⚠ ' : eff === 'redundant' ? '≈ ' : ''

  const body = isEditing ? (
    <div className="ctm-hint">{t('editing')}…</div>
  ) : (
    <div>
      <SegmentContent seg={seg} sh={sh} />
      {seg.reasoning && seg.role === 'assistant' && (
        <div>
          <button type="button" className="ctm-btn subtle" onClick={() => sh.toggle('think', seg.id)}>{(thinkOpen ? t('collapse') : t('expand')) + ' ' + t('thinking')}</button>
          {thinkOpen && <div className="ctm-thinking">{seg.reasoning}</div>}
        </div>
      )}
      <ToolCalls seg={seg} sh={sh} />
      <div className="ctm-actions">
        {!isSystem && seg.role !== 'tool' && <button type="button" className="ctm-btn subtle" disabled={sh.busy} onClick={() => sh.setEditing({ id: seg.id, text: seg.content, role: roleLabel(t, seg.role), turnIndex: seg.turn_index })}>{t('replace')}</button>}
        {seg.id === 'seg-system' && <button type="button" className="ctm-btn subtle" disabled={sh.busy} onClick={() => sh.setEditing({ id: seg.id, text: seg.content, role: roleLabel(t, seg.role), turnIndex: seg.turn_index })}>{t('replace')}</button>}
        {!isSystem && <button type="button" className="ctm-btn subtle danger" disabled={sh.busy} onClick={() => sh.askConfirm('delete', { segmentId: seg.id })}>{t('delete')}</button>}
        {isUserInput && <button type="button" className="ctm-btn subtle" title={t('rollbackTip')} disabled={sh.busy} onClick={() => sh.askConfirm('rollback', { turnIndex: seg.turn_index })}>{t('rollback')}</button>}
        {!isSystem && <button type="button" className="ctm-btn subtle" disabled={sh.busy} onClick={() => sh.askConfirm('override', { segmentId: seg.id, value: seg.effectiveness === 'effective' ? 'stale' : 'effective' })}>{seg.effectiveness === 'effective' ? t('markStale') : t('markEffective')}</button>}
      </div>
    </div>
  )

  return (
    <div className={`ctm-card eff-${eff}`}>
      <div className="ctm-meta">
        <span>{meta}</span>
        <span className="ctm-badge cache" title={cacheTip(t, seg.cache_status)}>{cacheLabel(t, seg.cache_status)}</span>
        <span className={`ctm-badge eff-${eff}`} title={effTip(t, eff)}>{effPrefix + effLabel(t, eff)}</span>
        {seg.pending && <span className="ctm-badge pending" title={t('pendingTip')}>{t('pending')}</span>}
      </div>
      {body}
    </div>
  )
}
