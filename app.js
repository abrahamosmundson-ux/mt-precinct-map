(() => {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ST = {unk:'Not checked', open:'Open', held:'Filled', yr:'Filled by a YR'};
const COLOR = {yr:'#c8102e', open:'#f2a900', held:'#6f7d8e', unk:'#8a96a3'};
const SEATS = [['m','Committeeman'],['w','Committeewoman']];
const GEO = 'https://gisservice.mt.gov/ArcGIS/rest/services/msdi_address_locator_geocode_v1/GeocodeServer';
const MT = {x0:-116.1, x1:-104.0, y0:44.3, y1:49.05};
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const narrow = () => innerWidth <= 900;
const store = {get(k,d){try{return localStorage.getItem(k) ?? d}catch{return d}}, set(k,v){try{localStorage.setItem(k,v)}catch{}}};

/* ---------- state ---------- */
let feats = [], byKey = new Map(), recs = {}, sel = null, filter = null, lines = null;
let lineMode = store.get('mtpm-lines','county'), sortKey = 'open', sortDir = -1;
let sb = null, session = null, isEditor = false, signups = [];
const cfg = window.MTPM_CONFIG || {};
if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase) sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

const num = v => (String(v ?? '').match(/\d+/) || [''])[0].replace(/^0+(?=\d)/, '');
const keyOf = p => 'p-' + String(p.ID || ((p.COUNTY||'') + '-' + (p.NAME||''))).replace(/[^A-Za-z0-9_\-~:@+]/g,'-').replace(/-+/g,'-').slice(0,120);
const pretty = s => String(s||'').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\b(Ii|Iii|Iv|Vi|Vii)\b/g, m => m.toUpperCase());
const seat = (k,s) => recs[k]?.[s]?.s || 'unk';
const status = k => { const a = seat(k,'m'), b = seat(k,'w'); return a==='yr'||b==='yr' ? 'yr' : a==='open'||b==='open' ? 'open' : a==='held'||b==='held' ? 'held' : 'unk'; };
const inFilter = f => !filter || (filter.t==='county' ? f.p.COUNTY===filter.v : filter.t==='hd' ? f.hd===filter.v : f.sd===filter.v);
const filterName = f => !f ? 'Statewide' : f.t==='county' ? f.v+' County' : (f.t==='hd' ? 'House District ' : 'Senate District ') + f.v;

