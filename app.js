'use strict';
// PL Table PWA — Made by Danny G. Data: ESPN (CORS-enabled public JSON) + FotMob ratings. No keys, no server.
const COMPS = [
  { slug: 'eng.1', label: 'Premier League', title: 'PL Table' },
  { slug: 'eng.2', label: 'Championship', title: 'Championship' },
  { slug: 'uefa.champions', label: 'Champions League', title: 'Champions League' },
  { slug: 'sco.1', label: 'Scottish Prem', title: 'Scottish Premiership' },
  { slug: 'eng.fa', label: 'FA Cup', title: 'FA Cup', cup: true },
];
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues/';
const UK = 'Europe/London';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: (k, d) => { try { const v = localStorage.getItem('plt.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  // try/catch: Safari private mode / storage-disabled must not break the click handler (state still applies for this session)
  set: (k, v) => { try { localStorage.setItem('plt.' + k, JSON.stringify(v)); } catch {} },
};

const S = {
  comp: COMPS[0], season: null, current: null, standings: null, leaders: null, ratings: null, ratingsNone: false,
  matches: null, news: null, cup: null, cupLeaders: null, cupShown: null, clubs: [], error: null, loading: false,
  fav: store.get('fav', null), bg: store.get('bg', 'trophy'), preds: store.get('preds', {}),
  tab: 'Table', results: false, newsMode: 0, liveOn: true, updated: null,
};

// ---------- helpers ----------
async function getJSON(url) {
  const r = await fetch(url.replace(/^http:/, 'https:'));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const small = u => { if (!u) return null; const i = u.indexOf('espncdn.com/i/'); return i < 0 ? u : 'https://a.espncdn.com/combiner/i?img=' + u.slice(i + 11) + '&w=96&h=96'; };
const hex = c => c ? '#' + String(c).replace(/^#+/, '') : null;
const fmt = (d, o) => new Intl.DateTimeFormat('en-GB', { timeZone: UK, ...o }).format(d);
const kick = d => fmt(d, { hour: '2-digit', minute: '2-digit' });
const day = d => fmt(d, { weekday: 'long', day: 'numeric', month: 'long' });
const ago = d => { if (!d) return ''; const s = (Date.now() - d) / 1000; return s < 3600 ? Math.max(1, s / 60 | 0) + 'm ago' : s < 86400 ? (s / 3600 | 0) + 'h ago' : (s / 86400 | 0) + 'd ago'; };
const seasonLabel = y => y + '/' + String((y + 1) % 100).padStart(2, '0');
const ord = n => n + ([, 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
const parseDate = s => s ? new Date(s.length === 17 ? s.slice(0, 16) + ':00Z' : s) : null;
const img = (u, cls = 'badge', alt = '') => u ? `<img class="${cls}" src="${esc(u)}" alt="${esc(alt)}" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="${cls}"></span>`;
const favColor = () => { const c = S.fav?.color; if (!c) return '#E90052'; const n = parseInt(c.slice(1), 16), l = (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; return l < 0.12 || l > 0.92 ? '#E90052' : c; };
const isFav = id => S.fav && S.fav.id === id;
const yearNow = () => { const d = new Date(); return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; };

// ---------- data ----------
async function standings(season, league) {
  const d = await getJSON(`https://site.api.espn.com/apis/v2/sports/soccer/${league}/standings` + (season ? '?season=' + season : ''));
  const g = d.children?.[0]; if (!g) throw new Error('No table for that season');
  const rows = g.standings.entries.map(e => {
    const s = {}; e.stats.forEach(x => { if (x.value != null) s[x.name] = x.value; });
    const t = e.team;
    return { pos: s.rank | 0, id: t.id, team: t.displayName, short: t.shortDisplayName || t.displayName, abbr: t.abbreviation, logo: small(t.logos?.[0]?.href),
      p: s.gamesPlayed | 0, w: s.wins | 0, d: s.ties | 0, l: s.losses | 0, gd: s.pointDifferential | 0, pts: s.points | 0,
      zone: hex(e.note?.color), zoneLabel: e.note?.description || null };
  }).sort((a, b) => (a.pos || 999) - (b.pos || 999) || b.pts - a.pts);
  return { year: g.standings.season, name: g.name, rows };
}
const athletes = new Map();
async function leaders(season, teams, league) {
  const d = await getJSON(`${CORE}${league}/seasons/${season}/types/1/leaders?limit=20`);
  const out = { goals: [], assists: [] };
  for (const c of d.categories || []) {
    const key = c.name === 'goalsLeaders' ? 'goals' : c.name === 'assistsLeaders' ? 'assists' : null; if (!key) continue;
    let last = -1, rank = 0;
    out[key] = await Promise.all(c.leaders.map(async (l, i) => {
      const ref = l.athlete?.$ref; let a = athletes.get(ref);
      if (!a) { a = getJSON(ref).then(x => ({ name: x.displayName, photo: x.headshot?.href })).catch(() => ({ name: 'Unknown player' })); athletes.set(ref, a); }
      a = await a;
      const v = l.value | 0; if (v !== last) { rank = i + 1; last = v; }
      const teamId = (l.team?.$ref || '').split('/teams/')[1]?.split('?')[0] || '';
      const m = /M:\s*(\d+)/.exec(l.shortDisplayValue || '');
      const t = teams[teamId] || {};
      return { rank, name: a.name, photo: a.photo, teamId, team: t.short || '', logo: t.logo, apps: m ? +m[1] : null, value: v };
    }));
  }
  return out;
}
function parseEvent(e) {
  const c = e.competitions[0], type = e.status.type;
  let state = { pre: 'pre', in: 'live', post: 'post' }[type.state] || 'other';
  const side = w => { const t = c.competitors.find(x => x.homeAway === w); const tm = t.team;
    return { id: tm.id, name: tm.shortDisplayName || tm.displayName, abbr: tm.abbreviation, logo: small(tm.logo), score: t.score ?? null, win: !!t.winner, pens: t.shootoutScore ?? null }; };
  const done = ['STATUS_FULL_TIME', 'STATUS_FINAL_AET', 'STATUS_FINAL_PEN', 'STATUS_FULL_PEN', 'STATUS_FINAL'];
  if (state === 'post' && !done.includes(type.name) && !type.completed) state = 'other';
  return { id: e.id, ko: parseDate(e.date), state, status: type.shortDetail || '', home: side('home'), away: side('away'),
    venue: c.venue?.fullName, round: e.season?.slug, note: c.notes?.[0]?.headline };
}
async function months(list, league) {
  const all = (await Promise.all(list.map(([y, m]) => getJSON(`${SITE}${league}/scoreboard?dates=${y}${String(m).padStart(2, '0')}`)
    .then(d => (d.events || []).map(e => { try { return parseEvent(e); } catch { return null; } }).filter(Boolean)).catch(() => [])))).flat();
  const seen = new Set(); return all.filter(m => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => a.ko - b.ko);
}
async function matches(season, current, league) {
  if (current) {
    const now = new Date(), list = [];
    for (let i = -2; i <= 1; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); list.push([d.getFullYear(), d.getMonth() + 1]); }
    const all = await months(list, league);
    const live = all.filter(m => m.state === 'live');
    const results = all.filter(m => m.state === 'post' || (m.state === 'other' && m.ko < now)).slice(-20).reverse();
    const up = all.filter(m => m.state === 'pre' || (m.state === 'other' && m.ko >= now));
    const soon = up.filter(m => m.ko - now < 14 * 864e5);
    return { results, fixtures: soon.length >= 10 ? soon : up.slice(0, 10), live };
  }
  const all = await months([3, 4, 5, 6, 7].map(m => [season + 1, m]), league);
  return { results: all.filter(m => m.state !== 'pre').slice(-30).reverse(), fixtures: [], live: [] };
}
const transferRe = /\b(transfers?|signs?|signed|signing|deal|bid|loan|swoop|fee|move for|joins?|rumou?rs?|gossip|target|contract|talks|release clause|free agent)\b/i;
async function news(league) {
  const d = await getJSON(`${SITE}${league}/news?limit=50`);
  return (d.articles || []).filter(a => a.links?.web?.href).map(a => ({ title: a.headline, summary: a.description === a.headline ? '' : (a.description || ''),
    url: a.links.web.href, image: a.images?.[0]?.url, source: a.type === 'Media' ? 'ESPN Video' : 'ESPN', date: parseDate(a.published) }));
}
let fotPaths = null;
async function ratings(season) {
  if (!fotPaths) { const d = await getJSON('https://www.fotmob.com/api/data/leagues?id=47'); fotPaths = {}; d.stats.seasonStatLinks.forEach(l => fotPaths[l.Name] = l.RelativePath.slice(0, l.RelativePath.lastIndexOf('/') + 1)); }
  const p = fotPaths[`${season}/${season + 1}`]; if (!p) return null;
  const d = await getJSON('https://data.fotmob.com/' + p + 'rating.json');
  return d.TopLists[0].StatList.slice(0, 50).map((x, i) => ({ rank: x.Rank || i + 1, id: x.ParticiantId || x.ParticipantId, name: x.ParticipantName, team: x.TeamName, rating: x.StatValue, apps: x.MatchesPlayed, mins: x.MinutesPlayed }));
}
const fotPhoto = id => `https://images.fotmob.com/image_resources/playerimages/${id}.png`;
async function clubs() {
  // ESPN's /teams list sends no CORS header to real browsers, so build the club list from the standings (CORS-enabled).
  try {
    const st = await standings(null, 'eng.1');
    const list = st.rows.map(r => ({ id: r.id, name: r.team, short: r.short || r.team, abbr: r.abbr, color: r.color || null, logo: r.logo }));
    if (list.length) return list.sort((a, b) => a.name.localeCompare(b.name));
  } catch {}
  const d = await getJSON(SITE + 'eng.1/teams');
  return d.sports[0].leagues[0].teams.map(({ team: t }) => ({ id: t.id, name: t.displayName, short: t.shortDisplayName, abbr: t.abbreviation, color: t.color ? '#' + t.color : null, logo: small(t.logos?.[0]?.href) })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- load ----------
const league = () => S.comp.cup ? 'eng.1' : S.comp.slug;
async function refresh() {
  S.loading = true; S.error = null; render();
  try {
    const lg = league(), season = S.season;
    const st = await standings(season, lg); S.standings = st; if (!season) S.current = st.year;
    const year = season || st.year;
    const teams = {}; st.rows.forEach(r => teams[r.id] = r);
    const [m, n, l, r] = await Promise.all([
      matches(year, !season, lg).catch(() => null), news(lg).catch(() => null), leaders(year, teams, lg).catch(() => null),
      lg === 'eng.1' ? ratings(year).catch(() => 'err') : null,
    ]);
    S.matches = m; S.news = n || S.news; S.leaders = l; S.ratings = r === 'err' ? null : r; S.ratingsErr = r === 'err'; S.ratingsNone = lg === 'eng.1' && !r;
    if (S.comp.cup) await loadCup();
    settle(); S.updated = new Date();
  } catch (e) { S.error = e.message; }
  S.loading = false; render(); fillSeasons();
}
async function loadCup() {
  let y = S.season || S.current || yearNow(), ms = await months(cupMonths(y), 'eng.fa');
  if (!ms.length && !S.season) { y--; ms = await months(cupMonths(y), 'eng.fa'); }
  S.cup = ms; S.cupShown = y;
  const teams = {}; ms.forEach(m => [m.home, m.away].forEach(s => teams[s.id] = { short: s.name, logo: s.logo }));
  S.cupLeaders = await leaders(y, teams, 'eng.fa').catch(() => ({ goals: [], assists: [] }));
}
const cupMonths = y => [8, 9, 10, 11, 12].map(m => [y, m]).concat([1, 2, 3, 4, 5, 6].map(m => [y + 1, m]));

// ---------- predictions ----------
function predict(m, h, a) {
  if (Date.now() >= m.ko) return;
  S.preds[m.id] = { id: m.id, home: m.home.name, away: m.away.name, ko: +m.ko, h: Math.max(0, Math.min(20, h)), a: Math.max(0, Math.min(20, a)) };
  store.set('preds', S.preds); render();
}
const points = p => p.ah == null ? null : (p.ah === p.h && p.aa === p.a) ? 3 : Math.sign(p.ah - p.aa) === Math.sign(p.h - p.a) ? 1 : 0;
async function settle() {
  const res = S.matches?.results || []; let changed = false;
  for (const p of Object.values(S.preds)) {
    if (p.ah != null || Date.now() < p.ko + 105 * 6e4) continue;
    const m = res.find(x => x.id === p.id);
    if (m && m.state === 'post') { p.ah = +m.home.score; p.aa = +m.away.score; changed = true; continue; }
    try { const d = await getJSON(`${SITE}eng.1/summary?event=${p.id}`); const c = d.header.competitions[0];
      if (c.status.type.state === 'post') { p.ah = +c.competitors.find(x => x.homeAway === 'home').score; p.aa = +c.competitors.find(x => x.homeAway === 'away').score; changed = true; } } catch {}
  }
  if (changed) { store.set('preds', S.preds); render(); }
}

// ---------- live table ----------
function liveTable(rows, live) {
  const by = Object.fromEntries(rows.map(r => [r.id, { ...r }]));
  for (const m of live) { const h = +m.home.score, a = +m.away.score; if (isNaN(h) || isNaN(a)) continue;
    for (const [id, f, g] of [[m.home.id, h, a], [m.away.id, a, h]]) { const r = by[id]; if (!r) continue;
      r.p++; r.gd += f - g; if (f > g) { r.w++; r.pts += 3; } else if (f === g) { r.d++; r.pts++; } else r.l++; } }
  const zones = rows.map(r => [r.zone, r.zoneLabel]);
  return Object.values(by).sort((a, b) => b.pts - a.pts || b.gd - a.gd || a.pos - b.pos)
    .map((r, i) => ({ ...r, old: r.pos, pos: i + 1, zone: zones[i]?.[0], zoneLabel: zones[i]?.[1] }));
}

// ---------- render ----------
const TABS = ['Table', 'Scorers', 'Assists', 'Ratings', 'Matches', 'News', 'Predict'];
function tabs() {
  if (S.comp.cup) return ['Matches', 'Scorers', 'Assists', 'News'];
  if (S.comp.slug === 'eng.1') return TABS;
  return TABS.filter(t => t !== 'Ratings' && t !== 'Predict');
}
function renderHeader() {
  $('#title').textContent = S.comp.title;
  $('#updated').textContent = S.loading ? 'Loading…' : S.updated ? 'Updated ' + kick(S.updated) : '';
  $('#comps').innerHTML = COMPS.map((c, i) => `<button class="chip ${c === S.comp ? 'sel' : ''}" data-comp="${i}">${c.label}</button>`).join('');
  $('#favBtn').innerHTML = S.fav ? img(S.fav.logo) : '☆';
  $('#favbar').style.background = S.fav ? `linear-gradient(90deg, transparent, ${favColor()}, transparent)` : 'none';
  const colors = ['#E90052', '#00FF85', '#04F5FF', '#FFC83D', '#FF6B35', '#7B61FF', '#00E5FF'];
  $('#tabs').innerHTML = tabs().map(t => `<button class="tab ${t === S.tab ? 'sel' : ''}" data-tab="${t}" style="border-bottom-color:${t === S.tab ? colors[TABS.indexOf(t)] : 'transparent'}">${t}</button>`).join('');
  document.documentElement.style.setProperty('--fav', favColor());
  document.documentElement.style.setProperty('--favbg', favColor() + '4D');
  $('#bg').className = S.bg;
  if (S.bg === 'club') $('#bg').style.background = `linear-gradient(135deg, ${favColor()}99, #37003C 55%, ${favColor()}55)`; else $('#bg').style.background = '';
}
function fillSeasons() {
  const cur = S.current || yearNow(), sel = S.season || cur, el = $('#season');
  if (el.options.length && +el.dataset.cur === cur) { el.value = sel; return; }
  el.innerHTML = ''; for (let y = cur; y >= 2002; y--) el.add(new Option(seasonLabel(y) + (y === cur ? ' (current)' : ''), y));
  el.dataset.cur = cur; el.value = sel;
}
function render() {
  renderHeader();
  const pages = $('#pages'), ts = tabs();
  if (pages.dataset.tabs !== ts.join()) {
    pages.innerHTML = ts.map(t => `<section class="page" data-page="${t}"></section>`).join(''); pages.dataset.tabs = ts.join();
    if (!ts.includes(S.tab)) S.tab = ts[0];
    pages.scrollLeft = ts.indexOf(S.tab) * pages.clientWidth;
  }
  for (const t of ts) { const el = pages.querySelector(`[data-page="${t}"]`); const y = el.scrollTop; el.innerHTML = page(t); el.scrollTop = y; }
}
function page(t) {
  let h = '';
  if (S.error) h += `<div class="err">Couldn't load: ${esc(S.error)}. Pull to refresh with the ↻ in settings or switch competition.</div>`;
  if (S.loading && !S.standings) h += '<div class="loading">Loading…</div>';
  if (S.comp.cup) h += { Matches: cupMatches, Scorers: () => leaderList(S.cupLeaders?.goals, 'Goals', '#00FF85'), Assists: () => leaderList(S.cupLeaders?.assists, 'Assists', '#04F5FF'), News: newsPage }[t]();
  else h += { Table: tablePage, Scorers: () => leaderList(S.leaders?.goals, 'Goals', '#00FF85'), Assists: () => leaderList(S.leaders?.assists, 'Assists', '#04F5FF'), Ratings: ratingsPage, Matches: matchesPage, News: newsPage, Predict: predictPage }[t]();
  h += `<div class="foot">${t === 'Ratings' ? 'Ratings: FotMob · ' : ''}Data: ESPN</div><div class="credit"><span>Made by Danny G</span></div>`;
  return h;
}
function tablePage() {
  const st = S.standings; if (!st) return '';
  const live = !S.season ? (S.matches?.live || []) : [];
  const ids = new Set(live.flatMap(m => [m.home.id, m.away.id]));
  const rows = S.liveOn && live.length ? liveTable(st.rows, live) : st.rows;
  let h = `<span class="pill">${esc(st.name)}</span>`;
  if (live.length) h += `<div class="livebar"><span class="dot" style="background:#FF3B3B"></span>Live table · ${live.length} in progress<label><input type="checkbox" id="liveOn" ${S.liveOn ? 'checked' : ''}> on</label></div>`;
  h += `<div class="thead"><span class="pos" style="color:var(--green)">#</span><span class="team">Club</span><span class="n">P</span><span class="n">W</span><span class="n">D</span><span class="n">L</span><span class="gd">GD</span><span class="pts" style="color:var(--green)">Pts</span></div>`;
  rows.forEach((r, i) => {
    const mv = r.old != null ? r.old - r.pos : null;
    h += `<div class="trow ${i % 2 ? 'alt' : ''} ${isFav(r.id) ? 'fav' : ''}" data-club="${r.id}"><span class="zone" style="background:${r.zone || 'transparent'}"></span><div class="in">
      <span class="pos">${r.pos}</span>${mv != null ? `<span class="mv ${mv > 0 ? 'plus' : mv < 0 ? 'minus' : ''}">${mv > 0 ? '▲' : mv < 0 ? '▼' : '•'}</span>` : ''}
      ${img(r.logo)}<span class="team">${esc(r.short)}${S.liveOn && ids.has(r.id) ? ' ●' : ''}</span>
      <span class="n">${r.p}</span><span class="n">${r.w}</span><span class="n">${r.d}</span><span class="n">${r.l}</span>
      <span class="gd ${r.gd > 0 ? 'plus' : r.gd < 0 ? 'minus' : ''}">${r.gd > 0 ? '+' : ''}${r.gd}</span><span class="pts"><span class="ptsb">${r.pts}</span></span></div></div>`;
  });
  if (S.comp.slug === 'sco.1') h += `<div class="legend">After 33 rounds the league splits into top six and bottom six; each side plays five more games (38 total).</div>`;
  const zones = []; st.rows.forEach(r => r.zoneLabel && !zones.some(z => z[0] === r.zoneLabel) && zones.push([r.zoneLabel, r.zone]));
  if (zones.length) h += `<div class="legend">${zones.map(z => `<div><span class="dot" style="background:${z[1]}"></span>${esc(z[0])}</div>`).join('')}</div>`;
  return h;
}
function leaderList(list, label, color) {
  if (!list) return S.loading ? '' : `<div class="err">No ${label.toLowerCase()} data from ESPN for this season.</div>`;
  return `<span class="pill" style="border-color:${color}">Top ${label.toLowerCase()}</span>` + list.map(p => `
    <div class="card ${isFav(p.teamId) ? 'fav' : ''}" data-club="${p.teamId}"><span class="rank" style="color:${color}">${p.rank}</span>${img(p.photo, 'photo', p.name)}
      <div class="grow"><div class="name">${esc(p.name)}</div><div class="sub">${img(p.logo)}${esc(p.team)}${p.apps ? ' · ' + p.apps + ' apps' : ''}</div></div>
      <span class="val" style="border-color:${color}">${p.value}</span></div>`).join('');
}
function ratingsPage() {
  if (S.ratingsErr) return '<div class="err">Player ratings couldn\'t be loaded from FotMob in this browser. Ratings are always available in the Android app. Try ↻ Refresh later.</div>';
  if (S.ratingsNone) return '<div class="err">FotMob has no player ratings for this season.</div>';
  if (!S.ratings) return '';
  const key = s => s.toLowerCase().replace(/&/g, 'and').replace(/\b(afc|fc)\b/g, '').replace(/[^a-z]/g, '');
  return '<span class="pill" style="border-color:var(--gold)">Season average rating (FotMob)</span>' + S.ratings.map(p => {
    const fav = S.fav && (key(S.fav.name) === key(p.team) || key(S.fav.short) === key(p.team));
    const c = p.rating >= 7.5 ? '#00A86B' : p.rating >= 7 ? '#3D7BFF' : '#E07000';
    return `<div class="card ${fav ? 'fav' : ''}"><span class="rank" style="color:var(--gold)">${p.rank}</span>${img(fotPhoto(p.id), 'photo', p.name)}
      <div class="grow"><div class="name">${esc(p.name)}</div><div class="sub">${esc(p.team)} · ${p.apps} apps · ${p.mins}'</div></div>
      <span class="val" style="background:${c};border-color:${c}">${(+p.rating).toFixed(2)}</span></div>`; }).join('');
}
function matchCard(m, lg) {
  const fav = S.fav && (S.fav.id === m.home.id || S.fav.id === m.away.id);
  const side = (s, home) => `<div class="side ${home ? 'home' : ''}">${home ? '' : img(s.logo)}<span class="${s.win ? 'win' : ''}">${esc(s.name)}</span>${home ? img(s.logo) : ''}</div>`;
  const centre = m.state === 'pre' ? `<span class="ko">${kick(m.ko)}</span>` : m.state === 'other' ? `<b>${esc(m.status)}</b>`
    : `<span class="score ${m.state === 'live' ? 'live' : ''}">${esc(m.home.score ?? '-')}&nbsp; ${esc(m.away.score ?? '-')}</span>${m.state === 'live' ? `<div class="live">${esc(m.status)}</div>` : ''}`;
  const sub = [m.state === 'post' ? (m.status === 'FT' ? 'Full time' : m.status) : m.state === 'pre' ? 'Predicted XI ›' : '', m.home.pens != null ? `${m.home.pens}-${m.away.pens} pens` : '', m.venue].filter(Boolean).join(' · ');
  return `<div class="match ${fav ? 'fav' : ''}" data-match="${m.id}" data-league="${lg || ''}"><div class="mrow">${side(m.home, true)}<div class="centre">${centre}</div>${side(m.away, false)}</div>${sub ? `<div class="msub">${esc(sub)}</div>` : ''}</div>`;
}
function grouped(list, lg) {
  const g = new Map(); list.forEach(m => { const k = day(m.ko); g.has(k) || g.set(k, []); g.get(k).push(m); });
  return [...g].map(([k, ms]) => `<span class="pill">${k}</span>` + ms.map(m => matchCard(m, lg)).join('')).join('');
}
function matchesPage() {
  const m = S.matches; let h = `<div class="seg"><button data-res="0" class="${!S.results ? 'sel' : ''}">Fixtures</button><button data-res="1" class="${S.results ? 'sel' : ''}">Results</button></div>`;
  if (!m) return h;
  if (S.fav) {
    const mine = x => x.home.id === S.fav.id || x.away.id === S.fav.id;
    const next = m.live.find(mine) || m.fixtures.find(mine), last = m.results.find(mine);
    if (next) h += `<span class="pill" style="border-color:${favColor()}">★ ${esc(S.fav.short)} next</span>` + matchCard(next);
    if (last) h += `<span class="pill" style="border-color:${favColor()}">★ ${esc(S.fav.short)} last result</span>` + matchCard(last);
  }
  const list = S.results ? m.results : [...m.live, ...m.fixtures];
  return h + (list.length ? grouped(list) : `<div class="err">${S.results ? 'No results yet.' : 'No upcoming fixtures in the next few weeks.'}</div>`);
}
function cupMatches() {
  if (!S.cup) return '<div class="loading">Loading FA Cup…</div>';
  const order = ['extra-preliminary-round', 'preliminary-round', 'first-qualifying-round', 'second-qualifying-round', 'third-qualifying-round', 'fourth-qualifying-round', 'first-round', 'second-round', 'third-round', 'fourth-round', 'fifth-round', 'quarterfinals', 'semifinals', 'final'];
  const label = s => ({ quarterfinals: 'Quarter-finals', semifinals: 'Semi-finals', final: 'Final' }[s] || (s || 'other matches').split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '));
  const g = new Map(); S.cup.forEach(m => { g.has(m.round) || g.set(m.round, []); g.get(m.round).push(m); });
  let h = S.cupShown !== (S.season || S.current) ? `<div class="err">ESPN lists the FA Cup from the first round proper; showing ${seasonLabel(S.cupShown)}.</div>` : '';
  return h + [...g].sort((a, b) => order.indexOf(b[0]) - order.indexOf(a[0])).map(([r, ms]) => `<span class="pill" style="border-color:var(--gold)">${label(r)}</span>` + ms.map(m => matchCard(m, 'eng.fa')).join('')).join('');
}
function newsPage() {
  const modes = ['Latest', 'Transfers'].concat(S.fav ? ['My team'] : []);
  let h = `<div class="seg">${modes.map((m, i) => `<button data-news="${i}" class="${S.newsMode === i ? 'sel' : ''}">${m}</button>`).join('')}</div>`;
  if (!S.news) return h;
  let items = S.news;
  if (S.newsMode === 1) items = items.filter(n => transferRe.test(n.title + ' ' + n.summary));
  if (S.newsMode === 2 && S.fav) { const kw = [S.fav.name, S.fav.short].concat(S.fav.name.split(' ').filter(w => w.length > 3 && !/united|city|town|hotspur|albion|manchester|west/i.test(w))).map(w => w.toLowerCase());
    items = items.filter(n => kw.some(k => (n.title + ' ' + n.summary).toLowerCase().includes(k))); }
  if (!items.length) h += '<div class="err">Nothing here right now.</div>';
  return h + items.map(n => `<a class="news" href="${esc(n.url)}" target="_blank" rel="noopener">${n.image ? `<img src="${esc(n.image)}" loading="lazy" alt="">` : '<img alt="">'}
    <div><b>${esc(n.title)}</b>${n.summary ? `<p>${esc(n.summary)}</p>` : ''}<span class="src">${n.source} · ${ago(n.date)}</span></div></a>`).join('');
}
function predictPage() {
  const all = Object.values(S.preds), settled = all.filter(p => p.ah != null).sort((a, b) => b.ko - a.ko);
  const total = settled.reduce((s, p) => s + points(p), 0);
  let h = `<div class="phead"><div class="grow"><b style="font-size:18px">Your predictions</b><div class="sub" style="color:var(--green)">${settled.filter(p => points(p) === 3).length} exact · ${settled.filter(p => points(p) === 1).length} right result · ${settled.length} played</div><div class="sub">3 pts exact · 1 pt result · locks at kick-off · saved on this phone</div></div><span class="total">${total}</span></div>`;
  if (S.season) return h + '<div class="err">Switch to the current season to make predictions.</div>';
  const up = (S.matches?.fixtures || []).filter(m => m.state === 'pre');
  h += '<span class="pill">Upcoming fixtures</span>' + (up.length ? '' : '<div class="err">No upcoming fixtures loaded yet.</div>');
  h += up.map(m => { const p = S.preds[m.id], lock = Date.now() >= m.ko, ph = p?.h ?? 0, pa = p?.a ?? 0;
    const step = (v, w) => `<div class="step"><button ${lock ? 'disabled' : ''} data-pred="${m.id}" data-w="${w}" data-d="1">+</button><b>${v}</b><button ${lock ? 'disabled' : ''} data-pred="${m.id}" data-w="${w}" data-d="-1">−</button></div>`;
    return `<div class="pcard"><div class="sub" style="justify-content:center">${day(m.ko)} · ${kick(m.ko)}</div><div class="prow">
      <div class="pteam">${img(m.home.logo, 'badge')}${esc(m.home.name)}</div>${step(ph, 'h')}<b>–</b>${step(pa, 'a')}<div class="pteam">${img(m.away.logo, 'badge')}${esc(m.away.name)}</div></div>
      <div class="sub" style="justify-content:center;color:${lock ? 'var(--minus)' : 'var(--green)'}">${lock ? 'Locked' : p ? 'Saved ✓' : 'Tap + / − to predict'}</div></div>`; }).join('');
  if (settled.length) h += '<span class="pill" style="border-color:var(--cyan)">History</span>' + settled.map(p =>
    `<div class="hist"><span class="grow">${esc(p.home)} ${p.ah}–${p.aa} ${esc(p.away)}</span><span class="sub">you ${p.h}–${p.a}</span><b style="color:${points(p) === 3 ? 'var(--green)' : points(p) === 1 ? 'var(--cyan)' : '#fff'}">+${points(p)}</b></div>`).join('');
  return h;
}

// ---------- overlay: match details & club pages ----------
const stack = [];
function openOverlay(kind, id, lg) { stack.push({ kind, id, lg }); history.pushState({ o: stack.length }, ''); showOverlay(); }
function closeOverlay() { stack.pop(); if (stack.length) showOverlay(); else $('#overlay').hidden = true; }
async function showOverlay() {
  const top = stack[stack.length - 1]; $('#overlay').hidden = false; $('#otitle').textContent = top.kind === 'match' ? 'Match' : 'Club';
  $('#obody').innerHTML = '<div class="loading">Loading…</div>';
  try { $('#obody').innerHTML = (top.kind === 'match' ? await matchDetail(top.lg, top.id) : await clubPage(top.lg, top.id)) + '<div class="foot">Data: ESPN</div><div class="credit"><span>Made by Danny G</span></div>'; }
  catch (e) { $('#obody').innerHTML = `<div class="err">Couldn't load: ${esc(e.message)}</div>`; }
}
async function matchDetail(lg, id) {
  const d = await getJSON(`${SITE}${lg}/summary?event=${id}`), c = d.header.competitions[0];
  const side = w => { const x = c.competitors.find(y => y.homeAway === w); return { id: x.team.id, name: x.team.displayName, logo: small(x.team.logos?.[0]?.href || x.team.logo), score: x.score, pens: x.shootoutScore }; };
  const h = side('home'), a = side('away'), type = c.status.type, ko = parseDate(c.date);
  $('#otitle').textContent = `${h.name} v ${a.name}`;
  const team = s => `<div style="flex:1;text-align:center;cursor:pointer" data-club="${s.id}" data-league="${lg === 'eng.fa' ? 'eng.1' : lg}">${img(s.logo, 'badge', s.name).replace('class="badge"', 'class="badge" style="width:56px;height:56px"')}<div class="name" style="white-space:normal">${esc(s.name)}</div></div>`;
  let out = `<div class="panel"><div style="display:flex;align-items:center">${team(h)}<div style="text-align:center"><div class="big">${esc(h.score ?? '-')} – ${esc(a.score ?? '-')}</div>${h.pens != null ? `<div class="sub" style="justify-content:center">Pens ${h.pens}–${a.pens}</div>` : ''}<div class="sub" style="justify-content:center;color:${type.state === 'in' ? '#FF6B6B' : ''}">${esc(type.detail || type.shortDetail)}</div></div>${team(a)}</div>
    <div class="sub" style="justify-content:center;margin-top:8px">${ko ? day(ko) + ' · ' + kick(ko) + ' UK' : ''}${d.gameInfo?.venue?.fullName ? ' · ' + esc(d.gameInfo.venue.fullName) : ''}</div></div>`;
  const ev = (d.keyEvents || []).filter(k => !/Delay/.test(k.type?.text || ''));
  if (ev.length) out += '<span class="pill">Key events</span><div class="panel">' + ev.map(k => {
    const kind = k.type?.text || '', ps = (k.participants || []).map(p => p.athlete?.displayName).filter(Boolean);
    const icon = k.scoringPlay || /goal/i.test(kind) ? '⚽' : /yellow/i.test(kind) ? '🟨' : /red/i.test(kind) ? '🟥' : /sub/i.test(kind) ? '🔄' : '•';
    const txt = kind === 'Substitution' && ps.length > 1 ? `${ps[0]} on, ${ps[1]} off` : ps.join(', ') || kind;
    return `<div class="ev ${k.team?.id === a.id ? 'away' : ''}" style="${k.scoringPlay ? 'font-weight:700' : ''}">${esc(k.clock?.displayValue || '')} ${icon} ${esc(txt)}</div>`; }).join('') + '</div>';
  const box = d.boxscore?.teams || [], st = id => Object.fromEntries((box.find(t => t.team.id === id)?.statistics || []).map(s => [s.name, s.displayValue]));
  const hs = st(h.id), as = st(a.id);
  const labels = [['possessionPct', 'Possession %'], ['totalShots', 'Shots'], ['shotsOnTarget', 'Shots on target'], ['wonCorners', 'Corners'], ['foulsCommitted', 'Fouls'], ['offsides', 'Offsides'], ['yellowCards', 'Yellow cards'], ['redCards', 'Red cards'], ['saves', 'Saves'], ['totalPasses', 'Passes']];
  const rows = labels.filter(([k]) => hs[k] != null && as[k] != null);
  if (rows.length) out += '<span class="pill" style="border-color:var(--cyan)">Team stats</span><div class="panel">' + rows.map(([k, l]) => `<div class="stat"><b>${esc(hs[k])}</b><span>${l}</span><b>${esc(as[k])}</b></div>`).join('') + '</div>';
  out += '<div id="xi" class="panel">Loading line-ups…</div>'; setTimeout(() => initXi(lg, id, d, h, a), 0);
  for (const s of [h, a]) { const r = (d.rosters || []).find(x => x.team?.id === s.id); if (!r?.roster?.length) continue;
    const ps = r.roster.slice().sort((x, y) => (y.starter - x.starter) || ((+x.jersey || 99) - (+y.jersey || 99)));
    out += `<span class="pill" style="border-color:var(--gold)">${esc(s.name)} line-up${r.formation ? ' · ' + esc(r.formation) : ''}</span><div class="panel">` + ps.map(p =>
      `<div class="lp" style="${p.starter ? '' : 'opacity:.7'}"><span class="j">${esc(p.jersey)}</span><span class="grow">${esc(p.athlete?.displayName)}</span><span class="sub">${esc(p.position?.abbreviation || '')}</span>${p.subbedIn ? '<span class="plus">↑</span>' : ''}${p.subbedOut ? '<span class="minus">↓</span>' : ''}</div>`).join('') + '</div>'; }
  return out;
}
async function clubPage(lg, id) {
  const [t, past, next, roster] = await Promise.all([getJSON(`${SITE}${lg}/teams/${id}`).then(x => x.team),
    getJSON(`${SITE}${lg}/teams/${id}/schedule`).catch(() => null), getJSON(`${SITE}${lg}/teams/${id}/schedule?fixture=true`).catch(() => null), getJSON(`${SITE}${lg}/teams/${id}/roster`).catch(() => null)]);
  $('#otitle').textContent = t.displayName;
  const row = S.standings?.rows.find(r => r.id === id);
  let out = `<div class="panel" style="display:flex;align-items:center;gap:14px">${img(small(t.logos?.[0]?.href), 'badge').replace('class="badge"', 'class="badge" style="width:64px;height:64px"')}<div>
    <div style="font-size:22px;font-weight:900">${esc(t.displayName)}</div>${t.standingSummary ? `<div style="color:rgba(255,255,255,.85);font-weight:700">${esc(t.standingSummary)}</div>` : ''}
    ${row ? `<div class="sub">P${row.p} W${row.w} D${row.d} L${row.l} · GD ${row.gd} · ${row.pts} pts</div>` : ''}</div></div>`;
  const score = x => x.score?.displayValue ?? x.score ?? '';
  const form = (past?.events || []).filter(e => e.competitions[0].status.type.state === 'post').map(e => {
    const cs = e.competitions[0].competitors, me = cs.find(x => x.team.id === id), op = cs.find(x => x.team.id !== id); if (!me || !op) return null;
    const a = +score(me), b = +score(op); return { r: a > b ? 'W' : a < b ? 'L' : 'D', opp: op.team.shortDisplayName || op.team.displayName, s: `${score(me)}-${score(op)}`, home: me.homeAway === 'home', id: e.id, date: parseDate(e.date) };
  }).filter(Boolean).sort((a, b) => b.date - a.date).slice(0, 5);
  if (form.length) out += '<span class="pill">Form (latest first)</span><div class="panel"><div class="form">' + form.map(f =>
    `<div data-match="${f.id}" data-league="${lg}"><b style="background:${f.r === 'W' ? '#00A86B' : f.r === 'L' ? '#E90052' : '#777'}">${f.r}</b>${f.home ? 'vs' : 'at'} ${esc(f.opp)}<br><b style="display:inline;background:none;width:auto;height:auto;font-size:12px">${f.s}</b></div>`).join('') + '</div></div>';
  const up = (next?.events || []).map(e => { try { const c = e.competitions[0]; const side = w => { const x = c.competitors.find(y => y.homeAway === w); return { id: x.team.id, name: x.team.shortDisplayName || x.team.displayName, logo: small(x.team.logos?.[0]?.href), score: null }; };
    return { id: e.id, ko: parseDate(e.date), state: 'pre', status: '', home: side('home'), away: side('away'), venue: c.venue?.fullName }; } catch { return null; } }).filter(m => m && m.ko > Date.now() - 3 * 36e5).slice(0, 5);
  if (up.length) out += '<span class="pill" style="border-color:var(--cyan)">Upcoming</span>' + up.map(m => matchCard(m, lg)).join('');
  const groups = { G: 'Goalkeepers', D: 'Defenders', M: 'Midfielders', F: 'Forwards' };
  const sq = (roster?.athletes || []).map(a => ({ name: a.displayName, j: a.jersey, pos: a.position?.abbreviation || '?', age: a.age, nat: a.citizenship, photo: a.headshot?.href }));
  if (sq.length) { out += `<span class="pill" style="border-color:var(--gold)">Squad (${sq.length})</span><div class="panel">`;
    for (const [k, label] of Object.entries(groups).concat([['?', 'Other']])) { const ps = sq.filter(p => (groups[p.pos[0]] ? p.pos[0] : '?') === k).sort((a, b) => (+a.j || 99) - (+b.j || 99)); if (!ps.length) continue;
      out += `<div style="color:var(--green);font-weight:900;margin:10px 0 4px">${label}</div>` + ps.map(p => `<div class="lp"><span class="j">${esc(p.j || '')}</span><span class="grow">${esc(p.name)}</span><span class="sub">${esc([p.nat, p.age].filter(Boolean).join(' · '))}</span></div>`).join(''); }
    out += '</div>'; }
  return out;
}

// ---------- dialogs ----------
function dialog(html) { $('#dialog').innerHTML = `<div class="dbox">${html}<button class="dbtn" data-close>Done</button></div>`; $('#dialog').hidden = false; }
async function favDialog() {
  if (!S.clubs.length) { dialog('<h3>Pick your team</h3><div class="loading">Loading clubs…</div>'); S.clubs = await clubs().catch(() => []); }
  if (!S.clubs.length) { dialog('<h3>Pick your team</h3><div class="err">Couldn\'t load the club list. Check your connection.</div><button class="dbtn" data-favretry>Try again</button>'); return; }
  dialog('<h3>Pick your team</h3><div class="opt" data-fav="">No favourite</div>' + S.clubs.map(c => `<div class="opt ${isFav(c.id) ? 'sel' : ''}" data-fav="${c.id}">${img(c.logo)}${esc(c.name)}${isFav(c.id) ? ' ★' : ''}</div>`).join(''));
}
function settingsDialog() {
  const bgs = [['trophy', 'Trophy'], ['pitch', 'Pitch'], ['stadium', 'Stadium night'], ['club', 'Club colours'], ['plain', 'Plain']];
  dialog(`<h3>Settings</h3><b>Background</b>${bgs.map(([k, l]) => `<div class="opt ${S.bg === k ? 'sel' : ''}" data-bg="${k}">${l}</div>`).join('')}
    <button class="dbtn" data-refresh>↻ Refresh data</button>
    <p class="sub" style="margin-top:14px"><b style="color:#fff">About</b></p><p class="sub">PL Table (web) v2.4.1 · Made by Danny G</p>
    <p class="sub">Install: in Safari tap Share → Add to Home Screen. Favourites and predictions are saved on this device.</p>`);
}

// ---------- events ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-comp],[data-tab],[data-club],[data-match],[data-res],[data-news],[data-pred],[data-fav],[data-bg],[data-close],[data-refresh],[data-favretry]');
  if (!t) return;
  const d = t.dataset;
  if (d.comp != null) { const c = COMPS[+d.comp]; if (c === S.comp) return; const oldLg = league(); S.comp = c;
    if (league() !== oldLg) { S.standings = S.leaders = S.matches = S.ratings = S.news = null; refresh(); } else if (c.cup && !S.cup) loadCup().then(render); render(); }
  else if (d.tab) { S.tab = d.tab; const i = tabs().indexOf(d.tab); $('#pages').scrollTo({ left: i * $('#pages').clientWidth, behavior: 'smooth' }); renderHeader(); }
  else if (d.club && d.match == null) openOverlay('club', d.club, d.league || (S.comp.cup ? 'eng.1' : S.comp.slug));
  else if (d.match) openOverlay('match', d.match, d.league || (S.comp.cup ? 'eng.fa' : S.comp.slug));
  else if (d.res) { S.results = d.res === '1'; render(); }
  else if (d.news) { S.newsMode = +d.news; render(); }
  else if (d.pred) { const m = S.matches.fixtures.find(x => x.id === d.pred), p = S.preds[d.pred] || { h: 0, a: 0 }; const h = p.h + (d.w === 'h' ? +d.d : 0), a = p.a + (d.w === 'a' ? +d.d : 0); predict(m, h, a); }
  else if (d.fav != null) { S.fav = S.clubs.find(c => c.id === d.fav) || null; store.set('fav', S.fav); store.set('asked', true); $('#dialog').hidden = true; render(); }
  else if (d.bg) { S.bg = d.bg; store.set('bg', d.bg); settingsDialog(); renderHeader(); }
  else if (d.refresh != null) { $('#dialog').hidden = true; refresh(); }
  else if (d.favretry != null) favDialog();
  else if (d.close != null) { $('#dialog').hidden = true; store.set('asked', true); }
});
document.addEventListener('change', e => { if (e.target.id === 'liveOn') { S.liveOn = e.target.checked; render(); } });
$('#season').addEventListener('change', e => { const y = +e.target.value; S.season = y === S.current ? null : y; S.standings = S.leaders = S.matches = S.ratings = S.cup = null; refresh(); });
$('#favBtn').onclick = favDialog;
$('#setBtn').onclick = settingsDialog;
$('#back').onclick = () => history.back();
window.addEventListener('popstate', () => { if (stack.length) closeOverlay(); });
let scrollT;
$('#pages').addEventListener('scroll', () => { clearTimeout(scrollT); scrollT = setTimeout(() => { const i = Math.round($('#pages').scrollLeft / $('#pages').clientWidth), t = tabs()[i]; if (t && t !== S.tab) { S.tab = t; renderHeader(); document.querySelector('.tab.sel')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } }, 80); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.updated && Date.now() - S.updated > 5 * 6e4) refresh(); });
setInterval(() => { if (!document.hidden && S.matches?.live?.length && !S.season) refresh(); }, 60000);

// install hint for iOS Safari (not already standalone)
const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !standalone && !store.get('hintDone', false)) $('#install').hidden = false;
$('#installX').onclick = () => { $('#install').hidden = true; store.set('hintDone', true); };
if ('serviceWorker' in navigator) {
  // When a new service worker takes over (new deploy), reload once so the fresh JS/CSS is used.
  const hadCtrl = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadCtrl && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
}

fillSeasons(); render(); refresh();
if (!store.get('asked', false)) favDialog();

// ---------- Line-ups: Predicted XI always, Confirmed when announced, My XI ----------
// FotMob's predicted-XI endpoint doesn't allow cross-origin requests, so the web app's prediction is
// "Our predicted XI": each team's starting XI from its most recent completed match (clearly labelled estimate).
const FORMS = ['4-3-3', '4-2-3-1', '4-4-2', '4-1-4-1', '3-5-2', '3-4-3', '3-4-2-1', '5-3-2', '5-4-1'];
function xiLayout(formation, st) {
  const cat = p => p.startsWith('G') ? 0 : p.startsWith('DM') ? 1.5 : (p.includes('B') || p.startsWith('CD') || p.startsWith('D')) ? 1 : p.startsWith('AM') ? 2.5 : (p.startsWith('F') || p.startsWith('S') || p.startsWith('CF')) ? 3 : 2;
  const side = p => (p.endsWith('-L') || p.startsWith('L')) ? 0 : (p.endsWith('-R') || p.startsWith('R')) ? 2 : 1;
  const idx = st.map((_, i) => i).sort((x, y) => (cat(st[x].pos) - cat(st[y].pos)) || (side(st[x].pos) - side(st[y].pos)));
  const gk = idx.find(i => cat(st[i].pos) === 0) ?? idx[0], of = idx.filter(i => i !== gk);
  let lines = (formation || '').split('-').map(Number).filter(n => n > 0);
  if (lines.reduce((x, y) => x + y, 0) !== of.length) lines = of.length === 10 ? [4, 4, 2] : [of.length];
  const out = [{ ...st[gk], x: .5, y: .08 }]; let k = 0;
  lines.forEach((n, li) => { const ch = of.slice(k, k + n).sort((x, y) => side(st[x].pos) - side(st[y].pos)); k += n;
    ch.forEach((s, i) => out.push({ ...st[s], x: (i + 1) / (ch.length + 1), y: .08 + (li + 1) * (.84 / lines.length) })); });
  return { formation, players: out };
}
function xiFromRoster(r) {
  const st = (r?.roster || []).filter(p => p.starter).map(p => ({ name: p.athlete?.displayName || '', num: p.jersey, pos: p.position?.abbreviation || '' }));
  return st.length === 11 ? xiLayout(r.formation, st) : null;
}
async function xiEstimate(lg, teamId) {
  const l = lg === 'eng.fa' ? 'eng.1' : lg;
  const ev = (await getJSON(`${SITE}${l}/teams/${teamId}/schedule`)).events || [];
  const last = ev.filter(e => e.competitions?.[0]?.status?.type?.state === 'post').sort((x, y) => y.date.localeCompare(x.date))[0];
  if (!last) return null;
  const d = await getJSON(`${SITE}${l}/summary?event=${last.id}`);
  return xiFromRoster((d.rosters || []).find(r => r.team?.id === teamId));
}
function mineXi(f, names) {
  const lines = f.split('-').map(Number), out = [{ name: names[0], x: .5, y: .08 }]; let k = 1;
  lines.forEach((n, li) => { const ch = names.slice(k, k + n); k += n; ch.forEach((nm, i) => out.push({ name: nm, x: (i + 1) / (ch.length + 1), y: .08 + (li + 1) * (.84 / lines.length) })); });
  return { formation: f, players: out };
}
function pitchHtml(t) {
  return `<div class="xipitch">${t.players.map(p => `<div class="pp" style="left:${(p.x * 100).toFixed(1)}%;top:${((1 - p.y) * 100).toFixed(1)}%"><span class="pn">${esc(p.num || '')}</span><span class="pl">${esc((p.name || '').split(' ').pop())}</span></div>`).join('')}</div>`;
}
async function initXi(lg, id, d, h, a) {
  const box = document.getElementById('xi'); if (!box) return;
  const conf = { h: xiFromRoster((d.rosters || []).find(r => r.team?.id === h.id)), a: xiFromRoster((d.rosters || []).find(r => r.team?.id === a.id)) };
  const hasConf = !!(conf.h || conf.a);
  const st = { kind: hasConf ? 'c' : 'p', home: true, pred: null, edit: false, picked: [], form: '4-3-3', squad: null };
  const key = () => `myxi.${id}.${st.home ? h.id : a.id}`;
  const mine = () => { try { return JSON.parse(localStorage.getItem(key()) || 'null'); } catch { return null; } };
  const chip = (k, v, label, sel) => `<button class="chip${sel ? ' on' : ''}" data-x${k}="${v}">${esc(label)}</button>`;
  const draw = () => {
    if (!document.body.contains(box)) return;
    let html = '<div class="xih">Line-ups</div><div class="chips">' + (hasConf ? chip('k', 'c', 'Confirmed', st.kind === 'c') : '') + chip('k', 'p', 'Predicted', st.kind === 'p') + chip('k', 'm', 'My XI', st.kind === 'm') + '</div>'
      + '<div class="chips">' + chip('t', 'h', h.name, st.home) + chip('t', 'a', a.name, !st.home) + '</div>';
    if (st.edit) {
      html += `<div class="sub">Tap players in order: goalkeeper first, then defenders → attackers. (${st.picked.length}/11)</div><div class="chips">${FORMS.map(f => chip('f', f, f, f === st.form)).join('')}</div>`
        + (st.squad ? st.squad.map(p => { const i = st.picked.indexOf(p.name); return `<div class="lp${i >= 0 ? ' picked' : ''}" data-xp="${esc(p.name)}"><span class="j">${i >= 0 ? i + 1 : ''}</span><span class="grow">${esc(p.name)}</span><span class="sub">${esc(p.pos)}</span></div>`; }).join('') : '<div class="loading">Loading squad…</div>')
        + `<div class="chips"><button class="chip on" data-xsave="1" ${st.picked.length === 11 ? '' : 'disabled'}>Save</button><button class="chip" data-xcancel="1">Cancel</button></div>`;
      box.innerHTML = html; return;
    }
    let t = null, label;
    if (st.kind === 'c') { t = st.home ? conf.h : conf.a; label = '<div class="xil" style="color:var(--green)">Confirmed line-ups (ESPN)</div>'; }
    else if (st.kind === 'm') { const m = mine(); t = m && mineXi(m.f, m.p); label = '<div class="xil">Your own predicted XI (saved in this browser)</div>'; }
    else { t = st.pred && (st.home ? st.pred.h : st.pred.a);
      label = `<div class="xil">${st.pred ? "Our predicted XI — estimate from each team's last starting line-up, not official" : 'Loading predicted XI…'}</div><div class="xiw">PREDICTION — not the official team sheet</div>`; }
    html += label + (t?.formation ? `<div class="sub">Formation ${esc(t.formation)}</div>` : '')
      + (t ? pitchHtml(t) : `<div class="sub" style="padding:12px 0">${st.kind === 'm' ? "You haven't picked an XI for this team yet." : st.kind === 'p' && !st.pred ? 'Loading…' : 'No line-up available for this team yet.'}</div>`)
      + (st.kind === 'm' ? `<button class="chip on" data-xedit="1">${mine() ? 'Edit my XI' : 'Pick my XI'}</button>` : '');
    box.innerHTML = html;
  };
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-xk],[data-xt],[data-xf],[data-xp],[data-xsave],[data-xcancel],[data-xedit]'); if (!b) return; e.stopPropagation();
    if (b.dataset.xk) st.kind = b.dataset.xk;
    if (b.dataset.xt) { st.home = b.dataset.xt === 'h'; if (st.edit) st.edit = false; }
    if (b.dataset.xf) st.form = b.dataset.xf;
    if (b.dataset.xp) { const n = b.dataset.xp, i = st.picked.indexOf(n); if (i >= 0) st.picked.splice(i, 1); else if (st.picked.length < 11) st.picked.push(n); }
    if (b.dataset.xcancel) st.edit = false;
    if (b.dataset.xsave && st.picked.length === 11) { localStorage.setItem(key(), JSON.stringify({ f: st.form, p: st.picked })); st.edit = false; }
    if (b.dataset.xedit) { const m = mine(); st.edit = true; st.form = m?.f || '4-3-3'; st.picked = m?.p?.slice() || []; st.squad = null; draw();
      const tid = st.home ? h.id : a.id, l = lg === 'eng.fa' ? 'eng.1' : lg;
      const r = await getJSON(`${SITE}${l}/teams/${tid}/roster`).catch(() => null);
      st.squad = (r?.athletes || []).map(x => ({ name: x.displayName, pos: x.position?.abbreviation || '' })); }
    draw();
  });
  draw();
  const [eh, ea] = await Promise.all([xiEstimate(lg, h.id).catch(() => null), xiEstimate(lg, a.id).catch(() => null)]);
  st.pred = { h: eh, a: ea }; draw();
}
