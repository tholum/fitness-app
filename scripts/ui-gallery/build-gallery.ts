/* ════════════════════════════════════════════════════════════════════
   UI GALLERY — static page builder.

   Reads ui-gallery/manifest.json and emits a single self-contained
   index.html: the manifest is inlined and rendering is plain DOM (no
   framework, no CDN), so the page opens directly off file:// and keeps
   working even when the app itself won't boot.

   Run standalone to rebuild the page from an existing manifest:
     tsx scripts/ui-gallery/build-gallery.ts
   ════════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import { HTML_PATH, MANIFEST_PATH, ROUTES, THEMES, VIEWPORTS, type Theme } from "./config";

interface Shot {
  account: string;
  accountLabel: string;
  route: string;
  routeLabel: string;
  path: string;
  state: string;
  stateLabel: string;
  viewport: string;
  viewportLabel: string;
  width: number;
  height: number;
  dpr: number;
  theme: Theme;
  file: string;
}
interface Manifest {
  meta: { generatedAt: string; baseURL: string; mode: string; count: number };
  shots: Shot[];
}
interface KL {
  key: string;
  label: string;
  path?: string;
}

/** Distinct values present in `shots`, ordered by `order`, labelled by `labelOf`. */
function ordered(shots: Shot[], pick: (s: Shot) => string, order: string[], labelOf: (s: Shot) => string): KL[] {
  const seen = new Map<string, string>();
  for (const s of shots) if (!seen.has(pick(s))) seen.set(pick(s), labelOf(s));
  const keys = [...seen.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  return keys.map((key) => ({ key, label: seen.get(key)! }));
}

export function renderHtml(manifest: Manifest): string {
  const { shots, meta } = manifest;

  const accounts = ordered(shots, (s) => s.account, ["populated", "empty", "loggedout"], (s) => s.accountLabel);
  const themes = ordered(shots, (s) => s.theme, [...THEMES], (s) => s.theme);
  const viewports = ordered(shots, (s) => s.viewport, VIEWPORTS.map((v) => v.key), (s) => s.viewportLabel);
  const states = ordered(shots, (s) => s.state, ["default", "quicklog", "new", "settings"], (s) => s.stateLabel);
  // Routes in config order, restricted to those captured.
  const routeOrder = ROUTES.map((r) => r.key);
  const routes = ordered(shots, (s) => s.route, routeOrder, (s) => s.routeLabel).map((r) => {
    const path = shots.find((s) => s.route === r.key)?.path ?? "";
    return { ...r, path };
  });

  const DATA = { meta, shots, accounts, themes, viewports, states, routes };
  // Inline safely (avoid </script> and stray "<" breaking the tag).
  const json = JSON.stringify(DATA).replace(/</g, "\\u003c");

  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Path Warden — UI Gallery</title>",
    "<style>", CSS, "</style>",
    "</head><body>",
    '<header><div class="brand">Path Warden · <span>UI Gallery</span></div>',
    '<div class="meta" id="meta"></div></header>',
    '<div class="bar" id="bar"></div>',
    '<main id="grid"></main>',
    '<div class="lightbox" id="lightbox" hidden><div class="lb-cap" id="lbCap"></div><img id="lbImg" alt=""></div>',
    "<script>window.__DATA__=" + json + ";</script>",
    "<script>", CLIENT, "</script>",
    "</body></html>",
  ].join("\n");
}

export function buildGalleryFromManifest(): void {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`No manifest at ${MANIFEST_PATH}. Run the capture first (pnpm ui:shots).`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
  fs.writeFileSync(HTML_PATH, renderHtml(manifest));
}