/* ---------- map ---------- */
const map = L.map('map', {zoomControl:false, minZoom:5, maxZoom:18, zoomSnap:.25, zoomDelta:.5, wheelPxPerZoomLevel:90, maxBounds:[[42.5,-120],[51,-100]]});
L.control.zoom({position:'topright'}).addTo(map);
L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark?'dark_all':'light_all'}/{z}/{x}/{y}{r}.png`, {
  subdomains:'abcd', maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a> · Montana State Library'
}).addTo(map);
map.createPane('lines').style.zIndex = 450; map.getPane('lines').style.pointerEvents = 'none';
map.createPane('labels').style.zIndex = 460; map.getPane('labels').style.pointerEvents = 'none';
map.fitBounds([[MT.y0,MT.x0],[MT.y1,MT.x1]]);
let precinctLayer = null, lineLayer = L.layerGroup().addTo(map), labLayer = L.layerGroup().addTo(map), pLabLayer = L.layerGroup().addTo(map), pinMarker = null;

function style(f){
  const s = status(f.k), dim = !inFilter(f) || ($('#openOnly').checked && s !== 'open'), on = f.k === sel;
  return {
    color: on ? (dark?'#ffffff':'#121c27') : (dark?'#9aa8b8':'#3c4855'),
    weight: on ? 3.5 : .7, opacity: dim ? .25 : (on ? 1 : .55),
    fillColor: COLOR[s], fillOpacity: dim ? .04 : on ? (s==='unk' ? .22 : .6) : (s==='unk' ? .08 : .55)
  };
}
function paint(){ if (!precinctLayer) return; precinctLayer.eachLayer(l => l.setStyle(style(l.feature._f))); const L0 = byKey.get(sel)?.layer; if (L0) L0.bringToFront(); }

function drawLines(){
  lineLayer.clearLayers(); labLayer.clearLayers();
  const D = lines && lineMode !== 'none' ? lines[lineMode] : null;
  if (!D) return;
  const lw = lineMode === 'county' ? 2 : 1.6;
  L.polyline(D.lines.map(l => l.map(([x,y]) => [y,x])), {pane:'lines', color: dark?'#f2f5f8':'#121c27', weight: lw, opacity:.75, interactive:false, smoothFactor:1}).addTo(lineLayer);
  D.labels.forEach(([t,a,x,y]) => { const m = L.marker([y,x], {pane:'labels', interactive:false, keyboard:false, icon: L.divIcon({className:'dlab', html: esc(t), iconSize:null})}); m._a = a; m.addTo(labLayer); });
  sizeLabels();
}
function sizeLabels(){
  const z = map.getZoom(), th = narrow() ? 5000 : 4000;
  labLayer.eachLayer(m => { const show = m._a * 33.4 * Math.pow(4, z) >= th; const el = m.getElement(); if (el) el.style.display = show ? '' : 'none'; });
  pLabLayer.clearLayers();
  if (z >= 10.5 && feats.length) {
    const b = map.getBounds().pad(.1);
    feats.forEach(f => { if (!b.contains(f.ll)) return; const pxA = f.area * 33.4 * Math.pow(4, z); if (pxA < 9000) return;
      L.marker(f.ll, {pane:'labels', interactive:false, keyboard:false, icon: L.divIcon({className:'plab', html: esc(f.name), iconSize:null})}).addTo(pLabLayer); });
  }
}
map.on('zoomend moveend', sizeLabels);
function setLines(m){ lineMode = m; store.set('mtpm-lines', m); $$('#lineSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.l === m)); drawLines(); }
$('#lineSeg').onclick = e => { const b = e.target.closest('button'); if (b) setLines(b.dataset.l); };
$$('#lineSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.l === lineMode));

function boundsOf(list){ let b = null; list.forEach(f => { b = b ? b.extend(f.layer.getBounds()) : L.latLngBounds(f.layer.getBounds().getSouthWest(), f.layer.getBounds().getNorthEast()); }); return b; }
function fitTo(list, maxZoom = 13){ const b = boundsOf(list); if (b) map.flyToBounds(b, {padding:[30,30], maxZoom, animate: !reduce, duration:.8}); }
function fitState(){ map.flyToBounds([[MT.y0,MT.x0],[MT.y1,MT.x1]], {animate:!reduce, duration:.8}); }
$('#zreset').onclick = () => { select(null); setFilter(null); };

/* ---------- data ---------- */
function useData(fc){
  const seen = new Set();
  feats = fc.features.map(f => {
    const p = f.properties; let k = keyOf(p), k0 = k, i = 2; while (seen.has(k)) k = k0 + '-' + i++; seen.add(k);
    let bx = [180,90,-180,-90]; const walk = c => typeof c[0] === 'number' ? (bx = [Math.min(bx[0],c[0]),Math.min(bx[1],c[1]),Math.max(bx[2],c[0]),Math.max(bx[3],c[1])]) : c.forEach(walk); walk(f.geometry.coordinates);
    return {p, g:f.geometry, k, hd:num(p.HOUSE), sd:num(p.SENATE), name:pretty(p.NAME), poll:pretty(p.POLL), bx};
  });
  byKey = new Map(feats.map(f => [f.k, f]));
  const stateA = (MT.x1-MT.x0)*(MT.y1-MT.y0)*.82;
  precinctLayer = L.geoJSON({type:'FeatureCollection', features: feats.map(f => ({type:'Feature', _f:f, properties:{}, geometry:f.g}))}, {
    style: ft => style(ft._f),
    onEachFeature: (ft, layer) => {
      const f = ft._f; f.layer = layer; ft._f = f;
      const c = layer.getBounds().getCenter(); f.ll = c; f.area = (f.bx[2]-f.bx[0])*(f.bx[3]-f.bx[1])*.6/stateA;
      layer.on('click', () => { select(f.k); if (narrow()) showPeek(); });
      if (matchMedia('(hover:hover)').matches) layer.bindTooltip(() => `<b>${esc(f.name)}</b><br>${esc(f.p.COUNTY)} · ${ST[status(f.k)]}`, {sticky:true, className:'tt', direction:'top', offset:[0,-8]});
    }
  }).addTo(map);
  const cs = [...new Set(feats.map(f => f.p.COUNTY).filter(Boolean))].sort();
  $('#county').innerHTML = '<option value="">All counties</option>' + cs.map(c => `<option>${esc(c)}</option>`).join('');
  $('#loading').hidden = true; drawLines(); renderAll(); fromHash();
}

/* ---------- filters ---------- */
function setFilter(f, keepView){
  filter = f; $('#county').value = f && f.t === 'county' ? f.v : '';
  if (f && f.t !== 'county' && lineMode !== (f.t==='hd'?'house':'senate')) setLines(f.t==='hd'?'house':'senate');
  paint(); renderSide(); if (!keepView) f ? fitTo(feats.filter(inFilter), 12) : fitState();
}
$('#county').onchange = e => { select(null, true); setFilter(e.target.value ? {t:'county', v:e.target.value} : null); };
$('#openOnly').onchange = paint;

/* ---------- point in polygon ---------- */
function ringHas(x,y,r){ let c=false; for (let i=0,j=r.length-1; i<r.length; j=i++){ const [xi,yi]=r[i],[xj,yj]=r[j]; if ((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) c=!c; } return c; }
const geomHas = (x,y,g) => (g.type==='Polygon' ? [g.coordinates] : g.coordinates).some(p => ringHas(x,y,p[0]) && !p.slice(1).some(h => ringHas(x,y,h)));
function precinctAt(x,y){
  let f = feats.find(f => x>=f.bx[0] && x<=f.bx[2] && y>=f.bx[1] && y<=f.bx[3] && geomHas(x,y,f.g)), near = false;
  if (!f){ near = true; let best = 1e9; feats.forEach(c => { const dx = Math.max(c.bx[0]-x,0,x-c.bx[2]), dy = Math.max(c.bx[1]-y,0,y-c.bx[3]), d = dx*dx+dy*dy; if (d < best){ best = d; f = c; } }); }
  return {f, near};
}
function goPoint(x, y, label){
  const msg = $('#locMsg');
  if (x<MT.x0 || x>MT.x1 || y<MT.y0 || y>MT.y1){ msg.textContent = "That location isn't in Montana."; return; }
  const {f, near} = precinctAt(x, y);
  if (pinMarker) pinMarker.remove();
  pinMarker = L.marker([y,x], {icon: L.divIcon({className:'pinic', iconSize:[30,40], iconAnchor:[15,40],
    html:'<svg viewBox="0 0 30 40" width="30" height="40"><path d="M15 39C12 30 2 25 2 15a13 13 0 1 1 26 0c0 10-10 15-13 24z" fill="#121c27" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>'}), keyboard:false}).addTo(map);
  msg.textContent = `${label ? label + ' is in' : 'You are in'} ${f.name}, ${f.p.COUNTY} County${f.hd?' · HD '+f.hd:''}${f.sd?' · SD '+f.sd:''}.${near ? ' It sits right on a boundary, so confirm on the voter portal.' : ''}`;
  filter = null; $('#county').value = ''; select(f.k);
  const pb = f.layer.getBounds().extend([y,x]); map.flyToBounds(pb, {padding:[40,40], maxZoom:15, animate:!reduce, duration:.9});
  if (narrow()){ showPeek(); $('#mapbox').scrollIntoView({behavior: reduce?'auto':'smooth', block:'center'}); }
}

/* ---------- search: places + addresses ---------- */
const q = $('#q'), hits = $('#hits'); let hitList = [], hi = 0, sugTimer = 0, sugSeq = 0;
function localHits(s){
  const out = [];
  const m = s.match(/^(hd|house|house district|sd|senate|senate district)\s*#?\s*(\d+)$/);
  if (m){ const t = /^h/.test(m[1]) ? 'hd' : 'sd', v = String(+m[2]); const n = feats.filter(f => f[t]===v).length; if (n) out.push({f:{t,v}, label:`${t==='hd'?'House':'Senate'} District ${v}`, sub:`${n} precincts`}); }
  [...new Set(feats.map(f => f.p.COUNTY))].filter(c => c.toLowerCase().startsWith(s) || c.toLowerCase().includes(' '+s)).slice(0,3).forEach(c => out.push({f:{t:'county', v:c}, label:c+' County', sub:'County'}));
  const words = s.split(/\s+/);
  feats.map(f => { const hay = (f.name+' '+f.p.PN+' '+f.poll+' '+f.p.COUNTY).toLowerCase(); if (!words.every(w => hay.includes(w))) return null; return {f, sc: f.name.toLowerCase().startsWith(s) ? 0 : f.poll.toLowerCase().includes(s) ? 1 : 2}; })
    .filter(Boolean).sort((a,b) => a.sc-b.sc).slice(0,6).forEach(({f}) => out.push({k:f.k, label:f.name, sub:f.p.COUNTY + (f.poll ? ' · '+f.poll : '')}));
  return out;
}
function showHits(){
  if (!hitList.length){ hits.innerHTML = '<button disabled><span>No matches yet. Keep typing your street address.</span></button>'; }
  else {
    let html = '', last = '';
    hitList.forEach((h,i) => { const grp = h.addr ? 'Addresses' : 'Places on the map'; if (grp !== last){ html += `<div class="hd">${grp}</div>`; last = grp; }
      html += `<button role="option" data-i="${i}" class="${i===hi?'on':''}"><span>${esc(h.label)}</span><small>${esc(h.sub||'')}</small></button>`; });
    hits.innerHTML = html;
  }
  hits.hidden = false; q.setAttribute('aria-expanded','true');
}
function hideHits(){ hits.hidden = true; q.setAttribute('aria-expanded','false'); }
q.addEventListener('input', () => {
  const s = q.value.trim().toLowerCase(); hi = 0; clearTimeout(sugTimer);
  if (s.length < 2 || !feats.length){ hitList = []; return hideHits(); }
  const local = localHits(s); hitList = local; showHits();
  if (s.length >= 4){
    const seq = ++sugSeq;
    sugTimer = setTimeout(async () => {
      try {
        const u = `${GEO}/suggest?f=json&maxSuggestions=5&text=${encodeURIComponent(q.value.trim())}`;
        const r = await fetch(u); const j = await r.json();
        if (seq !== sugSeq) return;
        const addr = (j.suggestions||[]).filter(x => !x.isCollection).map(x => ({addr:true, label:x.text, magic:x.magicKey}));
        hitList = /\d/.test(s) ? [...addr, ...localHits(s)] : [...localHits(s), ...addr];
        showHits();
      } catch {}
    }, 220);
  }
});
async function geocode(text, magic){
  const u = `${GEO}/findAddressCandidates?f=json&outSR=4326&maxLocations=1&SingleLine=${encodeURIComponent(text)}${magic ? '&magicKey='+encodeURIComponent(magic) : ''}`;
  const r = await fetch(u); const j = await r.json(); return (j.candidates||[])[0];
}
async function pick(h){
  hideHits(); q.value = h.label;
  if (h.addr){
    $('#locMsg').textContent = 'Finding that address…';
    try { const c = await geocode(h.label, h.magic); if (!c) throw 0; goPoint(c.location.x, c.location.y, c.address.split(',')[0]); }
    catch { $('#locMsg').textContent = "Couldn't find that address. Try adding the town, or use Near me."; }
    return;
  }
  if (h.k){ select(h.k); fitTo([byKey.get(h.k)], 14); if (narrow()) showPeek(); }
  else { select(null, true); setFilter(h.f); }
  if (narrow()){ q.blur(); $('#mapbox').scrollIntoView({behavior:reduce?'auto':'smooth', block:'center'}); }
}
hits.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) pick(hitList[+b.dataset.i]); });
q.addEventListener('keydown', async e => {
  if (e.key === 'Enter'){
    e.preventDefault();
    if (!hits.hidden && hitList[hi]) return pick(hitList[hi]);
    const t = q.value.trim(); if (/\d/.test(t)){ $('#locMsg').textContent = 'Finding that address…'; try { const c = await geocode(t); if (!c) throw 0; hideHits(); goPoint(c.location.x, c.location.y, c.address.split(',')[0]); } catch { $('#locMsg').textContent = "Couldn't find that address. Try adding the town."; } }
    return;
  }
  if (hits.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); hi = (hi + (e.key==='ArrowDown'?1:-1) + hitList.length) % Math.max(1, hitList.length); showHits(); }
  if (e.key === 'Escape') hideHits();
});
document.addEventListener('click', e => { if (!e.target.closest('.search')) hideHits(); });

function nearMe(){
  const msg = $('#locMsg');
  if (!navigator.geolocation){ msg.textContent = "This browser can't share your location. Type your address instead."; return; }
  msg.textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition(p => goPoint(p.coords.longitude, p.coords.latitude, null),
    () => { msg.textContent = 'Location was blocked or unavailable. Type your address instead.'; }, {enableHighAccuracy:true, timeout:12000});
}
$('#gpsBtn').onclick = nearMe;
$$('[data-gps]').forEach(b => b.onclick = () => { $('#mapsec').scrollIntoView({behavior:reduce?'auto':'smooth'}); nearMe(); });
$$('[data-focus-q]').forEach(b => b.onclick = () => { $('#mapsec').scrollIntoView({behavior:reduce?'auto':'smooth'}); setTimeout(() => q.focus(), reduce ? 0 : 450); });

/* ---------- counts ---------- */
function tally(list){ const t = {n:list.length, yr:0, open:0, held:0, unk:0}; list.forEach(f => SEATS.forEach(([s]) => t[seat(f.k,s)]++)); return t; }
function renderKpis(){
  const t = tally(feats), tot = t.n*2 || 1, f = v => feats.length ? v.toLocaleString() : '—';
  $('#kpis').innerHTML = [[t.n,'precincts',''],[t.yr,'held by YRs',COLOR.yr],[t.open,'open seats',COLOR.open],[t.unk,'not checked','rgb(255 255 255/.5)']]
    .map(([v,l,c]) => `<div class="kpi"><b>${f(v)}</b><span>${c?`<i style="background:${c}"></i>`:''}${l}</span></div>`).join('');
  $('#prog').innerHTML = `<span>${f(tot-t.unk)} of ${f(t.n*2)} seats checked</span><div>${['yr','open','held'].map(k => `<i style="width:${t[k]/tot*100}%;background:${COLOR[k]}"></i>`).join('')}</div>`;
}
const bars = t => { const tot = t.n*2 || 1; return '<div class="bars">' + [['yr','YR in seat'],['open','Open'],['held','Filled'],['unk','Not checked']].map(([k,l]) => `<div class="brow"><span>${l}</span><div><i style="width:${t[k]/tot*100}%;background:${COLOR[k]}"></i></div><b>${t[k]}</b></div>`).join('') + '</div>'; };
function renderTable(){
  const by = {}; feats.forEach(f => (by[f.p.COUNTY] ||= []).push(f));
  const rows = Object.entries(by).map(([c,l]) => ({c, ...tally(l)}));
  rows.sort((a,b) => sortKey==='c' ? sortDir*a.c.localeCompare(b.c) : sortDir*(a[sortKey]-b[sortKey]) || a.c.localeCompare(b.c));
  $$('#ctab th').forEach(th => { const b = th.querySelector('button'); if (!b) return; if (b.dataset.s === sortKey) th.setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort'); });
  $('#ctab tbody').innerHTML = rows.length ? rows.map(r => { const tot = r.n*2; return `<tr data-c="${esc(r.c)}" tabindex="0"><td>${esc(r.c)}</td><td>${r.n}</td><td>${r.yr}</td><td>${r.open}</td><td>${r.held}</td><td>${r.unk}</td><td class="cov"><div>${['yr','open','held'].map(k => `<i style="width:${r[k]/tot*100}%;background:${COLOR[k]}"></i>`).join('')}</div></td></tr>`; }).join('') : '<tr><td colspan="7">Loading counties…</td></tr>';
}
$('#ctab thead').onclick = e => { const b = e.target.closest('button'); if (!b) return; const s = b.dataset.s; sortDir = sortKey === s ? -sortDir : (s==='c' ? 1 : -1); sortKey = s; renderTable(); };
const goCounty = c => { select(null, true); setFilter({t:'county', v:c}); $('#mapsec').scrollIntoView({behavior:reduce?'auto':'smooth'}); };
$('#ctab tbody').onclick = e => { const r = e.target.closest('tr[data-c]'); if (r) goCounty(r.dataset.c); };
$('#ctab tbody').onkeydown = e => { const r = e.target.closest('tr[data-c]'); if (r && (e.key==='Enter' || e.key===' ')){ e.preventDefault(); goCounty(r.dataset.c); } };

/* ---------- selection & panel ---------- */
function select(k, quiet){
  sel = k; paint();
  try { history.replaceState(null, '', k ? '#' + k : location.pathname + location.search); } catch {}
  if (!k) $('#peek').hidden = true;
  if (!quiet) renderSide();
}
function showPeek(){ const f = byKey.get(sel); if (!f) return; $('#peekName').textContent = f.name; $('#peekSub').textContent = `${f.p.COUNTY} · ${ST[seat(sel,'m')]} / ${ST[seat(sel,'w')]}`; $('#peek').hidden = false; }
$('#peekGo').onclick = () => $('#side').scrollIntoView({behavior:reduce?'auto':'smooth', block:'start'});
function fromHash(){ const k = decodeURIComponent(location.hash.slice(1)); if (k && byKey.has(k) && k !== sel){ select(k); fitTo([byKey.get(k)], 14); } }
addEventListener('hashchange', fromHash);
const fmtDate = s => s ? new Date(s).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'}) : '';

function renderSide(){
  const side = $('#side');
  if (!sel){
    const list = filter ? feats.filter(inFilter) : feats, t = tally(list);
    const open = filter ? list.filter(f => status(f.k) === 'open').slice(0,8) : [];
    const recent = isEditor ? signups.slice(0,8) : [];
    side.innerHTML = `<h2>${esc(filterName(filter))}</h2><p class="meta">${t.n} precincts · ${t.n*2} committee seats</p>${feats.length ? bars(t) : ''}
      ${filter ? '<div class="tags" style="margin-top:16px"><button class="btn ghost" id="clr">Show all of Montana</button></div>' : ''}
      ${open.length ? `<h3>Open seats here</h3><div class="tags">${open.map(f => `<button class="tag" data-k="${esc(f.k)}">${esc(f.name)}</button>`).join('')}</div>` : ''}
      ${recent.length ? `<h3>Newest sign-ups</h3><ul class="int">${recent.map(s => { const f = byKey.get(s.precinct); return `<li><b>${esc(s.name)}</b> · ${esc(s.contact)}<br><small>${esc(f ? f.name + ', ' + f.p.COUNTY : s.precinct)} · ${fmtDate(s.created_at)}</small></li>`; }).join('')}</ul>` : ''}
      <h3>How to use the map</h3><ol class="steps"><li>Type your address or tap Near me to find your precinct.</li><li>Gold means a seat is open. Tap "I want to serve here" and leaders will follow up.</li><li>County chairs: log in to mark seats as open, filled, or filled by a YR.</li></ol>
      ${!sb ? '<p class="note">Seat data isn\'t connected yet, so every seat shows as not checked.</p>' : ''}`;
    $('#clr')?.addEventListener('click', () => setFilter(null));
    side.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { select(b.dataset.k); fitTo([byKey.get(b.dataset.k)], 14); });
    return;
  }
  const f = byKey.get(sel); if (!f){ sel = null; return renderSide(); }
  const r = recs[sel] || {}, p = f.p, st = status(sel), k = sel;
  const head = `<button class="back" id="back">← ${filter ? 'Back to ' + esc(filterName(filter)) : 'All of Montana'}</button>
    <h2>${esc(f.name)}</h2>
    <div class="tags"><button class="tag" data-f="county">${esc(p.COUNTY)} County</button>${f.hd ? `<button class="tag" data-f="hd">HD ${esc(f.hd)}</button>` : ''}${f.sd ? `<button class="tag" data-f="sd">SD ${esc(f.sd)}</button>` : ''}<span class="tag"><span class="sw" style="background:${COLOR[st]}"></span>${st==='yr' ? 'YR seated' : ST[st]}</span></div>
    ${f.poll ? `<p class="meta">Polling place: ${esc(f.poll)}</p>` : ''}`;
  let body;
  if (isEditor){
    body = `<form id="pf">${SEATS.map(([s,l]) => `<div class="seat"><h3>${l}</h3><div class="opts" role="radiogroup" aria-label="${l}">${Object.entries(ST).map(([v,t]) => `<label><input type="radio" name="${s}" value="${v}"${seat(k,s)===v ? ' checked' : ''}><span><span class="sw" style="background:${COLOR[v]}"></span>${t}</span></label>`).join('')}</div>
      <label class="field">Who holds it<input type="text" name="${s}n" value="${esc(r[s]?.n || '')}" placeholder="Name, if filled" autocomplete="off" maxlength="120"></label></div>`).join('')}
      <label class="field">YR prospect (chairs only)<input type="text" name="pr" placeholder="Loading…" autocomplete="off" maxlength="200"></label>
      <label class="field">Notes (chairs only)<textarea name="no" rows="3" maxlength="2000" placeholder="Loading…"></textarea></label>
      <div class="saverow"><button class="btn" type="submit">Save precinct</button><p class="msg" id="pmsg"></p></div></form>
      <div id="sgl"></div>`;
  } else {
    body = `<div class="ro">${SEATS.map(([s,l]) => `<div><span>${l}</span><b>${ST[seat(k,s)]}${r[s]?.n ? ' · ' + esc(r[s].n) : ''}</b></div>`).join('')}</div>`;
    const done = store.get('mtpm-signed-'+k);
    body += `<div class="serve">${done ? '<h3>Thanks, you\'re on the list</h3><p class="meta">Leaders for this county will reach out.</p>' : `<h3>I want to serve here</h3><p class="meta">Live in this precinct? Leave your name and county and chapter leaders will follow up${st==='open' ? '. A seat here is open now.' : '.'}</p>
      <form id="if"><label class="field">Your name<input type="text" name="nm" required maxlength="80" autocomplete="name"></label><label class="field">Phone or email<input type="text" name="ct" required minlength="3" maxlength="80" autocomplete="email"></label>
      <div class="saverow" style="position:static"><button class="btn" type="submit"${sb ? '' : ' disabled'}>Put me forward</button><p class="msg" id="imsg"></p></div></form>`}</div>`;
  }
  side.innerHTML = head + body + (r.at ? `<p class="note">Seats last updated ${fmtDate(r.at)}.</p>` : '');
  $('#back').onclick = () => select(null);
  side.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { const t = b.dataset.f, v = t==='county' ? p.COUNTY : t==='hd' ? f.hd : f.sd; select(null, true); setFilter({t, v}); });
  $('#pf')?.addEventListener('submit', savePrecinct);
  $('#if')?.addEventListener('submit', saveInterest);
  if (isEditor) loadPrivate(k);
}

/* ---------- Supabase ---------- */
const fromRow = r => ({m:{s:r.m_status, n:r.m_name}, w:{s:r.w_status, n:r.w_name}, at:r.updated_at});
async function loadSeats(){
  if (!sb) return;
  const {data, error} = await sb.from('seats').select('precinct,m_status,m_name,w_status,w_name,updated_at');
  if (error){ console.warn(error); return; }
  const n = {}; data.forEach(r => n[r.precinct] = fromRow(r)); recs = n; renderKpis(); renderTable(); paint();
  if (!document.activeElement?.closest?.('#side form')) renderSide();
}
async function loadSignups(){
  if (!sb || !isEditor) { signups = []; return; }
  const {data} = await sb.from('signups').select('*').order('created_at', {ascending:false}).limit(500);
  signups = data || [];
}
async function loadPrivate(k){
  const [{data:note}, ] = await Promise.all([sb.from('notes').select('prospect,notes').eq('precinct', k).maybeSingle()]);
  if (sel !== k) return;
  const form = $('#pf'); if (!form) return;
  form.pr.value = note?.prospect || ''; form.no.value = note?.notes || ''; form.pr.placeholder = 'Name and phone'; form.no.placeholder = '';
  const mine = signups.filter(s => s.precinct === k);
  $('#sgl').innerHTML = mine.length ? `<h3>Signed up to serve here</h3><ul class="int">${mine.map(s => `<li><b>${esc(s.name)}</b> · ${esc(s.contact)}<br><small>${fmtDate(s.created_at)}</small></li>`).join('')}</ul>` : '';
}
async function savePrecinct(e){
  e.preventDefault(); const fd = new FormData(e.target), k = sel, msg = $('#pmsg'), btn = e.target.querySelector('[type=submit]');
  const now = new Date().toISOString();
  const row = {precinct:k, m_status:fd.get('m')||'unk', m_name:String(fd.get('mn')||'').trim(), w_status:fd.get('w')||'unk', w_name:String(fd.get('wn')||'').trim(), updated_at:now, updated_by: session?.user?.id || null};
  const note = {precinct:k, prospect:String(fd.get('pr')||'').trim(), notes:String(fd.get('no')||'').trim(), updated_at:now};
  msg.textContent = 'Saving…'; btn.disabled = true;
  const [a, b] = await Promise.all([sb.from('seats').upsert(row), sb.from('notes').upsert(note)]);
  btn.disabled = false;
  if (a.error || b.error){ msg.textContent = 'Could not save: ' + (a.error || b.error).message; return; }
  recs[k] = fromRow(row); renderKpis(); renderTable(); paint(); if (narrow() && sel === k) showPeek();
  const m = $('#pmsg'); if (m) m.textContent = 'Saved ✓';
}
async function saveInterest(e){
  e.preventDefault(); const fd = new FormData(e.target), msg = $('#imsg'), k = sel, btn = e.target.querySelector('[type=submit]');
  btn.disabled = true; msg.textContent = 'Sending…';
  const {error} = await sb.from('signups').insert({precinct:k, name:String(fd.get('nm')).trim(), contact:String(fd.get('ct')).trim()});
  btn.disabled = false;
  if (error){ msg.textContent = 'Could not send. Check your details and try again.'; return; }
  store.set('mtpm-signed-'+k, '1'); renderSide();
}

/* ---------- login ---------- */
const dlg = $('#login');
$('#loginBtn').onclick = async () => {
  if (session){ await sb.auth.signOut(); return; }
  if (!sb){ alert('Seat data is not connected yet.'); return; }
  $('#loginMsg').textContent = ''; dlg.showModal();
};
$('#loginClose').onclick = () => dlg.close();
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); const fd = new FormData(e.target); $('#loginMsg').textContent = 'Signing in…';
  const {error} = await sb.auth.signInWithPassword({email:fd.get('email'), password:fd.get('password')});
  if (error){ $('#loginMsg').textContent = 'That email and password didn\'t work.'; return; }
  dlg.close(); e.target.reset();
};
async function onAuth(s){
  session = s; isEditor = false;
  if (s){ const {data} = await sb.rpc('is_editor'); isEditor = !!data; }
  $('#loginBtn').textContent = s ? 'Sign out' : 'Chair login';
  if (s && !isEditor) $('#locMsg').textContent = 'You are signed in, but your email is not on the editors list yet. Ask the map owner to add you.';
  await loadSignups(); renderSide();
}

/* ---------- hero outline ---------- */
function heroShape(){
  const D = lines?.county; if (!D) return; let x0=180,x1=-180,y0=90,y1=-90;
  D.lines.forEach(l => l.forEach(([x,y]) => { x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y); }));
  const c = Math.cos(47*Math.PI/180), s = 100/((x1-x0)*c);
  $('#mtShape').setAttribute('viewBox', `0 0 100 ${((y1-y0)*s).toFixed(1)}`);
  $('#mtShape').innerHTML = `<path fill="none" stroke="#fff" stroke-width=".25" d="${D.lines.map(l => 'M' + l.map(([x,y]) => ((x-x0)*c*s).toFixed(2)+','+((y1-y)*s).toFixed(2)).join('L')).join('')}"/>`;
}

/* ---------- start ---------- */
renderAll();
function renderAll(){ renderKpis(); renderTable(); paint(); renderSide(); }
Promise.all([fetch('data/precincts.json').then(r => r.json()), fetch('data/lines.json').then(r => r.json()).catch(() => null)])
  .then(([fc, ln]) => { lines = ln; useData(fc); heroShape(); loadSeats(); })
  .catch(() => { $('#loading').textContent = 'The precinct map could not be loaded. Refresh to try again.'; });
if (sb){
  sb.auth.getSession().then(({data}) => onAuth(data.session));
  sb.auth.onAuthStateChange((ev, s) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') onAuth(s); });
  sb.channel('seats-live').on('postgres_changes', {event:'*', schema:'public', table:'seats'}, pl => {
    const r = pl.new; if (!r || !r.precinct) return; recs[r.precinct] = fromRow(r); renderKpis(); renderTable(); paint();
    if (sel === r.precinct && !document.activeElement?.closest?.('#side form')) renderSide();
  }).subscribe();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadSeats(); });
}
addEventListener('resize', () => map.invalidateSize());
})();
