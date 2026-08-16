/**
 * Global (ctm-*) stylesheet text, injected into a <style data-plugin> tag at
 * boot. Every color comes from a `--dsw-alias-*` semantic token (no hardcoded
 * hex/rgba), so the view follows the host light/dark theme automatically.
 *
 * Visual language: a card's 3px left bar + badge encode effectiveness only;
 * cache is a neutral badge with a ✓/✗ glyph; strong-stale is double-encoded
 * (red bar + ⚠ icon). Cards and nodes keep 1px neutral borders.
 */

export const CSS = `
.ctm-wrap{display:flex;flex-direction:column;gap:10px;padding:4px 2px;color:var(--dsw-alias-label-primary);font-size:13px;}
.ctm-sticky{position:sticky;top:0;z-index:20;background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);box-shadow:0 1px 6px var(--dsw-alias-bg-mask-2);}
.ctm-minbar{position:sticky;bottom:0;z-index:20;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 -1px 6px var(--dsw-alias-bg-mask-2);}
.ctm-editor{position:sticky;bottom:0;z-index:30;margin-top:10px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 -2px 12px var(--dsw-alias-bg-mask-1);}
.ctm-modal-overlay{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-3);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;}
.ctm-modal{background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px;max-width:440px;width:100%;box-shadow:0 8px 32px var(--dsw-alias-bg-mask-3);color:var(--dsw-alias-label-primary);}
.ctm-modal .ctm-node-title{margin-bottom:10px;}
.ctm-modal-row{font-size:13px;margin:6px 0;line-height:1.5;}
.ctm-modal-row b{color:var(--dsw-alias-label-secondary);margin-right:4px;}
.ctm-summary{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.ctm-kpis{display:flex;flex-wrap:wrap;gap:10px;align-items:center;}
.ctm-kpi{display:flex;flex-direction:column;min-width:84px;}
.ctm-kpi .k{font-size:11px;color:var(--dsw-alias-label-secondary);}
.ctm-kpi .v{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);}
.ctm-kpi .v small{font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary);}
.ctm-toolbar-spacer{flex:1 1 auto;}
.ctm-toolbar-group{display:flex;gap:2px;align-items:center;flex-wrap:wrap;}
.ctm-toolbar-sep{width:1px;align-self:stretch;background:var(--dsw-alias-border-l2);margin:2px 2px;}
.ctm-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px;line-height:1.4;}
.ctm-btn:hover{filter:brightness(1.08);}
.ctm-btn.primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);font-weight:600;}
.ctm-btn.primary:hover{background:var(--dsw-alias-button-primary-hover);filter:none;}
.ctm-btn.realtime-on{background:var(--dsw-alias-state-success-tertiary);border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);font-weight:600;}
.ctm-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);}
.ctm-btn.danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);filter:none;}
.ctm-btn.subtle{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:4px 8px;}
.ctm-btn.subtle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);filter:none;}
.ctm-btn.subtle.danger{border-color:transparent;color:var(--dsw-alias-state-error-primary);}
.ctm-btn.subtle.danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);}
.ctm-btn:disabled{opacity:.5;cursor:default;}
.ctm-flow{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;}
.ctm-node{flex:1 1 320px;min-width:260px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1);position:relative;}
.ctm-node.system{border-style:dashed;}
.ctm-node-head{display:flex;justify-content:space-between;align-items:center;gap:8px;}
.ctm-node-title-wrap{flex:1 1 auto;cursor:pointer;min-width:0;}
.ctm-node-title{font-weight:700;font-size:14px;}
.ctm-node-sub{font-size:12px;color:var(--dsw-alias-label-secondary);}
.ctm-node-actions{display:flex;gap:6px;align-items:center;flex:0 0 auto;}
.ctm-turn-label{font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:0 6px;}
.ctm-explain-wrap{position:relative;display:inline-block;}
.ctm-explain{position:absolute;top:100%;right:0;margin-top:4px;width:340px;max-width:80vw;max-height:320px;overflow:auto;z-index:40;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 6px 24px var(--dsw-alias-bg-mask-1);font-size:12.5px;}
.ctm-step{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 8px;margin-top:8px;background:var(--dsw-alias-bg-layer-2);}
.ctm-step-head{display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;}
.ctm-card{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;margin-top:8px;background:var(--dsw-alias-bg-layer-2);}
.ctm-card.eff-effective{border-left-color:var(--dsw-alias-state-success-primary);}
.ctm-card.eff-redundant{border-left-color:var(--dsw-alias-state-warn-primary);}
.ctm-card.eff-stale{border-left-color:var(--dsw-alias-state-error-primary);}
.ctm-card.eff-injected{border-left-color:var(--dsw-alias-border-l3);border-left-style:dashed;}
.ctm-meta{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:6px;}
.ctm-badge{display:inline-block;border-radius:6px;padding:1px 6px;font-size:11px;line-height:1.5;border:1px solid;cursor:help;}
.ctm-badge.cache{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2);}
.ctm-badge.pending{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);}
.ctm-badge.eff-effective{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}
.ctm-badge.eff-redundant{color:var(--dsw-alias-state-warn-label);border-color:var(--dsw-alias-state-warn-primary);}
.ctm-badge.eff-stale{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}
.ctm-badge.eff-injected{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-label-secondary);border-style:dashed;}
.ctm-content{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary);}
.ctm-content.trunc{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.ctm-md-p{margin:2px 0;}
.ctm-md-h{margin:6px 0 2px;font-weight:700;}
.ctm-md-code{background:var(--dsw-alias-markdown-code-block);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 8px;font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;}
.ctm-code{font-family:monospace;font-size:12px;background:var(--dsw-alias-markdown-inline-code);padding:0 3px;border-radius:4px;}
.ctm-md-list{margin:2px 0 2px 18px;padding:0;}
.ctm-thinking{font-size:12px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l3);padding-left:8px;margin-top:4px;max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-word;}
.ctm-tools{margin-top:6px;}
.ctm-toolitem{font-family:monospace;font-size:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 6px;margin-top:4px;word-break:break-all;max-height:140px;overflow:auto;white-space:pre-wrap;}
.ctm-actions{display:flex;flex-wrap:wrap;gap:2px;margin-top:6px;align-items:center;}
.ctm-hint{font-size:12px;color:var(--dsw-alias-label-secondary);}
.ctm-notice{border-radius:8px;padding:8px 10px;font-size:12.5px;margin-bottom:8px;border:1px solid;}
.ctm-notice.ok{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-tertiary);}
.ctm-notice.warn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-label);background:var(--dsw-alias-state-warn-tertiary);}
.ctm-notice.error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);}
.ctm-textarea{width:100%;box-sizing:border-box;min-height:80px;font-family:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;}
.ctm-empty{padding:20px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;}
.ctm-legend-wrap{position:relative;display:inline-block;}
.ctm-legend-pop{position:absolute;right:0;top:100%;margin-top:6px;width:400px;max-width:90vw;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px;z-index:50;box-shadow:0 6px 24px var(--dsw-alias-bg-mask-1);color:var(--dsw-alias-label-primary);}
.ctm-legend-pop h4{margin:0 0 6px;font-size:13px;}
.ctm-legend-row{display:flex;gap:8px;font-size:12px;margin:5px 0;align-items:baseline;}
.ctm-dot{flex:0 0 12px;width:12px;height:12px;border-radius:3px;align-self:center;}
.ctm-dot.success{background:var(--dsw-alias-state-success-primary);}
.ctm-dot.warn{background:var(--dsw-alias-state-warn-primary);}
.ctm-dot.error{background:var(--dsw-alias-state-error-primary);}
.ctm-dot.business{background:var(--dsw-alias-state-business-primary);}
.ctm-dot.neutral{background:transparent;border:1px dashed var(--dsw-alias-border-l2);}
.ctm-pager{display:flex;gap:8px;align-items:center;justify-content:center;margin:8px 0;}
.ctm-section-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:6px 0;}
`
