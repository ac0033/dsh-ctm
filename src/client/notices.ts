/**
 * Notice rendering: map a structured host notice ({kind, code, params}) to a
 * localized string. Codes with placeholders resolve to templates carrying
 * `{name}` slots; static codes resolve to plain dictionary keys; an unknown
 * code falls back to displaying the code itself.
 */
import type { CtmNotice } from '../contract'
import type { CtmKey } from './locales'
import { effLabel, type TFunc } from './labels'

/** Codes whose dictionary template carries `{placeholder}` slots. */
const PARAM_TEMPLATES: Record<string, CtmKey> = {
  replaced: 'noticeReplaced',
  replaced_queued: 'noticeReplacedQueued',
  rolled_back: 'noticeRolledBack',
  rollback_queued: 'noticeRollbackQueued',
  deleted: 'noticeDeleted',
  realtime_on_queued: 'noticeRealtimeQueued',
}

/** Codes that map 1:1 onto a plain dictionary entry. */
const STATIC_KEYS: Record<string, CtmKey> = {
  segment_not_found: 'segNotFound', cannot_replace_system: 'cannotReplaceSystem', tool_readonly: 'toolReadonly',
  invalid_turn: 'invalidTurn', snapshot_not_found: 'snapshotNotFound', restored: 'restored', reset: 'resetDone',
  cannot_delete_system: 'cannotDeleteSystem', cannot_delete_current_user: 'cannotDeleteUser', nothing_to_delete: 'nothingDelete',
  nothing_to_undo: 'nothingUndo', undone: 'undoneNotice', override_cleared: 'overrideCleared', invalid_effectiveness: 'invalidEff',
  realtime_on: 'realtimeOnNotice', realtime_off: 'realtimeOffNotice',
  deleted_queued: 'deletedQueued', replaced_system: 'replacedSystem', session_not_live: 'sessionNotLive',
  segment_gone: 'segmentGone', unbalanced_edit: 'unbalancedEdit', tool_result_changed: 'toolResultChanged',
  invalid_template: 'invalidTemplate', undone_queued: 'undoneQueued', undo_unavailable: 'undoUnavailable',
}

function renderTemplate(tpl: string, params: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (slot, name: string) => (params[name] !== undefined ? String(params[name]) : slot))
}

export function noticeText(notice: CtmNotice, t: TFunc): string {
  const code = notice.code
  // The override value is itself an effectiveness code; localize it before
  // it lands in the template's {value} slot.
  if (code === 'override_set') {
    const value = notice.params?.value
    return renderTemplate(t('noticeOverride'), { value: value === undefined ? '' : effLabel(t, String(value)) })
  }
  const tplKey = PARAM_TEMPLATES[code]
  if (tplKey !== undefined) return renderTemplate(t(tplKey), notice.params ?? {})
  const staticKey = STATIC_KEYS[code]
  if (staticKey !== undefined) return t(staticKey)
  return code
}
