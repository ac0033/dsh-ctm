/**
 * Context Transparency Manager — browser half.
 * Self-contained dsh client plugin: registers the "Context" conversation view and
 * talks to the host through the single POST /ctm JSON route (no Typert coupling).
 */
import { CSS } from './styles'
import { NS, zh, en } from './locales'
import { CtmView, type CtmApi } from './view'
import { ctmResponseSchema, type CtmRequest, type CtmState } from '../contract'

export const inject = ['slots', 'locale']

export function apply(ctx: any): void {
  // Inject the plugin stylesheet once (idempotent across re-evaluation).
  const tagId = '@deepseek-ai/dsh-ctm/ctm.css'
  if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@deepseek-ai/dsh-ctm'
    tag.dataset.pluginCss = tagId
    tag.textContent = CSS
    document.head.appendChild(tag)
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const t = ctx.locale.bind(NS)

  const call = async (request: CtmRequest): Promise<CtmState> => {
    const res = await fetch('/ctm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    const parsed = ctmResponseSchema.parse(await res.json())
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.state
  }

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'ctm',
    order: 20,
    locale: NS,
    label: () => t('view.ctm'),
    inject: (sessionId: string): CtmApi => ({
      getState: () => call({ op: 'getState', sessionId }),
      replace: (segmentId, content) => call({ op: 'replace', sessionId, segmentId, content }),
      deleteSegment: (segmentId) => call({ op: 'delete', sessionId, segmentId }),
      rollback: (turnIndex) => call({ op: 'rollback', sessionId, turnIndex }),
      restore: (snapshotId) => call({ op: 'restore', sessionId, snapshotId }),
      reset: () => call({ op: 'reset', sessionId }),
      undo: () => call({ op: 'undo', sessionId }),
      override: (segmentId, value) => call({ op: 'override', sessionId, segmentId, value }),
      setRealtime: (enabled) => call({ op: 'setRealtime', sessionId, enabled }),
    }),
  }, CtmView))
}
