import { describe, it, expect } from 'vitest'
import { unescapeText } from '../src/client/text'

const BS = String.fromCharCode(92)

describe('unescapeText (display-only, for JSON-escaped tool arguments)', () => {
  it('unescapes the sequences JSON.stringify produces', () => {
    expect(unescapeText('line1' + BS + 'nline2')).toBe('line1\nline2')
    expect(unescapeText('a' + BS + 'tb')).toBe('a\tb')
    expect(unescapeText('say ' + BS + '"hi' + BS + '"')).toBe('say "hi"')
    expect(unescapeText('a' + BS + 'rb')).toBe('ab')
  })

  it('preserves an escaped backslash (\\\\n stays backslash + n)', () => {
    expect(unescapeText(BS + BS + 'n')).toBe(BS + 'n')
    expect(unescapeText('C:' + BS + BS + 'new')).toBe('C:' + BS + 'new')
  })

  it('leaves plain text untouched', () => {
    expect(unescapeText('hello world')).toBe('hello world')
    expect(unescapeText('')).toBe('')
  })
})
