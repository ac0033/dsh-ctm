/**
 * Display-only unescape for JSON-escaped tool-call arguments (the host stores
 * non-string `arguments` via JSON.stringify, whose string values contain
 * literal `\n` / `\t` two-character sequences).
 *
 * NOT safe for general text: a literal backslash-n in real prose (regexes,
 * Windows paths like `C:\new`, code snippets) would be silently rewritten into
 * a newline. Segment content/reasoning and the editor therefore use the raw
 * text — never this function.
 */
export function unescapeText(s: string): string {
  if (!s) return s
  const BS = String.fromCharCode(92)
  const LF = String.fromCharCode(10)
  const TAB = String.fromCharCode(9)
  const NUL = String.fromCharCode(0)
  let out = s.split(BS + BS).join(NUL)
  out = out.split(BS + 'n').join(LF)
  out = out.split(BS + 't').join(TAB)
  out = out.split(BS + 'r').join('')
  out = out.split(BS + '"').join('"')
  out = out.split(NUL).join(BS)
  return out
}
