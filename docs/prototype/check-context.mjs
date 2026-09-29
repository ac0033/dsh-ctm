import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const {chromium}=await import(pathToFileURL(resolve(process.argv[2],'playwright/index.mjs')).href)
const browser=await chromium.launch({headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1000}})
const errors=[];page.on('pageerror',e=>errors.push(e.message))
const out=resolve('docs/prototype/screenshots-v3');await mkdir(out,{recursive:true})
try{
await page.goto('http://127.0.0.1:3182/')
assert.deepEqual(await page.locator('.context-entry').evaluateAll(xs=>xs.map(x=>x.id)),['s0','c1','u1','a1','t1','t2','a2','u2'].map(x=>'entry-'+x))
assert.equal(await page.locator('.context-entry pre').count(),2)
assert.equal(await page.locator('.context-entry details').count(),0)
assert.match(await page.locator('#coverage').innerText(),/全部 8 条/)
await page.screenshot({path:resolve(out,'context-light.png'),fullPage:true})
await page.locator('#theme').click()
await page.screenshot({path:resolve(out,'context-dark.png'),fullPage:true})
await page.locator('#theme').click()
await page.locator('[data-id="u2"]').click();await page.locator('#edit').click()
await page.locator('#draft').fill('请先补充回归测试。');await page.locator('#preview').click()
await page.locator('#apply').click();await page.locator('#done').click()
assert.equal(await page.locator('#queueCount').innerText(),'1')
await page.locator('#source').selectOption('tool');assert.equal(await page.locator('.context-entry').count(),2)
assert.match(await page.locator('#coverage').innerText(),/不是完整视图/)
await page.locator('#source').selectOption('all')
await page.locator('[data-change="c1"]').click();assert.match(await page.locator('#dialogContent').innerText(),/前情摘要/)
await page.keyboard.press('Escape');await page.locator('#current').click()
await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(out,'context-mobile.png'),fullPage:true})
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
assert.deepEqual(errors,[])
await writeFile(resolve(out,'qa.json'),JSON.stringify({passed:true,scope:'simulated full-context prototype',checks:['all eight entries in original order','text and code expanded','source metadata visible','filter coverage explicit','edit preview and queue','compression relation','light and dark','390px no overflow'],pageErrors:errors},null,2))
console.log('Full-context prototype QA passed')
}finally{await browser.close()}
