import { describe, it, expect } from 'vitest'
import { fmtHitRate, formatTokens, fmtTokens, tpl, usageLine, type TFunc } from '../src/client/labels'
import { zh, en, type CtmKey } from '../src/client/locales'

const tzh: TFunc = (k: CtmKey) => zh[k]
const ten: TFunc = (k: CtmKey) => en[k]

describe('formatTokens', () => {
  it('keeps small counts as-is', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(999)).toBe('999')
  })

  it('scales to K with one decimal under three digits', () => {
    expect(formatTokens(12200)).toBe('12.2K')
    expect(formatTokens(517000)).toBe('517K')
    expect(formatTokens(1000)).toBe('1K')
  })

  it('scales to M from a million', () => {
    expect(formatTokens(1200000)).toBe('1.2M')
    expect(formatTokens(517000000)).toBe('517M')
  })

  it('fmtTokens renders null as a dash', () => {
    expect(fmtTokens(null)).toBe('—')
    expect(fmtTokens(42)).toBe('42')
  })
})

describe('tpl', () => {
  it('fills known slots and leaves unknown ones untouched', () => {
    expect(tpl('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}')
  })
})

describe('fmtHitRate', () => {
  it('rounds to a percent; dash when nothing was billed or no totals', () => {
    expect(fmtHitRate({ uncachedInput: 9, cacheRead: 91, cacheWrite: 0, output: 0 })).toBe('91%')
    expect(fmtHitRate({ uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 })).toBe('—')
    expect(fmtHitRate(null)).toBe('—')
  })
})

describe('usageLine', () => {
  const totals = { uncachedInput: 2300, cacheRead: 10000, cacheWrite: 0, output: 1200 }

  it('zh: 输入 · 命中 · 输出 with the hit segment', () => {
    expect(usageLine(tzh, totals, true)).toBe('输入 12.3K · 命中 81% · 输出 1.2K')
  })

  it('en: in · hit · out without the hit segment when disabled', () => {
    expect(usageLine(ten, totals, false)).toBe('12.3K in · 1.2K out')
  })

  it('drops the hit segment when nothing was billed', () => {
    expect(usageLine(ten, { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 5 }, true)).toBe('0 in · 5 out')
  })
})
