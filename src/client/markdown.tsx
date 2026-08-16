/** Minimal markdown rendering (headings, lists, fenced code, inline bold/code). */
import type { ReactNode } from 'react'

export function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let index = 0
  for (const match of text.matchAll(regex)) {
    const at = match.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    const tok = match[0] ?? ''
    if (tok.startsWith('**')) parts.push(<strong key={`b${index++}`}>{tok.slice(2, -2)}</strong>)
    else parts.push(<code key={`c${index++}`} className="ctm-code">{tok.slice(1, -1)}</code>)
    last = at + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function renderMarkdown(text: string): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let codeBuf: string[] = []
  let inCode = false
  let key = 0
  const flush = () => {
    if (codeBuf.length > 0) { out.push(<pre key={`code${key++}`} className="ctm-md-code">{codeBuf.join('\n')}</pre>); codeBuf = [] }
  }
  for (const line of lines) {
    if (line.trim().startsWith('```')) { if (inCode) { flush(); inCode = false } else { inCode = true }; continue }
    if (inCode) { codeBuf.push(line); continue }
    const trimmed = line.trim()
    if (trimmed === '') { flush(); continue }
    const h = trimmed.match(/^(#{1,4})\s+(.*)$/)
    if (h) { flush(); out.push(<div key={`h${key++}`} className="ctm-md-h">{renderInline(h[2])}</div>); continue }
    const ul = trimmed.match(/^[-*]\s+(.*)$/)
    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/)
    if (ul || ol) {
      out.push(<div key={`li${key++}`} className="ctm-md-list">• {renderInline((ul ?? ol)![1])}</div>)
      continue
    }
    out.push(<div key={`p${key++}`} className="ctm-md-p">{renderInline(line)}</div>)
  }
  flush()
  return out.length ? out : [<div key="fallback" className="ctm-md-p">{text}</div>]
}
