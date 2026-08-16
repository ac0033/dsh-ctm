/** Modal dialogs: the destructive-action confirm modal and the replace editor. */
import type { Shared } from './shared'

export interface ConfirmOp { name: string; args: Record<string, unknown> }

function opInfo(sh: Shared, name: string): { title: string; impact: string; risk: string } {
  const t = sh.t
  const zhL = sh.lang === 'zh'
  const realtime = sh.state.realtime
  if (name === 'replace') return { title: t('replace'), impact: zhL ? '只修改该片段的正文内容；该片段及其后所有片段的缓存标记都会失效（前缀缓存断裂）。' : "Only edits this segment's text; it and every later segment lose their cache mark (prefix break).", risk: zhL ? (realtime ? '「真实生效」已开启：替换会在模型下一步推理时写入会话日志后生效（期间标记「待生效」）。' : '当前「真实生效」关闭：仅修改视图，不改变模型真实收到的内容。') : (realtime ? 'Apply-for-real is ON: the replacement is written to the session log at the model\'s next step (shown as "pending" until then).' : 'Apply-for-real is OFF: view-only; the model still receives the original content.') }
  if (name === 'delete') return { title: t('delete'), impact: zhL ? '把该片段软删除（进回收站，本会话可撤销）；turn_index 保留空洞；缓存预测重算。' : 'Soft-deletes the segment (to trash, undoable this session); turn_index keeps its hole; cache prediction recalculates.', risk: zhL ? (realtime ? '「真实生效」已开启：该片段将在模型下一步推理时被一条占位标记替换并写入会话日志（replay 与 token 计量自动一致）。' : '当前「真实生效」关闭：仅从视图移除，不改变模型真实收到的内容。') : (realtime ? 'Apply-for-real is ON: at the model\'s next step the segment is replaced by a placeholder marker, written to the session log (replay and token accounting stay consistent).' : 'Apply-for-real is OFF: view-only; the model still receives this segment.') }
  if (name === 'rollback') return { title: t('rollback'), impact: zhL ? '把该轮次之后的所有片段标记为 stale（保留不删除），并生成一个快照。' : 'Marks every later segment stale (kept, not deleted) and creates a snapshot.', risk: zhL ? (realtime ? '「真实生效」已开启：回退区间将在下一步被单条占位标记替换并写入会话日志；原始内容仍留在日志的 transcript 里。' : '这些片段会进入「已回退」折叠区，可随时前滚恢复。') : (realtime ? 'Apply-for-real is ON: the rolled-back range is replaced by one placeholder marker at the next step and logged; the originals stay in the log transcript.' : 'They move to the rolled-back folded area; you can roll forward anytime.') }
  if (name === 'override') return { title: `${t('markStale')} / ${t('markEffective')}`, impact: zhL ? '仅手动覆盖该片段的有效性标记（影响颜色与建议），不改变内容。' : 'Only overrides the effectiveness label (color/suggestion); content unchanged.', risk: zhL ? '无风险（纯标注，可再次点击取消覆盖）。' : 'No risk (label only; click again to clear).' }
  if (name === 'reset') return { title: t('reset'), impact: zhL ? '清空所有编辑（替换/删除/回退/快照），回到最新实时上下文。' : 'Clears all edits (replace/delete/rollback/snapshots) and returns to the latest live context.', risk: zhL ? '不可撤销——之前的编辑会全部丢失。' : 'Irreversible — all prior edits are lost.' }
  if (name === 'restore') return { title: t('restore'), impact: zhL ? '恢复到该快照保存时的上下文（逐字节一致），并清除此后的编辑。' : 'Restores the context exactly as saved in that snapshot; clears later edits.', risk: zhL ? '快照之后的编辑会丢失。' : 'Edits made after the snapshot are lost.' }
  if (name === 'undo') return { title: t('undo'), impact: zhL ? '撤销最近一次操作：还未生效的排队编辑直接移除；已写入日志的编辑会在模型下一步以一条反向修改还原。仅支持撤销最近一组操作。' : 'Undoes the most recent operation: a queued (not yet applied) edit is simply removed; an already-logged edit is reversed by a counter-edit at the model\'s next step. Only the latest operation can be undone.', risk: zhL ? '无风险。' : 'No risk.' }
  if (name === 'setRealtime') return { title: t('realtime'), impact: zhL ? '开启后，替换/删除/回退会在模型下一步推理时写入会话日志并真正生效（真正节省 token）；已做的视图编辑会一并入队。' : 'When ON, replace/delete/rollback are written to the session log at the model\'s next step and truly take effect (really saves tokens); pending view edits are queued too.', risk: zhL ? '写入日志的编辑不可抹除，只能再写一条反向修改还原；replay 与 token 计量始终与模型实际所见一致。' : 'A logged edit cannot be erased, only reversed by a counter-edit; replay and token accounting always match what the model actually saw.' }
  return { title: t('confirmTitle'), impact: '', risk: '' }
}

export function ConfirmModal({ sh, op, onClose, onExec }: { sh: Shared; op: ConfirmOp; onClose: () => void; onExec: (name: string, args: Record<string, unknown>) => void }) {
  const t = sh.t
  const info = opInfo(sh, op.name)
  return (
    <div className="ctm-modal-overlay" onClick={onClose}>
      <div className="ctm-modal" onClick={e => e.stopPropagation()}>
        <div className="ctm-node-title">{`${t('confirmTitle')}：${info.title}`}</div>
        <div className="ctm-modal-row"><b>{t('impact')}</b>{info.impact}</div>
        <div className="ctm-modal-row"><b>{t('risk')}</b>{info.risk}</div>
        <div className="ctm-actions">
          <button type="button" className="ctm-btn danger" disabled={sh.busy} onClick={() => { onClose(); onExec(op.name, op.args) }}>{t('confirm')}</button>
          <button type="button" className="ctm-btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

export function Editor({ sh }: { sh: Shared }) {
  const editing = sh.editing
  if (!editing) return null
  const t = sh.t
  return (
    <div className="ctm-editor">
      <div className="ctm-node-title">{`${t('replace')} · ${editing.role} #${editing.turnIndex}`}</div>
      <textarea className="ctm-textarea" value={editing.text} onChange={e => sh.setEditing({ ...editing, text: e.target.value })} />
      <div className="ctm-actions">
        <button type="button" className="ctm-btn primary" disabled={sh.busy} onClick={() => sh.askConfirm('replace', { segmentId: editing.id, content: editing.text })}>{t('save')}</button>
        <button type="button" className="ctm-btn" disabled={sh.busy} onClick={() => sh.setEditing(null)}>{t('cancel')}</button>
      </div>
    </div>
  )
}
