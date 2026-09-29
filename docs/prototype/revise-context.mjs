import {readFile,writeFile} from 'node:fs/promises'
const file=n=>new URL(n,import.meta.url)
let js=await readFile(file('reader.js'),'utf8')
js=js.replace("flat=false", "flat=true")
js=js.replace('模型现在能看到什么？','上下文').replace('它会沿用这些内容，继续与你对话。','完整阅读当前内容，围绕原文查看来源、变化与调整。')
const start=js.indexOf('function item(x)')
const end=js.indexOf('function refreshQueue()',start)
js=js.slice(0,start)+`function item(x){return \`<article class="context-entry" id="entry-\${x.id}"><header class="entry-head"><strong>\${e(x.label)}</strong><span>角色：\${e(x.role==='summary'?'user':x.role)} · \${x.turn?'第 '+x.turn+' 轮':'系统部分'} · #\${x.seq}</span><span class="spacer"></span><button class="plain-link" data-id="\${x.id}">分析与操作</button></header><div class="entry-source">来源：\${e(x.source)} · 当前保留</div><div class="context-text">\${e(x.text)}</div>\${x.code?'<pre>'+e(x.code)+'</pre>':''}\${x.previous?'<aside class="context-note">'+e(x.previous)+' <button class="plain-link" data-change="'+x.id+'">查看变化关系</button></aside>':''}</article>\`}
`+js.slice(end)
const a=js.indexOf('function render(){'),b=js.indexOf('function flatList()',a)
js=js.slice(0,a)+`function render(){
el('current').setAttribute('aria-pressed',screen==='current');el('changes').setAttribute('aria-pressed',screen==='changes');
if(screen==='changes'){renderChanges();return}
el('panel').innerHTML=\`<div class="status"><span class="dot"></span><span>当前日志推导 · 非最终请求</span><span class="spacer"></span><button id="usage" class="plain-link">本页 \${base.length} 条 · 估算 \${base.reduce((n,x)=>n+x.tokens,0)} Token</button></div><p class="scope-note">模拟上下文，以下展示样例中的全部正文与代码。真实请求配置、工具定义及非文本块尚未接入；工具结果为示例，不能视为实际文件全文。</p><div class="context-layout"><nav class="context-index" aria-label="上下文目录"><strong>定位内容</strong>\${base.map(x=>'<a href="#entry-'+x.id+'">'+e(x.label)+(x.turn?' · '+x.turn:'')+'</a>').join('')}</nav><section class="context-document"><div class="searchrow"><input id="search" aria-label="搜索上下文" placeholder="搜索正文或来源…" value="\${e(search)}"><select id="source" aria-label="筛选来源"><option value="all">全部角色</option><option value="system">系统</option><option value="summary">压缩摘要</option><option value="user">用户</option><option value="assistant">助手</option><option value="tool">工具</option></select></div><p id="coverage" class="order"></p><div id="flatList"></div></section></div>\`;
el('usage').onclick=()=>show('<h2>当前内容统计</h2><p>统计范围：本页完整样例，共 '+base.length+' 条。Token 是样例估算值，不是实际请求用量。</p><dl>'+base.map(x=>'<dt>'+e(x.label)+' · #'+x.seq+'</dt><dd>'+x.tokens+' Token（样例估算）</dd>').join('')+'</dl>');
el('source').value=source;el('search').oninput=ev=>{search=ev.target.value;flatList()};el('source').onchange=ev=>{source=ev.target.value;flatList()};flatList();}
`+js.slice(b)
js=js.replace('el(\'flatList\').innerHTML=rows.map(item)',"el('coverage').textContent=(rows.length===base.length?'全部 '+base.length+' 条':'筛选结果 '+rows.length+' / '+base.length+' 条 · 当前不是完整视图')+' · 按记录顺序展示，正文不折叠';el('flatList').innerHTML=rows.map(item)")
js=js.replace("function bindItems(){", "function bindItems(){document.querySelectorAll('[data-change]').forEach(b=>b.onclick=()=>{screen='changes';render();el('compression').click()});")
await writeFile(file('reader.js'),js)
await writeFile(file('reader.css'),(await readFile(file('reader.css'),'utf8'))+`
/* Full context is the document; navigation and controls remain subordinate. */
main{max-width:1240px}.context-layout{display:grid;grid-template-columns:165px minmax(0,1fr);gap:36px}.context-index{position:sticky;top:20px;align-self:start;font-size:12px;display:grid;gap:10px;padding-top:8px}.context-index a{color:var(--dsw-alias-label-secondary);text-decoration:none}.context-index a:hover{text-decoration:underline}.scope-note{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0 0 24px;max-width:900px}.context-entry{padding:24px 0;border-top:1px solid var(--dsw-alias-border-l1);scroll-margin-top:24px}.entry-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px}.entry-head strong{font-size:14px}.entry-head>span,.entry-source{color:var(--dsw-alias-label-secondary)}.entry-source{font-size:12px;margin:5px 0 14px;overflow-wrap:anywhere}.context-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.95}.context-note{font-size:12px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l2);padding-left:12px;margin-top:16px}.context-entry pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.context-document{min-width:0}.context-index strong{font-weight:500}.readtext{white-space:pre-wrap}@media(max-width:700px){.context-layout{display:block}.context-index{position:static;display:flex;overflow:auto;white-space:nowrap;margin-bottom:22px;padding-bottom:8px}.entry-head{gap:7px}.entry-head .spacer{display:none}.entry-head button{margin-left:auto}}
`)
console.log('Full context document is now the default view')
