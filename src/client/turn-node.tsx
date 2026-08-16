/** Turn node + step section: the flowchart levels above the segment card. */
import type { StepGroup, TurnGroup } from './model'
import type { Shared } from './shared'
import { renderMarkdown } from './markdown'
import { roleLabel, sourceKindLabel, usageLine } from './labels'
import { sumSegmentUsage } from '../usage'
import { SegmentCard } from './segment-card'

function nodeSuggestion(sh: Shared, node: TurnGroup): string {
  const t = sh.t
  const zhL = sh.lang === 'zh'
  if (node.kind === 'system') return `**${t('suggestion')}：**\n- ${zhL ? '无需处理（系统注入内容不可删除，且模型每次推理都需要）。' : 'No action needed (system-injected content cannot be deleted and is needed every step).'}`
  if (node.kind === 'user') return `**${t('suggestion')}：**\n- ${zhL ? '保留（这是你的实际请求，模型依赖它才能回答）。' : 'Keep it (this is your actual request; the model needs it to answer).'}`
  const stale = node.segments.filter(s => s.effectiveness === 'stale').length
  const redundant = node.segments.filter(s => s.effectiveness === 'redundant').length
  const lines: string[] = []
  if (stale + redundant > 0) lines.push(`- ${zhL ? `该轮次有 ${stale} 条过期、${redundant} 条冗余片段，可删除以节省 Token（模型已不再使用这些内容）。` : `This turn has ${stale} stale and ${redundant} redundant segments; delete them to save tokens (the model no longer uses them).`}`)
  lines.push(`- ${zhL ? '其余「有效」片段请保留（是对话主线，删除会影响回答质量）。' : 'Keep the remaining effective segments (they are the conversation backbone; deleting them harms answer quality).'}`)
  return `**${t('suggestion')}：**\n${lines.join('\n')}`
}

function nodeExplain(sh: Shared, node: TurnGroup): string {
  const t = sh.t
  let head: string
  if (node.kind === 'turn') head = `**${t('turn')} ${node.turn}** = ${t('expTurn')}`
  else if (node.kind === 'system') head = `**${t('systemInput')}** = ${t('expSystem')}`
  else head = `**${t('userInput')}** = ${t('expUserInput')}`
  return `${head}\n\n- **${node.segments.length} ${t('seg')}** = ${t('expSegCount')}\n\n${nodeSuggestion(sh, node)}`
}

function StepSection({ step, sh }: { step: StepGroup; sh: Shared }) {
  const t = sh.t
  const segs = step.segments
  const assistant = segs.filter(s => s.role === 'assistant')
  const tools = segs.filter(s => s.role === 'tool')
  const other = segs.filter(s => s.role !== 'assistant' && s.role !== 'tool')
  const open = sh.isOpen('steps', step.key)
  const baseLabel = step.sourceKind ? sourceKindLabel(t, segs[0]!) : roleLabel(t, step.label)
  const label = step.num != null ? `${baseLabel} ${step.num}` : (step.label.startsWith('step-') ? `${t('step')} ${step.label.slice(5)}` : baseLabel)
  // The step's single LLM request, provider-measured (the assistant segment
  // carries its usage); null until any segment reports usage.
  const stepUsage = sumSegmentUsage(segs)
  return (
    <div className="ctm-step">
      <div className="ctm-step-head" onClick={() => sh.toggle('steps', step.key)}>
        <span>{(open ? '▾ ' : '▸ ') + label}{assistant.length ? ` · ${assistant.length} ${t('assistant')}` : ''}{tools.length ? ` · ${tools.length} ${t('toolResults')}` : ''}{other.length ? ` · ${other.length}` : ''}</span>
        <span className="ctm-node-sub">{stepUsage && <span title={t('stepUsageTip')}>{usageLine(t, stepUsage, false)}{' · '}</span>}{step.turn != null ? <span className="ctm-turn-label">{`${t('turn')} ${step.turn}`}</span> : null}{' '}{segs.length} {t('seg')}</span>
      </div>
      {open && <div>{[...other, ...assistant, ...tools].map(seg => <SegmentCard key={seg.id} seg={seg} sh={sh} />)}</div>}
    </div>
  )
}

export function TurnNode({ node, sh }: { node: TurnGroup; sh: Shared }) {
  const t = sh.t
  const open = sh.isOpen('turns', node.key)
  const explainOpen = sh.isOpen('explain', node.key) || sh.explainHover === node.key
  const title = node.kind === 'system' ? t('systemInput') : node.kind === 'user' ? t('userInput') : `${t('turn')} ${node.turn}`
  // Turn-level total: the summed provider usage of the turn's steps.
  const turnUsage = node.kind === 'turn' ? sumSegmentUsage(node.segments) : null
  return (
    <div className={`ctm-node ${node.kind === 'system' ? 'system' : ''}`}>
      <div className="ctm-node-head">
        <div className="ctm-node-title-wrap" onClick={() => sh.toggle('turns', node.key)}>
          <div className="ctm-node-title">{(open ? '▾ ' : '▸ ') + title}</div>
          <div className="ctm-node-sub">{node.segments.length} {t('seg')}{turnUsage && <span title={t('turnUsageTip')}>{' · ' + usageLine(t, turnUsage, true)}</span>}</div>
        </div>
        <div className="ctm-node-actions">
          <div className="ctm-explain-wrap" onMouseEnter={() => sh.setExplainHover(node.key)} onMouseLeave={() => sh.setExplainHover(null)}>
            <button type="button" className="ctm-btn subtle" onClick={() => sh.toggle('explain', node.key)}>{t('explain')}</button>
            {explainOpen && <div className="ctm-explain">{renderMarkdown(nodeExplain(sh, node))}</div>}
          </div>
        </div>
      </div>
      {open && <div>{node.steps.map(step => <StepSection key={step.key} step={step} sh={sh} />)}</div>}
    </div>
  )
}
