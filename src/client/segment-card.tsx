/**
 * Segment card: one context segment. The visual hierarchy is deliberately
 * single-dimension — effectiveness owns the color channel (3px left bar +
 * colored badge), cache is a neutral badge with a ✓/✗ glyph, and the action
 * buttons stay subtle so they never compete with the content.
 */
import { useState } from 'react'
import type { CtmSegment } from '../contract'
import type { Shared } from './shared'
import { renderMarkdown } from './markdown'
import { roleLabel, cacheLabel, effLabel, cacheTip, effTip, fmtTime, formatTokens } from './labels'
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
  // CTM's own placeholder markers are user-role but read-only: no replace /
  // delete / rollback / effectiveness overrides on them.
  const isReadOnly = isSystem || seg.protected === true
  const isUserInput = seg.role === 'user' && seg.source === 'user_input'
  const isEditing = sh.editing?.id === seg.id
  // Copy feedback is local and transient; clipboard failures degrade to no feedback.
  const [copied, setCopied] = useState(false)
  const copyContent = () => {
    void navigator.clipboard?.writeText(seg.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  const eff = seg.effectiveness || 'effective'
  const thinkOpen = sh.isOpen('think', seg.id)

  // One muted meta line replaces the old 4-row dl table; badges sit inline.
  // `#N` and the token count are separate spans because each carries its own
  // tooltip (interaction-order meaning; estimate disclaimer).
  const head = [
    roleLabel(t, seg.role),
    seg.turn != null ? `${t('turn')} ${seg.turn}${seg.step != null ? '.' + seg.step : ''}` : null,
  ].filter(Boolean).join(' · ')
  const time = fmtTime(seg.created_at)
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
        {/* Copy stays available on read-only segments: it is the manual path
            for re-sending a rolled-back message (the host chat UI owns the
            input box; a plugin cannot refill it). */}
        <button type="button" className="ctm-btn subtle" disabled={copied} onClick={copyContent}>{copied ? t('copied') : t('copy')}</button>
        {!isReadOnly && seg.role !== 'tool' && <button type="button" className="ctm-btn subtle" disabled={sh.busy} onClick={() => sh.setEditing({ id: seg.id, text: seg.content, role: roleLabel(t, seg.role), turnIndex: seg.turn_index })}>{t('replace')}</button>}
        {seg.id === 'seg-system' && <button type="button" className="ctm-btn subtle" disabled={sh.busy} onClick={() => sh.setEditing({ id: seg.id, text: seg.content, role: roleLabel(t, seg.role), turnIndex: seg.turn_index })}>{t('replace')}</button>}
        {!isReadOnly && <button type="button" className="ctm-btn subtle danger" disabled={sh.busy} onClick={() => sh.askConfirm('delete', { segmentId: seg.id })}>{t('delete')}</button>}
        {isUserInput && !seg.protected && <button type="button" className="ctm-btn subtle" title={t('rollbackTip')} disabled={sh.busy} onClick={() => sh.askConfirm('rollback', { turnIndex: seg.turn_index })}>{t('rollback')}</button>}
        {!isReadOnly && <button type="button" className="ctm-btn subtle" disabled={sh.busy} onClick={() => sh.askConfirm('override', { segmentId: seg.id, value: seg.effectiveness === 'effective' ? 'stale' : 'effective' })}>{seg.effectiveness === 'effective' ? t('markStale') : t('markEffective')}</button>}
      </div>
    </div>
  )

  return (
    <div className={`ctm-card eff-${eff}`}>
      <div className="ctm-meta">
        <span>{head}</span>
        <span title={seg.id === 'seg-system' ? t('seq0Tip') : t('seqTip')}>{`#${seg.turn_index}`}</span>
        {time && <span>{time}</span>}
        {seg.edited && <span>{t('edited')}</span>}
        <span title={t('estimatedTip')}>{`≈${formatTokens(seg.token_count)}`}</span>
        <span className="ctm-badge cache" title={cacheTip(t, seg.cache_status)}>{cacheLabel(t, seg.cache_status)}</span>
        <span className={`ctm-badge eff-${eff}`} title={effTip(t, eff)}>{effPrefix + effLabel(t, eff)}</span>
        {seg.pending && <span className="ctm-badge pending" title={t('pendingTip')}>{t('pending')}</span>}
      </div>
      {body}
    </div>
  )
}
