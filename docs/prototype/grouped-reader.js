// Classification follows the existing CTM user/system/turn hierarchy.
// The fixture has no step IDs; do not invent a request grouping for it.
let readingMode='grouped';
const expandedClasses=new Set(['input','system','compression','turn-13']);
const expandedEntries=new Set();
function contextClasses(rows){
const result=[
{id:'input',title:'用户输入',description:'按出现顺序查看你的要求',rows:rows.filter(x=>x.role==='user')},
{id:'system',title:'系统提示词',description:'系统提供的指引与约束',rows:rows.filter(x=>x.role==='system')},
{id:'compression',title:'压缩记录',description:'当前保留的摘要，以及它替代的历史范围',rows:rows.filter(x=>x.role==='summary')}
];
const turns=[...new Set(rows.filter(x=>['assistant','tool'].includes(x.role)).map(x=>x.turn))].sort((a,b)=>a-b);
for(const turn of turns)result.push({id:'turn-'+turn,title:'轮次 '+turn,description:'助手回复、工具调用与结果 · 样例未提供步骤编号',rows:rows.filter(x=>['assistant','tool'].includes(x.role)&&x.turn===turn)});
return result.filter(g=>g.rows.length);
}
function groupedEntry(x){return `<details class="segment-disclosure" data-entry="${x.id}" ${expandedEntries.has(x.id)?'open':''}><summary><span>${e(x.label)} <span class="muted">· 第 ${x.turn||'—'} 轮 · #${x.seq}</span></span><span class="muted">${x.tokens} Token · 展开原文</span></summary>${item(x)}</details>`}
function renderGrouped(rows){return contextClasses(rows).map(g=>`<details class="context-class" id="class-${g.id}" data-class="${g.id}" ${expandedClasses.has(g.id)?'open':''}><summary><div><strong>${g.title}</strong><span class="class-description">${g.description}</span></div><span class="class-count">${g.rows.length} 条 · ${g.rows.reduce((n,x)=>n+x.tokens,0)} Token</span></summary><div class="class-body">${g.rows.map(groupedEntry).join('')}</div></details>`).join('')}
function bindGroups(){
document.querySelectorAll('[data-class]').forEach(d=>d.addEventListener('toggle',()=>{d.open?expandedClasses.add(d.dataset.class):expandedClasses.delete(d.dataset.class)}));
document.querySelectorAll('[data-entry]').forEach(d=>d.addEventListener('toggle',()=>{d.open?expandedEntries.add(d.dataset.entry):expandedEntries.delete(d.dataset.entry)}));
}
function readingControls(){
return `<div class="reading-controls"><div class="reading-switch" aria-label="阅读方式"><button id="groupedMode" aria-pressed="${readingMode==='grouped'}">分类阅读</button><button id="orderedMode" aria-pressed="${readingMode==='ordered'}">原始顺序</button></div><span class="spacer"></span><button class="plain-link" id="expandEverything">全部展开</button><button class="plain-link" id="collapseEverything">全部收起</button></div>`;
}
function bindReadingControls(){
el('groupedMode').onclick=()=>{readingMode='grouped';flatList()};el('orderedMode').onclick=()=>{readingMode='ordered';flatList()};
el('expandEverything').onclick=()=>{document.querySelectorAll('[data-class],[data-entry]').forEach(d=>d.open=true)};
el('collapseEverything').onclick=()=>{document.querySelectorAll('[data-class],[data-entry]').forEach(d=>d.open=false)};
}
