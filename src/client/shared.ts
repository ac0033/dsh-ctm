/**
 * Shared view plumbing: the `Shared` prop bundle every extracted component
 * receives, plus the generic expansion-state hook that replaces the six
 * parallel Record<string, boolean> maps the old monolithic view kept.
 */
import { useCallback, useState } from 'react'
import type { CtmState } from '../contract'
import type { CtmKey, Lang } from './locales'

export interface EditingState { id: string; text: string; role: string; turnIndex: number }

/** Collapsible UI areas, one independent boolean map each. */
export type ExpNs = 'turns' | 'steps' | 'tools' | 'content' | 'think' | 'explain'

/** Everything a presentational component needs from the view's state. */
export interface Shared {
  t: (k: CtmKey) => string
  lang: Lang
  busy: boolean
  state: CtmState
  isOpen: (ns: ExpNs, key: string) => boolean
  toggle: (ns: ExpNs, key: string) => void
  explainHover: string | null
  setExplainHover: (key: string | null) => void
  legendHover: boolean
  setLegendHover: (v: boolean) => void
  editing: EditingState | null
  setEditing: (e: EditingState | null) => void
  askConfirm: (name: string, args: Record<string, unknown>) => void
}

/** Generic expansion state: every namespace starts fully collapsed. */
export function useExpansion(): { isOpen: Shared['isOpen']; toggle: Shared['toggle'] } {
  const [maps, setMaps] = useState<Partial<Record<ExpNs, Record<string, boolean>>>>({})
  const isOpen = useCallback((ns: ExpNs, key: string) => !!maps[ns]?.[key], [maps])
  const toggle = useCallback((ns: ExpNs, key: string) => {
    setMaps(p => ({ ...p, [ns]: { ...p[ns], [key]: !p[ns]?.[key] } }))
  }, [])
  return { isOpen, toggle }
}
