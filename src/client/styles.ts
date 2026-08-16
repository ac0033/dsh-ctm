/** Global (ctm-*) stylesheet text, injected into a <style data-plugin> tag at boot. */

export const CSS = `
.ctm-wrap{display:flex;flex-direction:column;gap:10px;padding:4px 2px;color:var(--dsw-alias-label-primary);}
.ctm-sticky{position:sticky;top:0;z-index:20;background:var(--dsw-alias-bg-layer-1);backdrop-filter:blur(6px);border-radius:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);box-shadow:0 1px 6px rgba(0,0,0,.15);}
.ctm-minbar{position:sticky;bottom:0;z-index:20;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);backdrop-filter:blur(6px);box-shadow:0 -1px 6px rgba(0,0,0,.15);}
.ctm-editor{position:sticky;bottom:0;z-index:30;margin-top:10px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 -2px 12px rgba(0,0,0,.2);}
.ctm-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;}
.ctm-modal{background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px;max-width:440px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.4);color:var(--dsw-alias-label-primary);}
.ctm-modal .ctm-node-title{margin-bottom:10px;}
.ctm-modal-row{font-size:12.5px;margin:6px 0;line-height:1.5;}
.ctm-modal-row b{color:var(--dsw-alias-label-secondary);margin-right:4px;}
.ctm-summary{display:flex;flex-wrap:wrap;gap:10px;align-items:center;}
.ctm-kpi{display:flex;flex-direction:column;min-width:90px;}
.ctm-kpi .k{font-size:11px;color:var(--dsw-alias-label-secondary);}
.ctm-kpi .v{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);}
.ctm-kpi .v small{font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary);}
.ctm-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px;}
.ctm-btn:hover{filter:brightness(1.08);}
.ctm-btn.primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}
.ctm-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);}
.ctm-btn.realtime-on{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);background:rgba(46,204,113,.12);}
.ctm-btn:disabled{opacity:.5;cursor:default;}
.ctm-flow{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;}
.ctm-node{flex:1 1 280px;min-width:240px;border:2px solid var(--dsw-alias-border-l2);border-radius:12px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1);position:relative;}
.ctm-node.system{border-style:dashed;border-color:var(--dsw-alias-border-l2);}
.ctm-node.green{border-color:var(--dsw-alias-state-success-primary);}
.ctm-node.blue{border-color:var(--dsw-alias-brand-primary);}
.ctm-node.yellow{border-color:var(--dsw-alias-state-warn-primary);}
.ctm-node.red{border-color:var(--dsw-alias-state-error-primary);}
.ctm-node-head{display:flex;justify-content:space-between;align-items:center;gap:8px;}
.ctm-node-title-wrap{flex:1 1 auto;cursor:pointer;min-width:0;}
.ctm-node-title{font-weight:700;font-size:13px;}
.ctm-node-sub{font-size:11px;color:var(--dsw-alias-label-secondary);}
.ctm-node-actions{display:flex;gap:6px;align-items:center;flex:0 0 auto;}
.ctm-turn-label{font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:0 6px;}
.ctm-explain-wrap{position:relative;display:inline-block;}
.ctm-explain{position:absolute;top:100%;right:0;margin-top:4px;width:340px;max-width:80vw;max-height:320px;overflow:auto;z-index:40;padding:10px 12px;border:1px solid var(--dsw-alias-brand-primary);border-radius:10px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 6px 24px rgba(0,0,0,.3);font-size:12px;}
.ctm-step{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 8px;margin-top:8px;background:var(--dsw-alias-bg-layer-2);}
.ctm-step-head{display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;font-size:12px;}
.ctm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px;margin-top:8px;background:var(--dsw-alias-bg-layer-2);}
.ctm-card.system{border-style:dashed;border-color:var(--dsw-alias-border-l2);}
.ctm-card.green{border-color:var(--dsw-alias-state-success-primary);}
.ctm-card.blue{border-color:var(--dsw-alias-brand-primary);}
.ctm-card.yellow{border-color:var(--dsw-alias-state-warn-primary);}
.ctm-card.red{border-color:var(--dsw-alias-state-error-primary);}
.ctm-dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:11.5px;margin-bottom:6px;}
.ctm-dl dt{color:var(--dsw-alias-label-secondary);font-weight:600;}
.ctm-dl dd{margin:0;word-break:break-all;color:var(--dsw-alias-label-primary);}
.ctm-badge{display:inline-block;border-radius:6px;padding:1px 6px;font-size:10px;border:1px solid;cursor:help;}
.ctm-badge.hit{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}
.ctm-badge.miss{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}
.ctm-badge.partial{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);}
.ctm-badge.unknown{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-label-secondary);}
.ctm-badge.eff-effective{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}
.ctm-badge.eff-redundant{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);}
.ctm-badge.eff-stale{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);}
.ctm-badge.eff-injected{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-label-secondary);border-style:dashed;}
.ctm-content{font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-primary);}
.ctm-content.trunc{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.ctm-md-p{margin:2px 0;}
.ctm-md-h{margin:6px 0 2px;font-weight:700;}
.ctm-md-code{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 8px;font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;}
.ctm-code{font-family:monospace;font-size:11.5px;background:var(--dsw-alias-bg-layer-2);padding:0 3px;border-radius:4px;}
.ctm-md-list{margin:2px 0 2px 18px;padding:0;}
.ctm-thinking{font-size:11.5px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-brand-primary);padding-left:8px;margin-top:4px;max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-word;}
.ctm-tools{margin-top:6px;}
.ctm-toolitem{font-family:monospace;font-size:11px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 6px;margin-top:4px;word-break:break-all;max-height:140px;overflow:auto;white-space:pre-wrap;}
.ctm-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center;}
.ctm-hint{font-size:11px;color:var(--dsw-alias-label-secondary);}
.ctm-notice{border-radius:8px;padding:8px 10px;font-size:12px;margin-bottom:8px;}
.ctm-notice.ok{border:1px solid var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);}
.ctm-notice.warn{border:1px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);}
.ctm-notice.error{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);}
.ctm-textarea{width:100%;box-sizing:border-box;min-height:80px;font-family:inherit;font-size:12.5px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;}
.ctm-check{display:flex;align-items:center;gap:5px;font-size:12px;margin:4px 0;color:var(--dsw-alias-label-primary);}
.ctm-empty{padding:20px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;}
.ctm-legend-wrap{position:relative;display:inline-block;}
.ctm-legend-pop{position:absolute;right:0;top:100%;margin-top:6px;width:400px;max-width:90vw;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px;z-index:50;box-shadow:0 6px 24px rgba(0,0,0,.3);color:var(--dsw-alias-label-primary);}
.ctm-legend-pop h4{margin:0 0 6px;font-size:13px;}
.ctm-legend-row{display:flex;gap:8px;font-size:11.5px;margin:5px 0;align-items:baseline;}
.ctm-dot{flex:0 0 12px;width:12px;height:12px;border-radius:3px;margin-right:2px;align-self:center;}
.ctm-pager{display:flex;gap:8px;align-items:center;justify-content:center;margin:8px 0;}
.ctm-section-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:6px 0;}
`
