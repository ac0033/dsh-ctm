// Preserve the first proposal and reuse its simulated data; no production code changes.
import { readFile, writeFile, copyFile } from 'node:fs/promises'
const file = name => new URL(name, import.meta.url)
try { await copyFile(file('index.html'), file('v1.html'), 1) } catch (error) { if (error.code !== 'EEXIST') throw error }
const original = await readFile(file('v1.html'), 'utf8')
const fixture = original.match(/const base=\[[\s\S]*?\];/)?.[0]
if (!fixture) throw new Error('Missing original simulation fixture')
const css = await readFile(file('reader.css'), 'utf8')
const js = await readFile(file('reader.js'), 'utf8')
await writeFile(file('index.html'), `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>上下文 · 从概览到细节</title><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/elevation.css"><style>${css}</style></head><body><script>${fixture}\n${js}</script></body></html>\n`)
console.log('Updated reading prototype; v1.html preserved')