/* ── Styles (warm-dark, brand-tinted, framework-free) ────────────────────── */
const CSS = `
:root{--bg:#16130f;--panel:#211c16;--panel2:#2a241c;--line:#3a3127;--text:#f1e9df;--muted:#a99c8a;--faint:#6f6353;--blaze:#c8622d;--gold:#d9a441}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;padding:14px 20px;border-bottom:1px solid var(--line)}
.brand{font-weight:700;font-size:16px;letter-spacing:.3px}.brand span{color:var(--blaze)}
.meta{color:var(--muted);font-size:12px}
.bar{position:sticky;top:0;z-index:20;display:flex;gap:18px;flex-wrap:wrap;align-items:center;padding:12px 20px;background:rgba(22,19,15,.96);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.group{display:flex;gap:6px;align-items:center}
.group>.lbl{color:var(--faint);font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-right:2px}
.seg{display:flex;border:1px solid var(--line);border-radius:9px;overflow:hidden}
.seg button{background:var(--panel);color:var(--muted);border:0;padding:5px 11px;font-size:12px;cursor:pointer}
.seg button.on{background:var(--blaze);color:#1a1207;font-weight:700}
.chip{border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:999px;padding:4px 11px;font-size:12px;cursor:pointer;user-select:none}
.chip.on{border-color:var(--gold);color:var(--text);background:var(--panel2)}
input.search{background:var(--panel);border:1px solid var(--line);color:var(--text);border-radius:9px;padding:6px 10px;font-size:12px;min-width:160px}
main{padding:8px 20px 80px}
section.route{padding:18px 0;border-bottom:1px solid var(--line)}
section.route>h2{margin:0 0 4px;font-size:15px}
section.route>h2 .path{color:var(--faint);font-weight:400;font-size:12px;margin-left:8px;font-family:ui-monospace,monospace}
.state-row{margin-top:12px}
.state-row .state-lbl{color:var(--gold);font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px}
.thumbs{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start}
figure{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px;width:max-content}
figure img{display:block;height:340px;width:auto;border-radius:6px;background:#000;cursor:zoom-in}
figcaption{color:var(--muted);font-size:11px;margin-top:6px;text-align:center}
.missing{color:var(--faint);font-size:12px;border:1px dashed var(--line);border-radius:12px;padding:24px 18px;align-self:center}
.empty{color:var(--muted);padding:40px 0;text-align:center}
.lightbox{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;cursor:zoom-out}
.lightbox[hidden]{display:none}
.lightbox img{max-width:96vw;max-height:88vh;border-radius:8px}
.lb-cap{color:var(--muted);font-size:13px}
`;

