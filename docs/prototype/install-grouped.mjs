import {readFile,writeFile} from 'node:fs/promises'
const file=n=>new URL(n,import.meta.url)
let js=await readFile(file('reader.js'),'utf8')
const start=js.indexOf('function flatList()'),end=js.indexOf('function bindItems()',start)
const grouping=await readFile(file('grouped-reader.js'),'utf8')
js=js.slice(0,start)+grouping+`
function flatList(){
const rows=base.filter(x=>(source==='all'||x.role===source)&&[x.text,x.code||'',x.source].join(' ').toLowerCase().includes(search.toLowerCase()));
el('coverage').textContent=(rows.length===base.length?'全部 '+base.length+' 条已归类':'筛选结果 '+rows.length+' / '+base.length+' 条 · 当前不是完整视图')+(readingMode==='grouped'?' · 类内保持记录顺序；收起只影响显示':' · 按原始记录顺序连续展示');
el('flatList').innerHTML=readingControls()+(rows.length?(readingMode==='grouped'?renderGrouped(rows):rows.map(item).join('')):'<p>没有匹配的内容。</p>');
const nav=document.querySelector('.context-index');nav.innerHTML='<strong>上下文目录</strong>'+(readingMode==='grouped'?contextClasses(rows).map(g=>'<a href="#class-'+g.id+'">'+g.title+' · '+g.rows.length+'</a>').join(''):rows.map(x=>'<a href="#entry-'+x.id+'">'+e(x.label)+' · #'+x.seq+'</a>').join(''));
bindItems();bindGroups();bindReadingControls();
}
`+js.slice(end)
await writeFile(file('reader.js'),js)
await writeFile(file('reader.css'),(await readFile(file('reader.css'),'utf8'))+`
.reading-controls{display:flex;align-items:center;gap:15px;margin-bottom:20px;flex-wrap:wrap}.reading-switch{display:flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:3px;font-size:12px}.reading-switch button[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover);font-weight:600}.context-class{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;margin:16px 0;overflow:hidden}.context-class>summary{cursor:pointer;padding:18px 20px;display:flex;align-items:center;gap:12px;background:var(--dsw-alias-bg-layer-1)}.context-class>summary:before{content:'▸';color:var(--dsw-alias-label-secondary)}.context-class[open]>summary:before{content:'▾'}.context-class summary::-webkit-details-marker{display:none}.context-class strong{font-size:16px;font-weight:550}.class-description{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:3px}.class-count{margin-left:auto;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary)}.class-body{padding:0 20px}.segment-disclosure{border-top:1px solid var(--dsw-alias-border-l1)}.segment-disclosure:first-child{border-top:0}.segment-disclosure>summary{padding:15px 0;cursor:pointer;font-size:13px;display:flex;gap:10px;align-items:center}.segment-disclosure>summary:before{content:'▸';color:var(--dsw-alias-label-secondary)}.segment-disclosure[open]>summary:before{content:'▾'}.segment-disclosure>summary>span:last-child{font-size:11px;margin-left:auto;white-space:nowrap}.segment-disclosure .context-entry{padding:8px 0 24px;border-top:0}.segment-disclosure[open]>summary{font-weight:550}.segment-disclosure .entry-head strong{display:none}@media(max-width:600px){.class-count{white-space:normal;text-align:right;max-width:85px}.class-body{padding:0 14px}.context-class>summary{padding:16px 14px}.segment-disclosure>summary{flex-wrap:wrap}.segment-disclosure>summary>span:last-child{margin-left:20px}.reading-controls{gap:10px}.reading-controls .spacer{display:none}}
`)