/* ── Client (plain DOM; no template literals so the build stays simple) ──── */
const CLIENT = `
(function(){
  var D=window.__DATA__;
  var meta=document.getElementById('meta');
  meta.textContent=D.meta.count+' shots · '+D.meta.mode+' · '+D.meta.baseURL+' · '+new Date(D.meta.generatedAt).toLocaleString();

  // Index shots by composite key for O(1) lookup.
  var idx={};
  D.shots.forEach(function(s){ idx[[s.account,s.route,s.state,s.viewport,s.theme].join('|')]=s; });

  var sel={
    account: D.accounts[0] ? D.accounts[0].key : null,
    theme: (D.themes.find(function(t){return t.key==='dark';})||D.themes[0]||{}).key,
    viewports: D.viewports.map(function(v){return v.key;}),
    states: D.states.map(function(s){return s.key;}),
    q:''
  };

  var bar=document.getElementById('bar');
  function group(label){ var g=document.createElement('div'); g.className='group'; var l=document.createElement('span'); l.className='lbl'; l.textContent=label; g.appendChild(l); return g; }

  // Account (single-select segmented)
  var gA=group('Data'); var seg=document.createElement('div'); seg.className='seg';
  D.accounts.forEach(function(a){ var b=document.createElement('button'); b.textContent=a.label; if(a.key===sel.account)b.className='on';
    b.onclick=function(){ sel.account=a.key; [].forEach.call(seg.children,function(c){c.className='';}); b.className='on'; render(); };
    seg.appendChild(b); }); gA.appendChild(seg); bar.appendChild(gA);

  // Theme (single-select segmented)
  if(D.themes.length>1){ var gT=group('Theme'); var segT=document.createElement('div'); segT.className='seg';
    D.themes.forEach(function(t){ var b=document.createElement('button'); b.textContent=t.label; if(t.key===sel.theme)b.className='on';
      b.onclick=function(){ sel.theme=t.key; [].forEach.call(segT.children,function(c){c.className='';}); b.className='on'; render(); };
      segT.appendChild(b); }); gT.appendChild(segT); bar.appendChild(gT); }

  // Viewports (multi chips)
  var gV=group('Viewports');
  D.viewports.forEach(function(v){ var c=document.createElement('span'); c.className='chip on'; c.textContent=v.label;
    c.onclick=function(){ toggle(sel.viewports,v.key); c.className='chip'+(sel.viewports.indexOf(v.key)>=0?' on':''); render(); };
    gV.appendChild(c); }); bar.appendChild(gV);

  // States (multi chips) — only if more than just 'default'
  if(D.states.length>1){ var gS=group('States');
    D.states.forEach(function(s){ var c=document.createElement('span'); c.className='chip on'; c.textContent=s.label;
      c.onclick=function(){ toggle(sel.states,s.key); c.className='chip'+(sel.states.indexOf(s.key)>=0?' on':''); render(); };
      gS.appendChild(c); }); bar.appendChild(gS); }

  // Search
  var gQ=group('Find'); var inp=document.createElement('input'); inp.className='search'; inp.placeholder='route…';
  inp.oninput=function(){ sel.q=inp.value.toLowerCase(); render(); }; gQ.appendChild(inp); bar.appendChild(gQ);

  function toggle(arr,k){ var i=arr.indexOf(k); if(i>=0)arr.splice(i,1); else arr.push(k); }

  var grid=document.getElementById('grid');
  function render(){
    grid.innerHTML='';
    var vps=D.viewports.filter(function(v){return sel.viewports.indexOf(v.key)>=0;});
    var sts=D.states.filter(function(s){return sel.states.indexOf(s.key)>=0;});
    var shown=0;
    D.routes.forEach(function(r){
      if(sel.q && r.label.toLowerCase().indexOf(sel.q)<0 && r.path.toLowerCase().indexOf(sel.q)<0) return;
      // Which selected states actually have a shot for this route+account+theme?
      var liveStates=sts.filter(function(st){
        return vps.some(function(v){ return idx[[sel.account,r.key,st.key,v.key,sel.theme].join('|')]; });
      });
      if(!liveStates.length) return;
      shown++;
      var sec=document.createElement('section'); sec.className='route';
      var h=document.createElement('h2'); h.textContent=r.label;
      var p=document.createElement('span'); p.className='path'; p.textContent=r.path; h.appendChild(p); sec.appendChild(h);
      liveStates.forEach(function(st){
        var row=document.createElement('div'); row.className='state-row';
        if(sts.length>1 || st.key!=='default'){ var sl=document.createElement('div'); sl.className='state-lbl'; sl.textContent=st.label; row.appendChild(sl); }
        var th=document.createElement('div'); th.className='thumbs';
        vps.forEach(function(v){
          var s=idx[[sel.account,r.key,st.key,v.key,sel.theme].join('|')];
          if(!s){ var m=document.createElement('div'); m.className='missing'; m.textContent=v.label+' — n/a'; th.appendChild(m); return; }
          var fig=document.createElement('figure');
          var img=document.createElement('img'); img.loading='lazy'; img.src=s.file;
          img.alt=r.label+' · '+v.label+' · '+st.label;
          img.title=[s.accountLabel,r.label,st.label,v.label,s.theme].join(' · ');
          img.onclick=function(){ openLb(s); };
          fig.appendChild(img);
          var cap=document.createElement('figcaption'); cap.textContent=v.label+' · '+s.width+'×'+s.height+' @'+s.dpr+'x';
          fig.appendChild(cap); th.appendChild(fig);
        });
        row.appendChild(th); sec.appendChild(row);
      });
      grid.appendChild(sec);
    });
    if(!shown){ var e=document.createElement('div'); e.className='empty'; e.textContent='Nothing matches the current filters.'; grid.appendChild(e); }
  }

  var lb=document.getElementById('lightbox'), lbImg=document.getElementById('lbImg'), lbCap=document.getElementById('lbCap');
  function openLb(s){ lbImg.src=s.file; lbCap.textContent=[s.accountLabel,s.routeLabel,s.stateLabel,s.viewportLabel,s.theme,s.width+'×'+s.height+' @'+s.dpr+'x'].join('  ·  '); lb.hidden=false; }
  lb.onclick=function(){ lb.hidden=true; lbImg.src=''; };
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ lb.hidden=true; lbImg.src=''; } });

  render();
})();
`;

if (require.main === module) buildGalleryFromManifest();
