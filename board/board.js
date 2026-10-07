(() => {
  'use strict';
  const LS = {
    get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} }
  };
  const cfg = () => ({
    repo: LS.get('kb_repo', ''), branch: LS.get('kb_branch', 'master'), path: LS.get('kb_path', 'board/tasks.json'),
    token: LS.get('kb_token'), me: LS.get('kb_me', ''), api: LS.get('kb_api', 'https://api.github.com') // api override is for local testing only
  });
  // Optional first-run prefill from the link: ?repo=owner/name&branch=main&path=tasks.json (never the token)
  (() => { const q = new URLSearchParams(location.search);
    ['repo', 'branch', 'path'].forEach(k => { const v = q.get(k); if (!v || LS.get('kb_' + k)) return;
      if (k === 'repo' ? /^[\w.-]+\/[\w.-]+$/.test(v) : /^[\w./-]+$/.test(v)) LS.set('kb_' + k, v); }); })();
  // ---- move settings between browsers/devices: one pasteable code or a setup link (token included) --------------
  const XFER = { text: ['repo', 'branch', 'path', 'me', 'token', 'collapsed', 'undated', 'tab'], pick: { theme: ['auto', 'light', 'dark', 'midnight', 'sand'], style: ['classic', 'colorful'], view: ['board', 'list', 'cal', 'sched'] } };
  const xEnc = o => { const b = new TextEncoder().encode(JSON.stringify(o)); let s = ''; b.forEach(c => s += String.fromCharCode(c)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const xDec = t => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
  function exportCode() { const o = {}; XFER.text.concat(Object.keys(XFER.pick)).forEach(k => { const v = LS.get('kb_' + k, null); if (v !== null && v !== '') o[k] = v; }); return 'kbcfg1.' + xEnc(o); }
  function parseCode(raw) {
    const m = /kbcfg1\.([A-Za-z0-9_-]+)/.exec(String(raw || '')); if (!m) throw new Error('That is not a board settings code.');
    const o = xDec(m[1]), out = {};
    XFER.text.forEach(k => { if (typeof o[k] === 'string' && o[k].length < 600) out[k] = o[k]; });
    Object.keys(XFER.pick).forEach(k => { if (XFER.pick[k].includes(o[k])) out[k] = o[k]; });
    if (out.repo && !/^[\w.-]+\/[\w.-]+$/.test(out.repo)) delete out.repo;
    if (out.branch && !/^[\w./-]+$/.test(out.branch)) delete out.branch;
    if (out.path && !/^[\w./-]+$/.test(out.path)) delete out.path;
    if (!Object.keys(out).length) throw new Error('No usable settings found in that code.');
    return out;
  }
  function applyCode(raw) { const o = parseCode(raw); Object.keys(o).forEach(k => LS.set('kb_' + k, o[k])); return o; }
  // setup link: the code rides in the #fragment, which browsers never send to any server; it is stripped straight away
  (() => { const m = /[#&]kbcfg=([^&]+)/.exec(location.hash); if (!m) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch {}
    try { const o = parseCode('kbcfg1.' + m[1]);
      if (confirm(`Import board settings${o.repo ? ' for ' + o.repo : ''}${o.token ? ', including the access token' : ''}?\n\nThis replaces the settings stored in this browser.`)) { applyCode('kbcfg1.' + m[1]); location.reload(); }
    } catch (e) { alert('Could not import the settings link: ' + e.message); } })();
  const DEFAULT = () => ({
    version: 2, settings: { stale_after_minutes: 30 },
    columns: [{ id: 'backlog', name: 'Backlog' }, { id: 'todo', name: 'To do' }, { id: 'in-progress', name: 'In progress' }, { id: 'done', name: 'Done' }],
    people: [], agents: ['claude', 'codex'], clients: ['General'], labels: [], tasks: []
  });

  let state = DEFAULT(), sha = null, etag = null, busy = false, lastSyncOk = false;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const b64e = s => { const b = new TextEncoder().encode(s); let r = ''; b.forEach(x => r += String.fromCharCode(x)); return btoa(r); };
  const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
  const clone = o => JSON.parse(JSON.stringify(o));
  const nowIso = () => new Date().toISOString();
  const setStatus = (m, k = '') => { const s = $('status'); s.textContent = m; s.className = k; const r = $('btnRefresh'); if (r) r.title = m + ' (click to reload)'; };
  const safeUrl = u => { try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null; } catch { return null; } };

  function linkify(parent, text) { // build DOM (no innerHTML): plain text plus safe http(s) links
    String(text || '').split(/(https?:\/\/[^\s<>"')]+)/g).forEach((part, i) => {
      if (i % 2 === 1 && safeUrl(part)) { const a = el('a', null, part); a.href = safeUrl(part); a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a); }
      else if (part) parent.append(document.createTextNode(part));
    });
  }

  function normalise(obj) {
    const d = DEFAULT(), o = obj && typeof obj === 'object' ? obj : {};
    const people = Array.isArray(o.people) ? o.people : [];
    const n = {
      version: 2, settings: Object.assign(d.settings, o.settings || {}),
      columns: Array.isArray(o.columns) && o.columns.length ? o.columns : d.columns, people,
      agents: Array.isArray(o.agents) ? o.agents : d.agents, clients: Array.isArray(o.clients) && o.clients.length ? o.clients : d.clients,
      labels: Array.isArray(o.labels) ? o.labels : [], tasks: Array.isArray(o.tasks) ? o.tasks : []
    };
    n.tasks.forEach(t => { // tolerate v1 cards
      if (!Array.isArray(t.assignees)) { const p = people.find(p => p.name === t.owner || p.github === t.owner); t.assignees = p ? [p.github] : []; }
      if (!Array.isArray(t.labels)) t.labels = []; if (!Array.isArray(t.links)) t.links = []; if (!Array.isArray(t.contacts)) t.contacts = [];
      if (t.details == null) t.details = t.notes || '';
      if (t.claim === undefined) t.claim = null;
      if (!Array.isArray(t.comments)) t.comments = []; if (!Array.isArray(t.todos)) t.todos = []; if (!Array.isArray(t.history)) t.history = [];
      // legacy same-repo numbers become ordinary links (links can point at any repo)
      const repo = cfg().repo;
      if (t.linked_issue && repo && !t.links.some(l => /\/issues\/\d+/.test(l.url))) t.links.push({ title: 'Issue #' + t.linked_issue, url: `https://github.com/${repo}/issues/${t.linked_issue}` });
      if (t.linked_pr && repo && !t.links.some(l => /\/pull\/\d+/.test(l.url))) t.links.push({ title: 'PR #' + t.linked_pr, url: `https://github.com/${repo}/pull/${t.linked_pr}` });
      delete t.linked_issue; delete t.linked_pr;
    });
    return n;
  }

  async function gh(method, body, cond) {
    const c = cfg();
    const url = `${c.api}/repos/${c.repo}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}` + (method === 'GET' ? `?ref=${encodeURIComponent(c.branch)}` : '');
    return fetch(url, { method, cache: 'no-store', body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cond && etag ? { 'If-None-Match': etag } : {}) } });
  }

  async function load(quiet) {
    const c = cfg();
    if (!c.token) { setStatus('Not connected. Open Settings.', 'err'); render(); return false; }
    if (!quiet) setStatus('Loading…');
    try {
      const res = await gh('GET', null, !!quiet);   // background polls are conditional: a 304 is free and does not count against the rate limit
      if (res.status === 304) { setStatus('Synced ' + new Date().toLocaleTimeString() + ' (no changes)', 'ok'); return true; }
      if (res.status === 404) { await diagnose404(); return false; }
      if (res.status === 401 || res.status === 403) { setStatus('Token rejected or lacks access', 'err'); return false; }
      if (!res.ok) { setStatus(`GitHub error ${res.status}`, 'err'); return false; }
      const data = await res.json(); sha = data.sha; etag = res.headers.get('ETag'); state = normalise(JSON.parse(b64d(data.content))); lastSyncOk = true; initSeen();
      setStatus('Synced ' + new Date().toLocaleTimeString(), 'ok'); render(); return true;
    } catch (e) { console.error(e); setStatus('Network or parse error', 'err'); return false; }
  }

  // GitHub answers 404 both for a missing file and for a repo your token cannot see, so check which.
  async function diagnose404() {
    const c = cfg(), board = $('board'); board.textContent = ''; const box = el('div', 'empty');
    let repoOk = false;
    try { const r = await fetch(`${c.api}/repos/${c.repo}`, { cache: 'no-store', headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json' } }); repoOk = r.ok; } catch {}
    if (!repoOk) {
      setStatus('Repo not found / no access', 'err');
      box.append(el('p', null, `Cannot see repository "${c.repo}" with this token.`), el('p', null, 'Check: (1) the repo name in Settings, (2) the token was created with "Only select repositories" including this repo (or the right owner), (3) Contents: Read and write, (4) the token has not expired.'));
    } else {
      setStatus(`${c.path} not found`, 'err');
      box.append(el('p', null, `The repo is reachable, but "${c.path}" does not exist on branch "${c.branch}".`), el('p', null, 'Check the file path and branch in Settings (for our team board the path is board/tasks.json).'));
      const b = el('button', null, 'Create a new empty board at this path…');
      b.onclick = async () => { if (!confirm(`Create ${c.path} on ${c.branch} in ${c.repo}?`)) return; state = DEFAULT(); sha = null; await save(clone(state), 'Create board file'); render(); };
      box.append(b);
    }
    board.append(box);
  }
  function offerCreate() {
    const board = $('board'); board.textContent = ''; const box = el('div', 'empty');
    box.append(el('p', null, `${cfg().path} does not exist on ${cfg().branch} yet.`));
    const b = el('button', 'primary', 'Create it with an empty board');
    b.onclick = async () => { state = DEFAULT(); sha = null; await save(clone(state), 'Create tasks.json for board'); render(); };
    box.append(b); board.append(box);
  }

  async function save(next, message) {
    const body = { message, content: b64e(JSON.stringify(next, null, 2) + '\n'), branch: cfg().branch }; if (sha) body.sha = sha;
    const res = await gh('PUT', body);
    if (res.ok) { sha = (await res.json()).content.sha; etag = null; state = next; return 'ok'; }
    return (res.status === 409 || res.status === 422) ? 'conflict' : 'error:' + res.status;
  }

  // ---- conflict detection: what you saw (base) vs what is on GitHub now (latest) vs your change ----
  const IGNORE = new Set(['updated', 'updatedBy', 'history', 'comments']);   // comments are append-only and merge, so they never conflict
  const norm = t => { if (!t) return null; const o = {}; Object.keys(t).sort().forEach(k => { if (!IGNORE.has(k)) o[k] = t[k]; });
    if (o.claim) { o.claim = Object.assign({}, o.claim); delete o.claim.heartbeat_at; } return JSON.stringify(o); }; // heartbeats alone are not a conflict
  const byId = st => new Map(st.tasks.map(t => [t.id, t]));
  const show = v => v == null ? '(none)' : typeof v === 'string' ? (v || '(empty)') : JSON.stringify(v);
  function findConflicts(base, pre, post) {
    const B = byId(base), P = byId(pre), A = byId(post), out = [];
    new Set([...B.keys(), ...P.keys(), ...A.keys()]).forEach(id => {
      const b = B.get(id), p = P.get(id), a = A.get(id);
      if (!b) return;                                    // new card: nothing of theirs to clash with
      if (!p) { if (norm(p) !== norm(a)) out.push({ id, b, p, a }); return; }   // they deleted it, I am changing it
      const nb = JSON.parse(norm(b)), np = JSON.parse(norm(p)), na = a ? JSON.parse(norm(a)) : null;
      if (!na) { if (norm(b) !== norm(p)) out.push({ id, b, p, a }); return; }  // I am deleting something they changed
      const keys = new Set([...Object.keys(nb), ...Object.keys(np), ...Object.keys(na)]);
      // conflict only when the SAME field was changed by both of us (moving a card while someone ticks a to-do is fine)
      const clash = [...keys].some(k => JSON.stringify(np[k]) !== JSON.stringify(na[k]) && JSON.stringify(nb[k]) !== JSON.stringify(np[k]));
      if (clash) out.push({ id, b, p, a });
    });
    return out;
  }
  // Move/edit aimed at a card that someone else deleted: fn is a no-op, so detect it by id.
  function deletedUnderMe(base, pre, ids) { const B = byId(base), P = byId(pre); return ids.filter(id => B.has(id) && !P.has(id)); }
  function askConflict(list) {
    return new Promise(res => {
      const d = $('dlgConflict'), body = $('cfBody'); body.textContent = '';
      $('cfIntro').textContent = `${list.length} card${list.length > 1 ? 's' : ''} you are changing ${list.length > 1 ? 'were' : 'was'} changed by someone else (or an agent) since you loaded the board.`;
      list.forEach(({ b, p, a }) => {
        const t = a || p || b, box = el('div', 'cfcard'); box.append(el('strong', null, t.title));
        if (!p) box.append(el('div', 'cfnote', 'It was deleted by someone else.'));
        const keys = [...new Set([...Object.keys(b || {}), ...Object.keys(p || {}), ...Object.keys(a || {})])].filter(k => !IGNORE.has(k)
          && [b && b[k], p && p[k], a && a[k]].map(x => JSON.stringify(x === undefined ? null : x)).some((x, _, arr) => x !== arr[0]));
        const tb = el('table', 'cftable'), hr = el('tr'); ['Field', 'You saw', 'Now on GitHub', 'After your change'].forEach(h => hr.append(el('th', null, h))); tb.append(hr);
        keys.forEach(k => { if (k === 'claim') { const f = x => x && x.claim ? `${x.claim.agent} ${x.claim.status}${x.claim.note ? ': ' + x.claim.note : ''}` : '(none)'; const r = el('tr'); [k, f(b), f(p), f(a)].forEach(v => r.append(el('td', null, v))); tb.append(r); return; }
          const r = el('tr'); [k, show(b && b[k]), show(p && p[k]), show(a && a[k])].forEach(v => r.append(el('td', null, v))); tb.append(r); });
        box.append(tb); body.append(box);
      });
      const done = v => { d.close(); $('cfApply').onclick = $('cfDiscard').onclick = null; d.oncancel = null; res(v); };
      $('cfApply').onclick = () => done('apply'); $('cfDiscard').onclick = () => done('discard'); d.oncancel = () => done('discard');
      d.showModal();
    });
  }

  // ---- history: every change made from this page is logged on the card (the CLI logs its own) ----------
  const colName = id => (state.columns.find(c => c.id === id) || {}).name || id;
  function autoLog(pre, post) {
    const P = byId(pre), who = cfg().me || 'someone';
    post.tasks.forEach(t => {
      const p = P.get(t.id), add = text => { t.history.push({ at: nowIso(), by: who, text }); if (t.history.length > 200) t.history.splice(0, t.history.length - 200); };
      if (!p) { add('created'); return; }
      if (p.column !== t.column) add(`moved ${colName(p.column)} → ${colName(t.column)}`);
      if (p.title !== t.title) add(`renamed (was "${p.title}")`);
      if (JSON.stringify(p.assignees) !== JSON.stringify(t.assignees)) add('assignees: ' + (t.assignees.map(a => '@' + a).join(', ') || 'none'));
      if ((p.due || '') !== (t.due || '')) add('due: ' + (t.due || 'cleared'));
      if (p.priority !== t.priority) add('priority: ' + t.priority);
      if ((p.client || '') !== (t.client || '')) add('client: ' + (t.client || 'none'));
      if ((p.details || '') !== (t.details || '')) add('edited the description');
      JSON.stringify(p.labels) !== JSON.stringify(t.labels) && add('labels: ' + (t.labels.join(', ') || 'none'));
      t.links.filter(l => !p.links.some(x => x.url === l.url)).forEach(l => add('added link: ' + (l.title || l.url)));
      p.links.filter(l => !t.links.some(x => x.url === l.url)).forEach(l => add('removed link: ' + (l.title || l.url)));
      t.contacts.filter(k => !p.contacts.some(x => x.name === k.name && x.email === k.email)).forEach(k => add('added contact: ' + k.name));
      p.contacts.filter(k => !t.contacts.some(x => x.name === k.name && x.email === k.email)).forEach(k => add('removed contact: ' + k.name));
      const pm = new Map(p.todos.map(d => [d.id, d])), tm = new Map(t.todos.map(d => [d.id, d]));
      t.todos.forEach(d => { const o = pm.get(d.id); if (!o) add('added to-do: ' + d.text); else if (!o.done && d.done) add('✓ ' + d.text); else if (o.done && !d.done) add('reopened: ' + d.text); });
      p.todos.forEach(d => { if (!tm.has(d.id)) add('removed to-do: ' + d.text); });
      if (p.claim && !t.claim) add('claim released'); else if (p.claim && t.claim && p.claim.status !== t.claim.status) add('claim ' + t.claim.status);
    });
  }

  // Apply an edit to the LATEST file on GitHub (never overwrite with stale state); retry on a SHA conflict.
  async function mutate(fn, message, targetIds = [], baseState = null) {
    if (busy) { setStatus('Busy, try again', 'err'); return; }
    busy = true; const before = clone(state), base = baseState || before; let resolved = false;
    try {
      const o = clone(state); fn(o); state = o; render(); // optimistic
      for (let i = 0; i < 4; i++) {
        const res = await gh('GET');
        if (!res.ok && res.status !== 404) { setStatus(`GitHub error ${res.status}`, 'err'); state = before; render(); return; }
        let latest = DEFAULT();
        if (res.ok) { const d = await res.json(); sha = d.sha; latest = normalise(JSON.parse(b64d(d.content))); } else sha = null;
        const pre = clone(latest); fn(latest);
        if (!resolved) {
          const gone = deletedUnderMe(base, pre, targetIds);
          const conflicts = findConflicts(base, pre, latest);
          if (gone.length && !conflicts.length) {
            state = pre; render(); setStatus('That card was deleted by someone else; nothing changed', 'err'); return;
          }
          if (conflicts.length) {
            setStatus('Waiting for your decision…', 'err');
            if (await askConflict(conflicts) === 'discard') { state = pre; render(); setStatus('Kept the newer version; your change was discarded', 'ok'); return; }
            resolved = true;
          }
        }
        autoLog(pre, latest);
        const out = await save(latest, message);
        if (out === 'ok') { setStatus('Saved ' + new Date().toLocaleTimeString(), 'ok'); render(); return; }
        if (out !== 'conflict') { setStatus('Save failed (' + out + ')', 'err'); state = before; render(); return; }
        setStatus('Someone else changed the board, retrying…', 'err');
      }
      setStatus('Could not save after retries', 'err'); await load(true);
    } catch (e) { console.error(e); setStatus('Save failed', 'err'); state = before; render(); } finally { busy = false; }
  }

  const uid = () => 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const me = () => cfg().me;
  const stamp = t => { t.updated = nowIso(); if (me()) t.updatedBy = me(); };

  // ---- claims -----------------------------------------------------------
  function claimState(c) {
    if (!c) return null;
    if (c.status === 'done' || c.status === 'stuck' || c.status === 'blocked') return c.status;
    const mins = (Date.now() - Date.parse(c.heartbeat_at || c.claimed_at)) / 60000;
    return mins > (state.settings.stale_after_minutes || 30) ? 'stale' : 'running';
  }
  const ago = iso => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
  const needsAttention = t => { const cs = claimState(t.claim); const late = t.due && t.column !== 'done' && t.due < new Date().toISOString().slice(0, 10); return late || cs === 'stale' || cs === 'stuck' || cs === 'blocked'; };

  // ---- filters / render ---------------------------------------------------
  function fillSelect(sel, items, allLabel) { // items: [value,label]
    const cur = sel.value; sel.textContent = '';
    if (allLabel != null) { const o = el('option', null, allLabel); o.value = ''; sel.append(o); }
    items.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; sel.append(o); });
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  }
  // ---- colour: a card's left edge is its client, its right edge is its urgency -------------------------------
  // Any text can become a colour: hash it (FNV-1a), take the hash modulo 360 as a hue. Known clients are spaced by the golden angle
  // (137.5 degrees) past the first six; the first six clients get hand-picked hues that avoid the urgency colours. Unknown text falls back to the hash.
  function hashHue(str) { let x = 2166136261; for (const ch of String(str)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0) % 360; }
  const CLIENT_HUES = [270, 190, 315, 80, 48, 295];   // violet, cyan, magenta, lime, gold, purple: kept clear of the urgency colours (red, orange, blue, green)
  function clientHue(name) { if (!name) return null; const i = state.clients.indexOf(name); return i >= 0 ? (i < CLIENT_HUES.length ? CLIENT_HUES[i] : Math.round((i * 137.508 + 215) % 360)) : hashHue(name); }
  const URG = [{ lvl: 0, color: '#30a46c', label: 'Low' }, { lvl: 1, color: '#3e63dd', label: 'Normal' }, { lvl: 2, color: '#f76b15', label: 'High' }, { lvl: 3, color: '#e5484d', label: 'Critical' }];
  function urgency(t) {   // priority sets the base; an approaching or missed due date raises it
    if (t.column === doneColId()) return { lvl: -1, color: '#8a94a6', label: 'Done' };
    let lvl = { high: 2, medium: 1, low: 0 }[t.priority]; if (lvl == null) lvl = 1;
    if (t.due) { const d = Math.round((Date.parse(t.due + 'T00:00:00') - Date.parse(todayIso() + 'T00:00:00')) / 864e5); if (d < 0 || d <= 1) lvl = 3; else if (d <= 3) lvl = Math.max(lvl, 2); else if (d <= 7) lvl = Math.max(lvl, 1); }
    return URG[lvl];
  }
  function paint(node, t) {   // sets --cc (client colour) and --uc (urgency colour); CSS only uses them in the Colourful style
    const hue = clientHue(t.client); node.style.setProperty('--cc', hue == null ? 'var(--muted)' : `hsl(${hue} 72% 52%)`); node.style.setProperty('--uc', urgency(t).color); return node;
  }
  function renderLegend() {
    const box = $('legend'); box.textContent = ''; if (document.documentElement.dataset.style !== 'colorful') return;
    const used = [...new Set(state.tasks.map(t => t.client).filter(Boolean))]; const sel = $('fClient').value;
    box.append(el('span', 'lgl', 'Card edges: client on the left, urgency on the right'));
    box.append(el('span', 'lgsep'));
    URG.slice().reverse().forEach(u => { const s = el('span', 'lgchip static', u.label); s.style.setProperty('--cc', u.color); box.append(s); });
  }

  // ---- top bar: client pills ranked by urgency then recency, as many as fit, the rest under "+N" --------------
  function clientRank() {
    const dc = doneColId(), names = [...new Set([...state.clients, ...state.tasks.map(t => t.client)].filter(Boolean))];
    return names.map(n => { const ts = state.tasks.filter(t => t.client === n), open = ts.filter(t => t.column !== dc);
      return { name: n, open: open.length, lvl: open.reduce((m, t) => Math.max(m, urgency(t).lvl), -1), rec: ts.reduce((m, t) => (t.updated > m ? t.updated : m), '') }; })
      .sort((a, b) => b.lvl - a.lvl || ((state.clients.indexOf(a.name) + 1 || 999) - (state.clients.indexOf(b.name) + 1 || 999)) || a.name.localeCompare(b.name));   // stable: only a change in urgency reorders
  }
  const setClient = v => { $('fClient').value = v; closePops(); render(); };
  function clientPill(c) {
    const on = $('fClient').value === c.name, b = el('button', 'cpill' + (on ? ' on' : '')); b.type = 'button'; b.style.setProperty('--cc', `hsl(${clientHue(c.name)} 72% 52%)`); b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Show all clients' : `Show only ${c.name} (${c.open} open)`; b.append(el('i', 'cdotc'), document.createTextNode(c.name)); if (c.open) b.append(el('span', 'cn', String(c.open)));
    b.onclick = () => setClient(on ? '' : c.name); return b;
  }
  function renderTopbar() {
    const box = $('clientBar'); if (!box || !state) return; box.textContent = '';
    const total = state.tasks.filter(t => t.column !== doneColId()).length, sel = $('fClient').value;
    const all = el('button', 'cpill all' + (sel ? '' : ' on'), 'All'); all.type = 'button'; all.setAttribute('aria-pressed', String(!sel)); all.title = 'Show all clients'; if (total) all.append(el('span', 'cn', String(total))); all.onclick = () => setClient(''); box.append(all);
    const list = clientRank(); let n = 0;                        // n = how many pills fit, in their natural order
    for (const c of list) { const b = clientPill(c); box.append(b); if (box.scrollWidth > box.clientWidth + 1) { b.remove(); break; } n++; }
    // the selected client must stay visible, but it takes the LAST visible slot instead of jumping to the front
    let order = list.slice(); const si = list.findIndex(c => c.name === sel);
    if (si >= n && n > 0) { order = list.filter(c => c.name !== sel); order.splice(n - 1, 0, list[si]); }
    const fits = () => box.scrollWidth <= box.clientWidth + 1;
    box.querySelectorAll('.cpill:not(.all)').forEach(b => b.remove()); const shown = [];
    for (let i = 0; i < n; i++) { const b = clientPill(order[i]); box.append(b); shown.push(b); }
    while (!fits() && shown.length > 1) { shown.pop().remove(); n--; }
    let rest = order.slice(shown.length);
    if (rest.length) {
      const more = el('button', 'cpill more'); more.type = 'button'; more.setAttribute('aria-haspopup', 'true'); box.append(more);
      const label = () => { more.textContent = `+${rest.length} ▾`; };
      label(); while (box.scrollWidth > box.clientWidth + 1 && shown.length) { shown.pop().remove(); rest = order.slice(shown.length); label(); }
      more.onclick = e => { e.stopPropagation(); const pop = $('clientPop'); if (!pop.hidden) { closePops(); return; } closePops();
        pop.textContent = ''; rest.forEach(c => { const b = el('button', 'cmenu' + ($('fClient').value === c.name ? ' on' : '')); b.type = 'button'; b.style.setProperty('--cc', `hsl(${clientHue(c.name)} 72% 52%)`);
          b.append(el('i', 'cdotc'), el('span', 'nm', c.name), el('span', 'cn', c.open ? String(c.open) : '')); b.onclick = () => setClient(c.name); pop.append(b); });
        pop.style.left = Math.max(0, more.offsetLeft - 10) + 'px'; pop.hidden = false; };
    }
    const pq = $('peopleQ'); pq.textContent = ''; const w = $('fWho').value;
    state.people.forEach(p => { const on = w === p.github, b = el('button', 'pq' + (on ? ' on' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(on)); b.title = on ? 'Show everyone' : `Only @${p.github}'s tasks`;
      b.append(avatar(p.github)); b.onclick = () => { $('fWho').value = on ? '' : p.github; render(); }; pq.append(b); });
  }
  function closePops() { ['clientPop', 'filterPop'].forEach(id => { $(id).hidden = true; }); $('btnFilter').setAttribute('aria-expanded', 'false'); }
  function placePop(pop) { if (window.matchMedia('(max-width: 760px)').matches) pop.style.top = (document.querySelector('header').getBoundingClientRect().bottom + 6) + 'px'; else pop.style.top = ''; }

  // ---- keeping the app itself fresh -----------------------------------------------------------------------
  const hashStr = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16).padStart(8, '0').slice(0, 6); };
  const loadedVersion = () => window.__kbAssets ? hashStr(window.__kbAssets.css + window.__kbAssets.js) : 'unknown';
  const revalidate = u => fetch(u, { cache: 'no-cache' }).then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
  let updateReady = false, lastUpdateCheck = Date.now();
  async function checkForUpdate(force) {
    if (updateReady || (!force && Date.now() - lastUpdateCheck < 120000)) return updateReady; lastUpdateCheck = Date.now();
    try {
      const [css, js] = await Promise.all([revalidate('board.css'), revalidate('board.js')]);
      let changed = !!window.__kbAssets && (css !== window.__kbAssets.css || js !== window.__kbAssets.js);
      if (!changed && window.__kbHtml) { const html = await revalidate(location.href); changed = html !== window.__kbHtml; }
      if (changed) { updateReady = true; $('updateBar').hidden = false; }
    } catch { /* offline or rate limited: try again next time */ }
    return updateReady;
  }
  async function hardRefresh() {   // bypass every cache, then reload
    toast('Updating to the latest version…');
    const here = new URL(location.href), bare = here.origin + here.pathname, base = bare.replace(/[^/]*$/, '');
    const urls = [...new Set([location.href, bare, base, base + 'board.css', base + 'board.js', base + 'theme.js'])];
    await Promise.all(urls.map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
    try { if (window.caches) await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch {}
    try { if (navigator.serviceWorker) await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister())); } catch {}
    location.reload();
  }
  window.kbUpdate = { check: () => checkForUpdate(true), refresh: hardRefresh, version: loadedVersion };
  $('updNow').onclick = hardRefresh; $('updLater').onclick = () => { $('updateBar').hidden = true; setTimeout(() => { updateReady = false; }, 30 * 60000); };
  $('sUpdate').onclick = hardRefresh;
  setInterval(() => { if (!document.hidden) checkForUpdate(); }, 10 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  setTimeout(() => checkForUpdate(), 20000);

  // ---- unread markers: per browser, remembered in localStorage (no repo writes) --------------------------------
  // seen[taskId] = { c: newest comment time seen, h: newest history time seen }. A comment is unread if someone else posted it after c;
  // a card has "changed" if someone else (or an agent) logged a history entry after h. First run on a browser marks everything read.
  let seenMap = null, freshOnly = false;
  const seenKey = () => 'kb_seen:' + cfg().repo + ':' + cfg().path;
  const loadSeen = () => { if (seenMap) return seenMap; try { const r = LS.get(seenKey(), ''); seenMap = r ? JSON.parse(r) : null; } catch { seenMap = null; } return seenMap; };
  const saveSeen = () => LS.set(seenKey(), JSON.stringify(seenMap));
  const maxAt = arr => arr.reduce((m, x) => (x.at > m ? x.at : m), '');
  const stampsOf = t => ({ c: maxAt(t.comments), h: maxAt(t.history) });
  function initSeen() { if (loadSeen()) return; seenMap = {}; state.tasks.forEach(t => { seenMap[t.id] = stampsOf(t); }); saveSeen(); }   // only after a successful load
  function markSeen(id) { const t = state.tasks.find(x => x.id === id), m = loadSeen(); if (!t || !m) return; const s = stampsOf(t), o = m[id]; if (o && o.c === s.c && o.h === s.h) return; m[id] = s; saveSeen(); }
  function markAllSeen() { const m = loadSeen() || (seenMap = {}); state.tasks.forEach(t => { m[t.id] = stampsOf(t); }); saveSeen(); }
  function freshInfo(t) {
    const me = (cfg().me || '').toLowerCase(), m = loadSeen(); if (!me || !m) return { unread: 0, changed: false };
    const s = m[t.id] || { c: '', h: '' }, other = x => String(x.by || '').toLowerCase() !== me;
    return { unread: t.comments.filter(x => x.at > s.c && other(x)).length, changed: t.history.some(x => x.at > s.h && other(x)) };
  }
  const isFresh = t => { const f = freshInfo(t); return f.unread > 0 || f.changed; };
  const newBadge = n => el('span', 'newb', `${n} new`);

  function filtered(t) {
    if (freshOnly && !isFresh(t)) return false;
    const fc = $('fClient').value, fw = $('fWho').value, fl = $('fLabel').value, fp = $('fPrio').value;
    if (fc && t.client !== fc) return false;
    if (fw === '__none' && t.assignees.length) return false;
    if (fw === '__agent' && !t.claim) return false;
    if (fw && fw[0] !== '_' && !t.assignees.includes(fw)) return false;
    if (fl && !t.labels.includes(fl)) return false;
    if (fp && t.priority !== fp) return false;
    if ($('fAttn').checked && !needsAttention(t)) return false;
    return true;
  }
  const labelColor = n => (state.labels.find(l => l.name === n) || {}).color || '#6b778c';

  function render() {
    fillSelect($('fClient'), [...new Set([...state.clients, ...state.tasks.map(t => t.client)].filter(Boolean))].map(c => [c, c]), 'All');
    fillSelect($('fWho'), [...state.people.map(p => [p.github, '@' + p.github]), ['__none', 'Unassigned'], ['__agent', 'Claimed by an agent']], 'Everyone');
    fillSelect($('fLabel'), state.labels.map(l => [l.name, l.name]), 'All');
    if ($('dlgCard').open && editing) markSeen(editing);
    document.body.dataset.view = view; syncViewSw();
    if (view !== 'board') {
      const board = $('board'), st = board.scrollTop; board.className = 'v-' + view; board.textContent = '';
      ({ list: renderList, cal: renderCal, sched: renderSched })[view](); board.scrollTop = st; renderLegend(); renderStats();
      if ($('dlgCard').open) refreshDrawer(); return;
    }
    const board = $('board'); board.className = ''; board.textContent = ''; const hideDone = $('fHideDone').checked;
    state.columns.forEach((col, ci) => {
      if (hideDone && col.id === 'done') return;
      const items = state.tasks.filter(t => t.column === col.id && filtered(t));
      const c = el('section', 'col' + (col.id === activeCol() ? ' active' : '')); c.dataset.col = col.id; const h = el('h2'); h.append(el('span', 'dot'), el('span', 'cname', col.name), el('span', 'count', String(items.length))); const hb = el('button', 'hadd', '＋'); hb.type = 'button'; hb.title = 'Add a task to ' + col.name; hb.setAttribute('aria-label', 'Add a task to ' + col.name); h.append(hb); c.append(h);
      const cards = el('div', 'cards');
      cards.addEventListener('dragover', e => { e.preventDefault(); c.classList.add('over'); });
      cards.addEventListener('dragleave', () => c.classList.remove('over'));
      cards.addEventListener('drop', e => { e.preventDefault(); c.classList.remove('over'); dropOn(e, col.id, null); });
      items.forEach(t => cards.append(cardEl(t, ci))); if (!items.length) cards.append(el('div', 'emptycol', 'Nothing here. Drop a card or add one below.')); c.append(cards);
      const add = el('div', 'add'), inp = el('input'), btn = el('button', 'primary', 'Add'); inp.placeholder = 'Add a task…';
      const go = () => { const v = inp.value.trim(); if (!v) return; inp.value = ''; addTask(v, col.id); };
      btn.onclick = go; inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      add.append(inp, btn); c.append(add); hb.onclick = () => { inp.scrollIntoView({ block: 'nearest' }); inp.focus(); }; board.append(c);
    });
    renderLegend(); renderStats(); renderTabs(); if ($('dlgCard').open) refreshDrawer();
  }

  // ---- mobile: one column at a time, chosen from a tab strip (or by swiping) ---------------
  const visibleCols = () => state.columns.filter(c => !($('fHideDone').checked && c.id === 'done'));
  function activeCol() { const v = visibleCols(), s = LS.get('kb_tab'); return (v.find(c => c.id === s) || v[0] || {}).id; }
  function setTab(id) { LS.set('kb_tab', id); document.querySelectorAll('.col').forEach(c => c.classList.toggle('active', c.dataset.col === id)); renderTabs(); }
  function renderTabs() {
    const box = $('tabs'); box.textContent = ''; const act = activeCol();
    visibleCols().forEach(col => {
      const n = state.tasks.filter(t => t.column === col.id && filtered(t)).length;
      const b = el('button', 'tab' + (col.id === act ? ' on' : ''), col.name); b.append(el('span', 'count', String(n))); b.dataset.col = col.id;
      b.onclick = () => setTab(col.id); box.append(b);
    });
    const on = box.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  (() => { let x0 = null, y0 = 0; const b = $('board');
    b.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    b.addEventListener('touchend', e => { if (x0 == null || !window.matchMedia('(max-width: 760px)').matches) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const v = visibleCols(), i = v.findIndex(c => c.id === activeCol()), n = v[i + (dx < 0 ? 1 : -1)]; if (n) setTab(n.id); }, { passive: true }); })();

  // ---- copy-for-agent prompts ---------------------------------------------------------------
  function copyText(text, okMsg) {
    const done = () => toast(okMsg || 'Copied');
    const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select();
      try { document.execCommand('copy') ? done() : toast('Copy failed: select and copy manually', true); } catch { toast('Copy failed', true); } ta.remove(); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  let toastTimer = null;
  function toast(msg, bad) { const t = $('toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 2600); }
  function boardInfo() {
    const c = cfg(), repoUrl = `https://github.com/${c.repo}`, rawBase = `${repoUrl}/blob/${c.branch}`;
    return { c, repoUrl, skill: `${rawBase}/.claude/skills/board/SKILL.md`, agents: `${rawBase}/AGENTS.md`,
      web: `${location.origin}${location.pathname}?repo=${c.repo}&branch=${c.branch}&path=${c.path}` };
  }
  function agentPrompt(t) {
    const { c, repoUrl, skill, agents, web } = boardInfo(), who = c.me || '<your-github-username>';
    const L = [];
    L.push('You are working from the Rain Ventures team task board.', '',
      `Board repo: ${repoUrl}  (task data: ${c.path} on branch ${c.branch})`, `Web board: ${web}`,
      `Read before starting: ${skill}  and  ${agents}`, '',
      'How the board works:',
      `- Clone the repo if you have not (gh repo clone ${c.repo}) and run everything from its root. Never edit ${c.path} by hand; use python3 board/board.py so edits merge safely with other people and agents.`,
      '- Auth: `gh` logged in, or set BOARD_TOKEN to a fine-grained token (Contents: read/write on the repo).',
      `- Act for GitHub user @${who}:  export BOARD_USER=${who} BOARD_AGENT=<claude|codex> BOARD_SESSION=<short session id>`,
      '- Only work on tasks assigned to that user. Client material lives in clients/<client>/; keep confidential detail out of task cards. Do not contact anyone or share prices without the user approving.', '');
    if (t) {
      L.push('YOUR TASK', `- id: ${t.id}`, `- title: ${t.title}`, `- column: ${t.column}   priority: ${t.priority || 'medium'}${t.due ? '   due: ' + t.due : ''}`);
      if (t.client) L.push(`- client: ${t.client}`);
      if (t.assignees.length) L.push(`- assigned to: ${t.assignees.map(a => '@' + a).join(', ')}`);
      if (t.labels.length) L.push(`- labels: ${t.labels.join(', ')}`);
      if (t.details) L.push('- details:', ...t.details.split('\n').map(x => '    ' + x));
      if (t.todos.length) L.push('- to-do list (tick these off as you finish them):', ...t.todos.map((d, i) => `    ${i + 1}. [${d.done ? 'x' : ' '}] ${d.text}`));
      if (t.comments.length) L.push('- comments (newest last):', ...t.comments.slice(-10).map(m => `    [${m.at.slice(0, 16)}] ${m.by}: ${String(m.text).replace(/\n/g, ' ')}`));
      if (t.links.length) L.push('- links:', ...t.links.map(l => `    ${l.title}: ${l.url}`));
      if (t.contacts.length) L.push('- contacts:', ...t.contacts.map(k => `    ${[k.name, k.role, k.email, k.phone].filter(Boolean).join(' | ')}`));
      if (t.claim) L.push(`- NOTE: already claimed by ${t.claim.agent} (session ${t.claim.session_id || '?'}, ${claimState(t.claim)}). Do not take it over unless the user says so.`);
      L.push('', 'Do this, in order:',
        `1. python3 board/board.py show ${t.id}   (re-read the latest card first)`,
        `2. python3 board/board.py claim ${t.id} --note "starting: <one-line plan>"`,
        `3. Do the work. While working, keep the board current: python3 board/board.py heartbeat ${t.id} --note "<what you are doing>" at each milestone and at least every 10 minutes. Tick off each to-do the moment it is finished: python3 board/board.py todo-done ${t.id} <number>; add any new steps you discover with python3 board/board.py todo-add ${t.id} "<text>". The card keeps a history log automatically. Read the comments for context and post questions or updates for the team with python3 board/board.py comment ${t.id} "<text>" (also set status blocked if you need an answer).`,
        `4. If you are blocked or need a human: python3 board/board.py heartbeat ${t.id} --status blocked --note "<exactly what you need>" and tell the user.`,
        `5. When finished: python3 board/board.py done ${t.id} --note "<result and link to the file or PR>"   (or: board.py release ${t.id} --column todo to hand it back)`,
        'Do not finish your reply without leaving the card claimed-and-current, done, or released.');
    } else {
      L.push('Your loop:',
        '1. python3 board/board.py list --assignee $BOARD_USER --column todo --unclaimed   (find work; python3 board/board.py show <id> to read a card)',
        '2. python3 board/board.py claim <id> --note "starting: <one-line plan>"',
        '3. Heartbeat while working: python3 board/board.py heartbeat <id> --note "<what you are doing>" at each milestone and at least every 10 minutes. If the card has a to-do list, tick items off as you finish them (python3 board/board.py todo-done <id> <number>) and add new steps with todo-add.',
        '4. Blocked or need a human: python3 board/board.py heartbeat <id> --status blocked --note "<what you need>" and tell the user.',
        '5. Finished: python3 board/board.py done <id> --note "<result and link>"   (or board.py release <id> --column todo).',
        '6. New work you discover: python3 board/board.py add "Title" --assign <user> --label <x> --due YYYY-MM-DD --client "<client>" --details "<text and URLs>"',
        'Never leave a task claimed without a recent heartbeat; update the card as you go, not at the end.');
    }
    return L.join('\n');
  }

  function renderStats() {
    const attn = state.tasks.filter(t => t.column !== doneColId() && needsAttention(t)).length;
    const attnTasks = state.tasks.filter(t => t.column !== doneColId() && needsAttention(t)), on = $('fAttn').checked, ab = $('btnAttn');
    ab.hidden = !attn && !on; $('attnN').textContent = String(attn); $('attnT').textContent = attn === 1 ? ' needs attention' : ' need attention'; $('attnS').textContent = ' attention'; ab.setAttribute('role', 'switch'); ab.setAttribute('aria-checked', String(on)); ab.classList.toggle('on', on); $('attnCount').textContent = attn ? `(${attn})` : '';
    ab.title = (on ? 'ON: showing only cards that need attention. Click to switch off.\n' : 'OFF: showing all cards. Click to show only cards that are overdue or have a stale, stuck or blocked agent.\n') + attnTasks.slice(0, 4).map(t => '• ' + t.title).join('\n') + (attnTasks.length > 4 ? `\n…and ${attnTasks.length - 4} more` : '');
    const fresh = state.tasks.filter(isFresh).length, bell = $('btnUnread'), bd = $('unreadBadge');
    bd.textContent = fresh > 99 ? '99+' : String(fresh); bd.hidden = !fresh; bell.classList.toggle('on', freshOnly);
    bell.title = fresh ? `${fresh} card${fresh > 1 ? 's' : ''} with new comments or changes${freshOnly ? ' (showing only these; click to show all)' : ' (click to show only these)'}` : (cfg().me ? 'Nothing new' : 'Set your GitHub username in Settings to see unread markers');
    document.title = (fresh ? `(${fresh}) ` : '') + 'Team Board';
    const nf = ['fWho', 'fLabel', 'fPrio'].filter(id => $(id).value).length + ($('fAttn').checked ? 1 : 0) + ($('fHideDone').checked ? 1 : 0) + (freshOnly ? 1 : 0), fb = $('filterBadge');
    fb.textContent = String(nf); fb.hidden = !nf; renderTopbar();
  }

  // Recognise GitHub URLs (any repo) so they read as "owner/repo#12" chips on the card
  function ghLink(u) {
    let x; try { x = new URL(u); } catch { return null; }
    if (x.hostname !== 'github.com') return null;
    const p = x.pathname.split('/').filter(Boolean); if (p.length < 2) return null; const r = p[0] + '/' + p[1];
    if (p[2] === 'issues' && /^\d+$/.test(p[3] || '')) return { kind: 'issue', label: `${r}#${p[3]}` };
    if (p[2] === 'pull' && /^\d+$/.test(p[3] || '')) return { kind: 'pr', label: `PR ${r}#${p[3]}` };
    if (p.length === 2) return { kind: 'repo', label: r };
    return { kind: 'file', label: r + '/…' + p[p.length - 1] };
  }

  // ---- to-do checklists ------------------------------------------------------------
  const openLists = new Set(), todoId = () => 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const todoCount = t => ({ done: t.todos.filter(d => d.done).length, all: t.todos.length });
  function toggleTodo(tid, did, done) {
    return mutate(n => { const t = n.tasks.find(x => x.id === tid), d = t && t.todos.find(x => x.id === did); if (!d) return;
      d.done = done; if (done) { d.doneBy = cfg().me || ''; d.doneAt = nowIso(); } else { delete d.doneBy; delete d.doneAt; } stamp(t); }, `To-do ${done ? 'done' : 'reopened'}: ${titleOf(tid)}`, [tid]);
  }
  function addTodo(tid, text) {
    text = text.trim(); if (!text) return Promise.resolve();
    return mutate(n => { const t = n.tasks.find(x => x.id === tid); if (!t) return; t.todos.push({ id: todoId(), text, done: false }); stamp(t); }, `Add to-do: ${titleOf(tid)}`, [tid]);
  }
  function removeTodo(tid, did) {
    return mutate(n => { const t = n.tasks.find(x => x.id === tid); if (!t) return; t.todos = t.todos.filter(x => x.id !== did); stamp(t); }, `Remove to-do: ${titleOf(tid)}`, [tid]);
  }
  function todoList(t, inDialog) {   // shared by the card (expanded) and the edit dialog
    const box = el('div', 'todos');
    t.todos.forEach(d => {
      const row = el('label', 'todo' + (d.done ? ' done' : '')), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!d.done;
      cb.onchange = async () => { await toggleTodo(t.id, d.id, cb.checked); if (inDialog) renderDlgTodos(); };
      row.append(cb, el('span', null, d.text));
      if (inDialog) { const x = el('button', 'x', '×'); x.type = 'button'; x.title = 'Remove'; x.onclick = async e => { e.preventDefault(); await removeTodo(t.id, d.id); renderDlgTodos(); }; row.append(x); }
      box.append(row);
    });
    const add = el('input', 'todonew'); add.placeholder = 'Add a to-do and press Enter';
    add.addEventListener('keydown', async e => { if (e.key !== 'Enter') return; e.preventDefault(); const v = add.value; add.value = ''; await addTodo(t.id, v); if (inDialog) { renderDlgTodos(); const n = $('cTodos').querySelector('.todonew'); if (n) n.focus(); } });
    box.append(add); return box;
  }
  function renderDlgTodos(force) {
    const t = state.tasks.find(x => x.id === editing), box = $('cTodos'); if (!t) return;
    const sig = JSON.stringify(t.todos.map(d => [d.id, d.text, !!d.done])); if (!force && sig === todoSig && box.childNodes.length) return; todoSig = sig;
    const typed = box.querySelector('.todonew') ? box.querySelector('.todonew').value : ''; box.textContent = ''; box.append(todoList(t, true));
    $('cTodoCount').textContent = t.todos.length ? `(${t.todos.filter(d => d.done).length}/${t.todos.length})` : '';
    if (typed) box.querySelector('.todonew').value = typed;
  }
  const ago2 = iso => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
  function renderDlgHistory(t) {
    const ol = $('cHist'); ol.textContent = ''; $('cHistSum').textContent = `History (${t.history.length})`;
    t.history.slice().reverse().forEach(h => { const li = el('li'); const tm = el('time', null, ago2(h.at)); tm.title = h.at; li.append(tm, el('b', null, ' ' + (h.by || '?') + ' '), document.createTextNode(h.text)); ol.append(li); });
    if (!t.history.length) ol.append(el('li', null, 'No history yet.'));
  }

  // ---- comments: an append-only stream per card, shown in its own dialog -------------------------
  let commentsFor = null, cmSig = '', todoSig = '';
  function renderComments() {
    const t = state.tasks.find(x => x.id === commentsFor); if (!t) { $('dlgCard').close(); return; }
    const sig = JSON.stringify(t.comments.map(m => m.id)) + t.comments.length; if (sig === cmSig) return; cmSig = sig;
    $('cmCount').textContent = t.comments.length ? `(${t.comments.length})` : ''; const box = $('cmStream'); box.textContent = '';
    t.comments.slice().reverse().forEach(cm => {      // newest first, like Trello: the composer is always at the top
      const row = el('div', 'cmcard'), head = el('div', 'cmhead');
      head.append(avatar(String(cm.by || '?').replace(/@.*/, '')), el('b', null, cm.by || '?'), el('time', null, ago2(cm.at)));
      head.lastChild.title = cm.at; const body = el('div', 'cmbody'); linkify(body, cm.text); row.append(head, body); box.append(row);
    });
  }
  const openComments = id => openCard(id, 'comments');
  async function postComment() {
    const ta = $('cmText'), text = ta.value.trim(), id = commentsFor; if (!text || !id) return;
    if (busy) { toast('Busy, try again in a moment', true); return; }
    const n0 = (state.tasks.find(x => x.id === id) || { comments: [] }).comments.length; ta.value = ''; autosize(ta); $('cmPost').disabled = true;
    await mutate(n => { const t = n.tasks.find(x => x.id === id); if (!t) return; t.comments.push({ id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: nowIso(), by: cfg().me || 'someone', text }); stamp(t); }, `Comment: ${titleOf(id)}`, [id]);
    $('cmPost').disabled = false;
    if ((state.tasks.find(x => x.id === id) || { comments: [] }).comments.length <= n0) { ta.value = text; autosize(ta); toast('Comment not saved. Your text is still in the box.', true); }
    cmSig = ''; renderComments(); ta.focus();
  }
  $('cmPost').onclick = postComment;
  $('cmText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); postComment(); } });
  $('cmText').addEventListener('focus', () => { $('cmActions').hidden = false; });
  $('cmText').addEventListener('input', () => autosize($('cmText')));
  setInterval(() => { if ($('dlgCard').open && !busy && !document.hidden && lastSyncOk) load(true); }, 10000);   // near-live while a conversation is open (304s are free)

  // ---- views: board (columns), list (grouped rows) and calendar (month by due date) -------------------
  let view = LS.get('kb_view', 'board'); if (!['board', 'list', 'cal', 'sched'].includes(view)) view = 'board';
  const setView = v => { view = v; LS.set('kb_view', v); render(); };
  const syncViewSw = () => document.querySelectorAll('#viewSw button').forEach(b => { const on = b.dataset.view === view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const pad2 = n => String(n).padStart(2, '0'), isoDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, todayIso = () => isoDay(new Date());
  const doneColId = () => (state.columns.find(c => c.id === 'done') || state.columns[state.columns.length - 1] || {}).id;
  const reopenColId = () => (state.columns.find(c => c.id === 'todo') || state.columns[0] || {}).id;
  const toggleDone = t => moveTo(t.id, t.column === doneColId() ? reopenColId() : doneColId());
  const fmtDue = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const dueState = t => !t.due || t.column === doneColId() ? '' : t.due < todayIso() ? ' late' : t.due === todayIso() ? ' today' : '';

  // floating ＋ (phones, board and list views): jump to the add box for the column you are looking at
  const fab = el('button', 'fab', '＋'); fab.type = 'button'; fab.id = 'fab'; fab.title = 'Add a task'; fab.setAttribute('aria-label', 'Add a task'); document.body.append(fab);
  fab.onclick = () => { const c = activeCol(); const inp = document.querySelector(view === 'board' ? `.col[data-col="${c}"] .add input` : `.ladd[data-col="${c}"] input`) || document.querySelector('.add input, .ladd input'); if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); } };
  function addRow(col, due) {
    const cn = (state.columns.find(c => c.id === col) || {}).name || '', add = el('div', 'ladd'), inp = el('input'); add.dataset.col = col; inp.placeholder = due ? '＋ Add task for this day' : '＋ Add task to ' + cn; inp.setAttribute('aria-label', 'Add task');
    inp.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const v = inp.value.trim(); if (!v) return; inp.value = ''; addTask(v, col, due); });
    add.append(inp); return add;
  }

  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
  const firstLine = t => (t.details || '').split('\n').find(x => x.trim()) || '';
  function chipTodo(t) { const tc = todoCount(t); if (!tc.all) return null; const b = el('button', 'chip todochip' + (tc.done === tc.all ? ' full' : ''), `☑ ${tc.done}/${tc.all}`); b.title = 'Show or hide the checklist'; b.onclick = () => { openLists.has(t.id) ? openLists.delete(t.id) : openLists.add(t.id); render(); }; return b; }
  function chipComments(t) { const n = t.comments.length; if (!n) return null; const fr = freshInfo(t); const b = el('button', 'chip cmchip has' + (fr.unread ? ' unread' : ''), `💬 ${n}`); if (fr.unread) b.append(newBadge(fr.unread)); b.title = `${n} comment${n > 1 ? 's' : ''}`; b.onclick = () => openCard(t.id, 'comments'); return b; }
  function chipAgent(t) { if (!t.claim) return null; const st = claimState(t.claim); return el('span', 'chip agentchip ' + st, `🤖 ${t.claim.agent} · ${st}`); }
  function chipsGh(t) { const out = []; t.links.forEach(l => { const g = ghLink(l.url); if (!g) return; const a = el('a', 'chip gh ' + g.kind, g.label); a.href = safeUrl(l.url); a.target = '_blank'; a.rel = 'noopener noreferrer'; out.push(a); }); return out; }
  const labelTags = (t, max) => { const out = []; t.labels.slice(0, max || 99).forEach(l => { const s = el('span', 'tag label', l); s.style.background = labelColor(l); out.push(s); }); if (max && t.labels.length > max) out.push(el('span', 'tag', '+' + (t.labels.length - max))); return out; };

  function listRow(t) {
    const isDone = t.column === doneColId(), row = paint(el('div', 'trow' + (isDone ? ' done' : '')), t);
    const circ = el('button', 'circ p-' + (t.priority || 'medium'), isDone ? '✓' : ''); circ.title = isDone ? 'Reopen' : 'Mark done'; circ.setAttribute('aria-label', circ.title);
    circ.onclick = e => { e.stopPropagation(); toggleDone(t); };
    const c0 = el('div', 'c-check'); c0.append(circ);
    const task = el('div', 'c-task'), title = el('div', 'lt', t.title); title.onclick = () => openCard(t.id); if (freshInfo(t).changed) { const d = el('span', 'cdot'); d.title = 'Changed since you last looked'; title.prepend(d); } task.append(title);
    const mm = el('div', 'lmeta m-only');      // phone layout: everything under the title
    if (t.due) mm.append(el('span', 'chip due' + dueState(t), '📅 ' + fmtDue(t.due)));
    if (t.priority) mm.append(el('span', 'pr ' + t.priority, cap(t.priority)));
    mm.append(...labelTags(t)); if (t.client) mm.append(el('span', 'tag client', t.client));
    [chipTodo(t), chipComments(t), chipAgent(t), ...chipsGh(t)].forEach(x => x && mm.append(x));
    if (mm.childNodes.length) task.append(mm);
    if (openLists.has(t.id)) task.append(todoList(t, false));
    const desc = el('div', 'c-desc', firstLine(t)); desc.title = t.details || '';
    const ppl = el('div', 'c-people'); t.assignees.forEach(a => ppl.append(avatar(a)));
    const lab = el('div', 'c-labels'); lab.append(...labelTags(t, 2));
    const due = el('div', 'c-due'); if (t.due) due.append(el('span', 'chip due' + dueState(t), '📅 ' + fmtDue(t.due)));
    const pr = el('div', 'c-prio'); if (t.priority) pr.append(el('span', 'pr ' + t.priority, cap(t.priority)));
    const more = el('div', 'c-more'); [chipTodo(t), chipComments(t), chipAgent(t)].forEach(x => x && more.append(x));
    const edit = el('button', 'ico', '✏️'); edit.title = 'Open task'; edit.setAttribute('aria-label', 'Open task'); edit.onclick = () => openCard(t.id); more.append(edit);
    const bot = el('button', 'ico', '🤖'); bot.title = 'Copy instructions for an agent to work on this task'; bot.setAttribute('aria-label', 'Copy agent instructions for this task'); bot.onclick = () => copyText(agentPrompt(t), 'Task instructions copied for an agent'); more.append(bot);
    row.append(c0, task, desc, ppl, lab, due, pr, more); return row;
  }

  function tableOf(items) {   // header row + rows; on a phone the header disappears and rows reflow
    const box = el('div', 'ttable'), hd = el('div', 'trow thead');
    ['', '📝 Task', '☰ Description', '👥 People', '🏷 Labels', '📅 Due', '⚑ Priority', ''].forEach((x, i) => hd.append(el('div', ['c-check', 'c-task', 'c-desc', 'c-people', 'c-labels', 'c-due', 'c-prio', 'c-more'][i], x)));
    box.append(hd); items.forEach(t => box.append(listRow(t))); return box;
  }

  function renderList() {
    const board = $('board'), hideDone = $('fHideDone').checked; let collapsed; try { collapsed = new Set(JSON.parse(LS.get('kb_collapsed', '[]'))); } catch { collapsed = new Set(); }
    state.columns.forEach(col => {
      if (hideDone && col.id === 'done') return;
      const items = state.tasks.filter(t => t.column === col.id && filtered(t)), shut = collapsed.has(col.id);
      const sec = el('section', 'lsec'); sec.dataset.col = col.id;
      const head = el('button', 'lhead'); head.setAttribute('aria-expanded', String(!shut));
      head.append(el('span', 'spill', col.name), el('span', 'count', String(items.length)), el('span', 'spacer'), el('span', 'caret', shut ? '▸' : '▾'));
      head.onclick = () => { shut ? collapsed.delete(col.id) : collapsed.add(col.id); LS.set('kb_collapsed', JSON.stringify([...collapsed])); render(); };
      sec.append(head);
      if (!shut) { const sc = el('div', 'tscroll'); if (items.length) sc.append(tableOf(items)); else sc.append(el('div', 'emptycol', 'Nothing here.')); sec.append(addRow(col.id), sc); }
      board.append(sec);
    });
  }

  function renderSched() {
    const board = $('board'), hideDone = $('fHideDone').checked, today = todayIso(), dc = doneColId();
    const tasks = state.tasks.filter(t => filtered(t) && !(hideDone && t.column === dc)), order = new Map(state.columns.map((c, i) => [c.id, i]));
    const byDate = (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (order.get(a.column) || 0) - (order.get(b.column) || 0));
    const dated = tasks.filter(t => t.due).sort(byDate), undated = tasks.filter(t => !t.due);
    const overdue = dated.filter(t => t.due < today && t.column !== dc), earlier = dated.filter(t => t.due < today && t.column === dc), upcoming = dated.filter(t => t.due >= today);
    const wrap = el('div', 'sched'), bar = el('div', 'calbar');
    const todayBtn = el('button', 'calnav', 'Today'); todayBtn.onclick = () => { const x = wrap.querySelector('.sday.today'); if (x) x.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    bar.append(todayBtn, el('h2', 'caltitle', 'Schedule'), el('span', 'spacer')); wrap.append(bar);

    const item = t => {
      const done = t.column === dc, row = paint(el('div', 'sitem' + (done ? ' done' : '') + dueState(t)), t);
      const circ = el('button', 'circ sm p-' + (t.priority || 'medium'), done ? '✓' : ''); circ.title = done ? 'Reopen' : 'Mark done'; circ.setAttribute('aria-label', circ.title); circ.onclick = e => { e.stopPropagation(); toggleDone(t); };
      const title = el('div', 'stitle'); if (freshInfo(t).changed) { const d = el('span', 'cdot'); d.title = 'Changed since you last looked'; title.append(d); } title.append(document.createTextNode(t.title));
      const sub = [t.client, ...t.labels].filter(Boolean).join(' · '); if (sub) title.append(el('span', 'ssub', sub));
      const avs = el('div', 'lavs'); t.assignees.forEach(a => avs.append(avatar(a)));
      const extra = el('div', 'sx'); [chipTodo(t), chipComments(t), chipAgent(t)].forEach(x => x && extra.append(x));
      row.append(circ, el('div', 'stime', colName(t.column)), title, extra, avs); row.onclick = () => openCard(t.id); return row;
    };
    const day = (key, label, list, cls) => {
      const d = new Date(key + 'T00:00:00'), sec = el('section', 'sday' + (cls || ''));
      const dl = el('div', 'sdate');
      if (label) dl.append(el('span', 'sdn lbl', label)); else dl.append(el('span', 'sdn', String(d.getDate())), el('span', 'sdl', d.toLocaleDateString('en-GB', { month: 'short', weekday: 'short' }).replace(' ', ', ')));
      const items = el('div', 'sitems'); list.forEach(t => items.append(item(t))); if (!list.length) items.append(el('div', 'snone', 'Nothing due'));
      sec.append(dl, items); return sec;
    };
    if (overdue.length) wrap.append(day('', 'Overdue', overdue, ' overdue'));
    const groups = new Map(); upcoming.forEach(t => { if (!groups.has(t.due)) groups.set(t.due, []); groups.get(t.due).push(t); }); if (!groups.has(today)) groups.set(today, []);
    let lastMonth = '';
    [...groups.keys()].sort().forEach(k => {
      const mo = k.slice(0, 7); if (mo !== lastMonth) { lastMonth = mo; wrap.append(el('div', 'smonth', new Date(k + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))); }
      wrap.append(day(k, '', groups.get(k), k === today ? ' today' : ''));
    });
    if (earlier.length) { const dt = el('details', 'calundated'); dt.append(el('summary', null, `Earlier, completed (${earlier.length})`)); earlier.slice().reverse().forEach(t => dt.append(item(t))); wrap.append(dt); }
    const und = el('details', 'calundated'); und.open = LS.get('kb_undated', '') === '1'; und.addEventListener('toggle', () => LS.set('kb_undated', und.open ? '1' : ''));
    und.append(el('summary', null, `No due date (${undated.length})`)); undated.forEach(t => und.append(item(t))); wrap.append(und);
    board.append(wrap);
  }

  let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1), calSel = todayIso();
  function renderCal() {
    const board = $('board'), hideDone = $('fHideDone').checked, today = todayIso();
    const tasks = state.tasks.filter(t => filtered(t) && !(hideDone && t.column === doneColId())), byDay = new Map(), undated = [];
    tasks.forEach(t => { if (t.due) { if (!byDay.has(t.due)) byDay.set(t.due, []); byDay.get(t.due).push(t); } else undated.push(t); });
    const wrap = el('div', 'cal'), bar = el('div', 'calbar');
    const nav = (txt, label, fn) => { const b = el('button', 'calnav', txt); b.setAttribute('aria-label', label); b.onclick = fn; return b; };
    bar.append(nav('‹', 'Previous month', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); render(); }),
      el('h2', 'caltitle', calMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })),
      nav('›', 'Next month', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); render(); }),
      nav('Today', 'Go to today', () => { calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); calSel = today; render(); }));
    wrap.append(bar);
    const grid = el('div', 'calgrid'); ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(d => grid.append(el('div', 'calwd', d)));
    const y = calMonth.getFullYear(), m = calMonth.getMonth(), offset = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    for (let i = 0; i < Math.ceil((offset + days) / 7) * 7; i++) {
      const d = new Date(y, m, 1 - offset + i), key = isoDay(d), list = byDay.get(key) || [];
      const cell = el('div', 'calcell' + (d.getMonth() !== m ? ' out' : '') + (key === today ? ' today' : '') + (key === calSel ? ' sel' : '')); cell.dataset.day = key;
      cell.append(el('span', 'dn', String(d.getDate())));
      const pills = el('div', 'pills');
      list.slice(0, 3).forEach(t => {
        const p = paint(el('button', 'pill p-' + (t.priority || 'medium') + (t.column === doneColId() ? ' done' : '') + dueState(t) + (isFresh(t) ? ' fresh' : ''), t.title), t); p.title = t.title; p.draggable = true;
        p.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', t.id); });
        p.onclick = e => { e.stopPropagation(); openCard(t.id); }; pills.append(p);
      });
      if (list.length > 3) pills.append(el('span', 'more', `+${list.length - 3} more`));
      cell.append(pills);
      const dots = el('div', 'dots'); list.slice(0, 5).forEach(t => dots.append(el('i', 'p-' + (t.priority || 'medium') + (t.column === doneColId() ? ' done' : '')))); cell.append(dots);
      cell.onclick = () => { calSel = key; render(); };
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('over'); }); cell.addEventListener('dragleave', () => cell.classList.remove('over'));
      cell.addEventListener('drop', e => { e.preventDefault(); cell.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); if (!id) return;
        mutate(n => { const t = n.tasks.find(x => x.id === id); if (t) { t.due = key; stamp(t); } }, `Due ${key}: ${titleOf(id)}`, [id]); });
      grid.append(cell);
    }
    wrap.append(grid);
    const day = el('section', 'calday'), sel = byDay.get(calSel) || [];
    const hd = el('h3', null, new Date(calSel + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })); hd.append(el('span', 'count', String(sel.length))); day.append(hd);
    if (sel.length) { const sc = el('div', 'tscroll'); sc.append(tableOf(sel)); day.append(sc); } else day.append(el('div', 'emptycol', 'Nothing due this day.')); day.append(addRow(reopenColId(), calSel)); wrap.append(day);
    const und = el('details', 'calundated'); und.open = LS.get('kb_undated', '') === '1'; und.addEventListener('toggle', () => LS.set('kb_undated', und.open ? '1' : ''));
    und.append(el('summary', null, `No due date (${undated.length})`)); if (undated.length) { const sc = el('div', 'tscroll'); sc.append(tableOf(undated)); und.append(sc); } wrap.append(und);
    board.append(wrap);
  }

  function avatar(login) {
    const p = state.people.find(x => x.github.toLowerCase() === String(login).toLowerCase());
    const name = (p && p.name) || login; let h = 0; for (const ch of String(login).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
    const a = el('span', 'av', name.slice(0, 2).toUpperCase()); a.style.setProperty('--h', h); a.title = '@' + login + (p && p.name ? ' (' + p.name + ')' : ''); return a;
  }

  function cardEl(t, ci) {
    const c = el('div', 'card' + (t.priority ? ' p-' + t.priority : '')); c.draggable = true; paint(c, t);
    c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', t.id); c.classList.add('dragging'); });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
    c.addEventListener('dragover', e => e.preventDefault());
    c.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); dropOn(e, t.column, t.id); });
    c.addEventListener('dblclick', () => openCard(t.id));
    const fr = freshInfo(t);
    const top = el('div', 'top'); if (fr.changed) { const d = el('span', 'cdot'); d.title = 'Changed since you last looked'; top.append(d); } if (t.priority) top.append(el('span', 'prio ' + t.priority, t.priority)); top.append(el('span', 'spacer'));
    const edit = el('button', 'ico', '✏️'), bot = el('button', 'ico', '🤖');
    edit.title = 'Edit task'; edit.setAttribute('aria-label', 'Edit task'); edit.onclick = () => openCard(t.id);
    bot.title = 'Copy instructions for an agent to work on this task'; bot.setAttribute('aria-label', 'Copy agent instructions for this task'); bot.onclick = () => copyText(agentPrompt(t), 'Task instructions copied for an agent');
    top.append(edit, bot); c.append(top);
    c.append(el('div', 't', t.title));
    if (t.details) c.append(el('div', 'n', t.details));
    const tags = el('div', 'tags');
    t.labels.forEach(l => { const s = el('span', 'tag label', l); s.style.background = labelColor(l); tags.append(s); });
    if (t.client) tags.append(el('span', 'tag client', t.client));
    if (tags.childNodes.length) c.append(tags);
    if (t.todos.length) { const { done, all } = todoCount(t), pr = el('div', 'prog'), bar = el('div', 'bar'), fill = el('i'); fill.style.width = Math.round(100 * done / all) + '%'; bar.append(fill); pr.append(bar); pr.classList.toggle('full', done === all); c.append(pr); }
    const foot = el('div', 'foot');
    { const tc = todoCount(t), chip = el('button', 'chip todochip' + (tc.all && tc.done === tc.all ? ' full' : ''), tc.all ? `☑ ${tc.done}/${tc.all}` : '☑ +');
      chip.title = tc.all ? 'Show or hide the checklist' : 'Add a checklist'; chip.setAttribute('aria-expanded', String(openLists.has(t.id)));
      chip.onclick = () => { openLists.has(t.id) ? openLists.delete(t.id) : openLists.add(t.id); render(); }; foot.append(chip); }
    { const n = t.comments.length, cm = el('button', 'chip cmchip' + (n ? ' has' : ''), n ? `💬 ${n}` : '💬'); cm.title = n ? `${n} comment${n > 1 ? 's' : ''}${fr.unread ? ', ' + fr.unread + ' unread' : ''}` : 'Add a comment'; if (fr.unread) { cm.classList.add('unread'); cm.append(newBadge(fr.unread)); } cm.setAttribute('aria-label', cm.title); cm.onclick = () => openComments(t.id); foot.append(cm); }
    if (t.due) { const late = t.column !== 'done' && t.due < new Date().toISOString().slice(0, 10); foot.append(el('span', 'chip' + (late ? ' late' : ''), '📅 ' + t.due)); }
    const other = [];
    t.links.forEach(l => { const g = ghLink(l.url); if (!g) { other.push(l); return; }
      const a = el('a', 'chip gh ' + g.kind, g.label); a.href = safeUrl(l.url); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = l.title || l.url; foot.append(a); });
    if (other.length) foot.append(el('span', 'chip', '🔗 ' + other.length));
    if (t.contacts.length) foot.append(el('span', 'chip', '👤 ' + t.contacts.length));
    foot.append(el('span', 'spacer'));
    t.assignees.forEach(a => foot.append(avatar(a)));
    c.append(foot);
    if (openLists.has(t.id)) c.append(todoList(t, false));
    if (t.claim) {
      const st = claimState(t.claim), k = t.claim;
      const b = el('div', 'claim ' + st); b.append(el('span', 'pulse'), el('strong', null, k.agent), document.createTextNode(`${k.on_behalf_of ? ' for @' + k.on_behalf_of : ''} · ${st} · beat ${ago(k.heartbeat_at || k.claimed_at)}`));
      if (k.note) b.append(el('div', 'cnote', k.note));
      b.title = `session ${k.session_id || '?'} on ${k.host || '?'}\n${k.cwd || ''}\n${k.branch || ''}`; c.append(b);
    }
    const cols = state.columns, prev = cols[ci - 1], next = cols[ci + 1];
    const mv = el('div', 'moves'), left = el('button', 'mv', '◀ ' + (prev ? prev.name : '')), right = el('button', 'mv', (next ? next.name : '') + ' ▶');
    left.title = 'Move left'; right.title = 'Move right'; left.disabled = !prev; right.disabled = !next;
    left.onclick = () => moveTo(t.id, prev.id); right.onclick = () => moveTo(t.id, next.id);
    mv.append(left, right); c.append(mv); return c;
  }

  function place(n, id, colId, beforeId) {
    const i = n.tasks.findIndex(x => x.id === id); if (i < 0) return;
    const [t] = n.tasks.splice(i, 1); t.column = colId; stamp(t);
    let at = beforeId ? n.tasks.findIndex(x => x.id === beforeId) : -1;
    if (at < 0) { let last = -1; n.tasks.forEach((x, k) => { if (x.column === colId) last = k; }); at = last + 1; }
    n.tasks.splice(at, 0, t);
  }
  const titleOf = id => (state.tasks.find(x => x.id === id) || {}).title || id;
  const moveTo = (id, col) => mutate(n => place(n, id, col, null), `Move "${titleOf(id)}" to ${col}`, [id]);
  function dropOn(e, col, beforeId) { const id = e.dataTransfer.getData('text/plain'); if (!id || id === beforeId) return; mutate(n => place(n, id, col, beforeId), `Move "${titleOf(id)}" to ${col}`, [id]); }
  function addTask(title, col, due) {
    const fc = $('fClient').value, w = $('fWho').value;
    const mine = me() && state.people.some(p => p.github.toLowerCase() === me().toLowerCase()) ? [state.people.find(p => p.github.toLowerCase() === me().toLowerCase()).github] : [];
    const as = w && w[0] !== '_' ? [w] : (w === '__none' ? [] : mine);
    const t = { id: uid(), title, column: col, client: fc || '', priority: 'medium', due: due || '', labels: [], assignees: as, details: '', links: [], contacts: [], todos: [], comments: [], history: [], claim: null, created: nowIso(), updated: nowIso() };
    if (me()) { t.createdBy = me(); t.updatedBy = me(); }
    mutate(n => { n.tasks.push(t); }, `Add task: ${title}`);
  }

  // ---- edit dialog ----------------------------------------------------------
  let editing = null;
  const parseLinks = txt => txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const p = l.split('|').map(x => x.trim()); const url = p.length > 1 ? p.slice(1).join('|').trim() : p[0]; return { title: p.length > 1 ? p[0] : url, url }; }).filter(x => safeUrl(x.url));
  const parseContacts = txt => txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const p = l.split('|').map(x => x.trim()); return { name: p[0] || '', role: p[1] || '', email: p[2] || '', phone: p[3] || '' }; });
  const linksText = ls => (ls || []).map(l => l.title && l.title !== l.url ? `${l.title} | ${l.url}` : l.url).join('\n');
  const contactsText = cs => (cs || []).map(c => [c.name, c.role, c.email, c.phone].join(' | ').replace(/( \| )+$/, '')).join('\n');

  let fieldBase = { title: '', details: '' }, editingDesc = false, saveTimer = null;
  const autosize = ta => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 640) + 'px'; };
  const taskNow = () => state.tasks.find(x => x.id === editing);
  const baseFor = key => { const b = clone(state), i = b.tasks.findIndex(x => x.id === editing); if (i >= 0) b.tasks[i][key] = fieldBase[key]; return b; };   // the text as it was when I started editing it
  async function saveField(fn, msg, baseKey) {     // every field saves on its own (no Save button); conflicts are checked per field
    const id = editing, sv = $('dSaved'); sv.textContent = 'Saving…'; sv.className = 'dsaved';
    await mutate(fn, msg, [id], baseKey ? baseFor(baseKey) : null);
    const ok = $('status').classList.contains('ok'); sv.textContent = ok ? 'Saved ✓' : 'Not saved'; sv.className = 'dsaved ' + (ok ? 'ok' : 'bad');
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { sv.textContent = ''; }, 2500);
  }
  const edit = (id, f, msg, baseKey) => saveField(n => { const t = n.tasks.find(x => x.id === id); if (t) { f(t, n); stamp(t); } }, msg, baseKey);

  function renderDescView(t) {
    const v = $('cDescView'); v.textContent = ''; if (t.details) linkify(v, t.details); else v.append(el('span', 'ph', 'Add a more detailed description…'));
  }
  function startDesc() {
    const t = taskNow(); if (!t || editingDesc) return; editingDesc = true; fieldBase.details = t.details || '';
    $('cDetails').value = fieldBase.details; $('cDescView').hidden = true; $('cDescBtn').hidden = true; $('descEdit').hidden = false; autosize($('cDetails')); const ta = $('cDetails'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function closeDesc(save) {
    if (!editingDesc) return; const t = taskNow(), v = $('cDetails').value, id = editing; editingDesc = false;
    $('descEdit').hidden = true; $('cDescView').hidden = false; $('cDescBtn').hidden = false;
    if (save && t && v !== fieldBase.details) { edit(id, x => { x.details = v; }, `Edit description: ${t.title}`, 'details'); fieldBase.details = v; t.details = v; }
    if (t) renderDescView(t);
  }
  $('cDescBtn').onclick = startDesc; $('cDescView').addEventListener('dblclick', startDesc);
  $('cDescView').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); startDesc(); } });
  $('cDescSave').onclick = () => closeDesc(true); $('cDescCancel').onclick = () => closeDesc(false);
  $('cDetails').addEventListener('input', () => autosize($('cDetails')));
  $('cDetails').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeDesc(true); } });

  function commitTitle() {
    const t = taskNow(); if (!t) return; const ti = $('cTitle'), v = ti.value.trim();
    if (!v) { ti.value = fieldBase.title; autosize(ti); return; } if (v === fieldBase.title) return;
    const id = editing; edit(id, x => { x.title = v; }, `Rename: ${v}`, 'title'); fieldBase.title = v;
  }
  $('cTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('cTitle').blur(); } });
  $('cTitle').addEventListener('input', () => autosize($('cTitle'))); $('cTitle').addEventListener('blur', commitTitle);

  $('cCol').onchange = e => { const id = editing, v = e.target.value; saveField(n => { place(n, id, v, null); }, `Move: ${titleOf(id)}`); };
  $('cPrio').onchange = e => { const v = e.target.value; e.target.dataset.v = v; edit(editing, t => { t.priority = v; }, `Priority: ${titleOf(editing)}`); };
  $('cClient').onchange = e => {
    let v = e.target.value;
    if (v === '__new') {
      const t0 = taskNow(); v = (prompt('New client name:') || '').replace(/\s+/g, ' ').trim();
      if (!v) { e.target.value = (t0 && t0.client) || ''; return; }
      const known = state.clients.find(c => c.toLowerCase() === v.toLowerCase()); if (known) v = known;
      edit(editing, (t, n) => { if (!n.clients.some(c => c.toLowerCase() === v.toLowerCase())) n.clients.push(v); t.client = v; }, `New client: ${v}`);
      return;
    }
    edit(editing, t => { t.client = v; }, `Client: ${titleOf(editing)}`);
  };
  $('cDue').onchange = e => { const v = e.target.value; $('cDueClear').hidden = !v; edit(editing, t => { t.due = v; }, `Due: ${titleOf(editing)}`); };
  $('cDueClear').onclick = () => { $('cDue').value = ''; $('cDueClear').hidden = true; edit(editing, t => { t.due = ''; }, `Clear due: ${titleOf(editing)}`); };

  function renderPeople(t) {
    const box = $('cWho'); box.textContent = '';
    state.people.map(p => ({ github: p.github, name: p.name || p.github })).concat(t.assignees.filter(a => !state.people.some(p => p.github === a)).map(a => ({ github: a, name: a }))).forEach(p => {
      const on = t.assignees.includes(p.github), b = el('button', 'pchip' + (on ? ' on' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(on)); b.title = (on ? 'Remove @' : 'Assign @') + p.github;
      b.append(avatar(p.github), document.createTextNode(p.name));
      b.onclick = () => edit(editing, x => { const i = x.assignees.indexOf(p.github); if (i >= 0) x.assignees.splice(i, 1); else x.assignees.push(p.github); }, `Assignees: ${titleOf(editing)}`); box.append(b);
    });
  }
  function renderLabelChips(t) {
    const box = $('cLabelChips'); box.textContent = ''; $('labelList').textContent = ''; state.labels.forEach(l => { const o = el('option'); o.value = l.name; $('labelList').append(o); });
    t.labels.forEach(l => { const s = el('span', 'tag label lchip', l); s.style.background = labelColor(l); const x = el('button', 'lx', '×'); x.type = 'button'; x.title = 'Remove label'; x.setAttribute('aria-label', 'Remove label ' + l);
      x.onclick = () => edit(editing, tt => { tt.labels = tt.labels.filter(y => y !== l); }, `Labels: ${titleOf(editing)}`); s.append(x); box.append(s); });
  }
  $('cLabelAdd').onclick = () => { $('cLabelAdd').hidden = true; $('cLabelNew').hidden = false; $('cLabelNew').focus(); };
  $('cLabelNew').addEventListener('blur', () => setTimeout(() => { if (!$('cLabelNew').value.trim()) { $('cLabelNew').hidden = true; $('cLabelAdd').hidden = false; } }, 150));
  function addLabel() {
    const inp = $('cLabelNew'), v = inp.value.replace(/,/g, '').trim(); inp.value = ''; if (!v) return;
    edit(editing, (t, n) => { if (!t.labels.includes(v)) t.labels.push(v); if (!n.labels.some(x => x.name === v)) n.labels.push({ name: v, color: '#6b778c' }); }, `Labels: ${titleOf(editing)}`);
  }
  $('cLabelNew').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addLabel(); } }); $('cLabelNew').addEventListener('change', addLabel);

  const parseLine = txt => { const p = txt.split('|').map(x => x.trim()); const url = p.length > 1 ? p.slice(1).join('|').trim() : p[0]; return safeUrl(url) ? { title: p.length > 1 && p[0] ? p[0] : url, url } : null; };
  function renderLinkList(t) {
    const box = $('cLinkList'); box.textContent = ''; $('cLinkCount').textContent = t.links.length ? `(${t.links.length})` : '';
    t.links.forEach(l => {
      const row = el('div', 'linkrow'), g = ghLink(l.url), a = el('a', null, g ? g.label : (l.title || l.url)); a.href = safeUrl(l.url); a.target = '_blank'; a.rel = 'noopener noreferrer';
      let host = ''; try { host = new URL(l.url).hostname.replace(/^www\./, ''); } catch {}
      const x = el('button', 'lx', '×'); x.type = 'button'; x.title = 'Remove link'; x.setAttribute('aria-label', 'Remove link');
      x.onclick = () => edit(editing, tt => { tt.links = tt.links.filter(y => y.url !== l.url); }, `Links: ${titleOf(editing)}`);
      row.append(el('span', 'li', g ? '🐙' : '🔗'), a, el('span', 'host', g && l.title && l.title !== l.url ? l.title : host), x); box.append(row);
    });
  }
  $('cLinkNew').addEventListener('keydown', e => { if (e.key !== 'Enter') return; e.preventDefault(); const v = parseLine($('cLinkNew').value); if (!v) { toast('Paste an http(s) link, or use: Title | https://url', true); return; }
    $('cLinkNew').value = ''; edit(editing, t => { if (!t.links.some(y => y.url === v.url)) t.links.push(v); }, `Links: ${titleOf(editing)}`); });
  function renderContactList(t) {
    const box = $('cContactList'); box.textContent = '';
    t.contacts.forEach(k => {
      const row = el('div', 'contact'), main = el('div', 'cmain'); main.append(el('b', null, k.name || '(no name)')); if (k.role) main.append(el('span', 'host', ' · ' + k.role));
      const det = el('div', 'cdet'); if (k.email) { const a = el('a', null, k.email); a.href = 'mailto:' + k.email; det.append(a); } if (k.phone) { const a = el('a', null, k.phone); a.href = 'tel:' + k.phone.replace(/\s+/g, ''); det.append(a); }
      main.append(det); const x = el('button', 'lx', '×'); x.type = 'button'; x.title = 'Remove contact'; x.setAttribute('aria-label', 'Remove contact');
      x.onclick = () => edit(editing, tt => { const i = tt.contacts.findIndex(y => y.name === k.name && y.email === k.email && y.phone === k.phone); if (i >= 0) tt.contacts.splice(i, 1); }, `Contacts: ${titleOf(editing)}`);
      row.append(el('span', 'avc', (k.name || '?').slice(0, 1).toUpperCase()), main, x); box.append(row);
    });
  }
  $('cContactNew').addEventListener('keydown', e => { if (e.key !== 'Enter') return; e.preventDefault(); const p = $('cContactNew').value.split('|').map(x => x.trim()); if (!p[0]) return;
    const k = { name: p[0], role: p[1] || '', email: p[2] || '', phone: p[3] || '' }; $('cContactNew').value = ''; edit(editing, t => { t.contacts.push(k); }, `Contacts: ${titleOf(editing)}`); });

  function renderClaim(t) {
    const wrap = $('cClaimWrap'); wrap.hidden = !t.claim; const dl = $('cClaim'); dl.textContent = ''; if (!t.claim) return;
    const k = t.claim, st = claimState(k); wrap.className = 'claimbanner ' + st;
    const top = el('div', 'cltop'); top.append(el('span', 'pulse'), el('b', null, k.agent), document.createTextNode(`${k.on_behalf_of ? ' for @' + k.on_behalf_of : ''} · ${st} · beat ${ago(k.heartbeat_at || k.claimed_at)}`)); dl.append(top);
    if (k.note) dl.append(el('div', 'cnote', k.note));
    dl.append(el('div', 'host', [k.session_id && 'session ' + k.session_id, k.host, k.branch].filter(Boolean).join(' · ')));
  }
  $('cStuck').onclick = () => edit(editing, t => { if (t.claim) { t.claim.status = 'stuck'; t.claim.note = (t.claim.note ? t.claim.note + ' | ' : '') + `marked stuck by ${me() || 'human'}`; } }, `Mark stuck: ${titleOf(editing)}`);
  $('cRelease').onclick = () => { if (!confirm('Release the agent claim? The agent session may still be running.')) return; edit(editing, t => { t.claim = null; }, `Release claim: ${titleOf(editing)}`); };

  function fillDrawer(t, force) {
    const set = (x, v) => { if ((force || document.activeElement !== x) && x.value !== v) x.value = v; };
    const cl = [...new Set([...state.clients, t.client].filter(Boolean))];
    if (force || $('cClient').options.length !== cl.length + 2) fillSelect($('cClient'), [['', '(none)'], ...cl.map(c => [c, c]), ['__new', '＋ New client…']]);
    if (force) { fillSelect($('cCol'), state.columns.map(c => [c.id, c.name])); }
    set($('cCol'), t.column); set($('cPrio'), t.priority || 'medium'); set($('cClient'), t.client || ''); set($('cDue'), t.due || '');
    $('cPrio').dataset.v = $('cPrio').value; $('cDueClear').hidden = !$('cDue').value;
    const ti = $('cTitle'); if (force || (document.activeElement !== ti && ti.value !== t.title)) { ti.value = t.title; fieldBase.title = t.title; } autosize(ti);
    if (!editingDesc) { fieldBase.details = t.details || ''; renderDescView(t); }
    renderPeople(t); renderLabelChips(t); renderLinkList(t); renderContactList(t); renderClaim(t); renderDlgTodos(force); renderComments(); renderDlgHistory(t); syncSections(t);
  }
  // Checklist / Links / Contacts show only when they hold something (or were just opened from the add bar)
  const openSecs = new Set();
  function syncSections(t) {
    const has = { todos: t.todos.length, links: t.links.length, contacts: t.contacts.length };
    let hidden = 0;
    document.querySelectorAll('.optsec').forEach(s => { const k = s.dataset.sec, show = !!has[k] || openSecs.has(k); s.hidden = !show; });
    document.querySelectorAll('#addBar button').forEach(b => { const k = b.dataset.sec, show = !has[k] && !openSecs.has(k); b.hidden = !show; if (show) hidden++; });
    $('addBar').hidden = !hidden;
  }
  document.querySelectorAll('#addBar button').forEach(b => { b.onclick = () => {
    const k = b.dataset.sec; openSecs.add(k); const t = taskNow(); if (t) syncSections(t);
    const f = k === 'todos' ? document.querySelector('#cTodos .todonew') : $(k === 'links' ? 'cLinkNew' : 'cContactNew'); if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); } }; });
  function refreshDrawer() { const t = taskNow(); if (!t) { $('dlgCard').close(); return; } fillDrawer(t, false); }   // board data changed underneath an open card

  function openCard(id, focus) {
    const t = state.tasks.find(x => x.id === id); if (!t) return; editing = id; openSecs.clear(); commentsFor = id; cmSig = ''; todoSig = ''; editingDesc = false;
    $('descEdit').hidden = true; $('cDescView').hidden = false; $('cDescBtn').hidden = false; $('dSaved').textContent = '';
    $('dCreated').textContent = t.created ? 'Created ' + new Date(t.created).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + (t.createdBy ? ' by ' + t.createdBy : '') : '';
    fillDrawer(t, true); $('cmText').value = ''; autosize($('cmText')); $('cmActions').hidden = true; $('cmHint').hidden = !!cfg().me; $('cHistWrap').open = false;
    markSeen(id); render();
    $('dlgCard').showModal(); $('cBody').scrollTop = 0; autosize($('cTitle'));
    if (focus === 'comments') setTimeout(() => { $('cmSec').scrollIntoView({ block: 'start' }); $('cmText').focus(); }, 60);
  }
  $('cClose').onclick = () => $('dlgCard').close();
  $('cAgent').onclick = () => { const t = taskNow(); if (t) copyText(agentPrompt(t), 'Task instructions copied for an agent'); };
  $('dlgCard').addEventListener('close', () => { commitTitle(); closeDesc(true); commentsFor = null; });   // closing never loses typed text
  $('cDelete').onclick = () => { const id = editing; if (!confirm(`Delete "${titleOf(id)}"?`)) return; const title = titleOf(id); editingDesc = false; $('dlgCard').close(); mutate(n => { n.tasks = n.tasks.filter(x => x.id !== id); }, `Delete task: ${title}`, [id]); };

  $('xCode').onclick = () => copyText(exportCode(), 'Settings code copied. It contains your token, so paste it only into your own devices.');
  $('xLink').onclick = () => copyText(`${location.origin}${location.pathname}#kbcfg=${exportCode().slice(7)}`, 'Setup link copied. It contains your token, so open it only on your own devices.');
  $('xImport').onclick = () => { const v = $('xPaste').value.trim(); if (!v) { toast('Paste a settings code or setup link first'); return; }
    try { const m = /kbcfg=([A-Za-z0-9_-]+)/.exec(v), o = parseCode(m ? 'kbcfg1.' + m[1] : v);
      if (!confirm(`Import settings${o.repo ? ' for ' + o.repo : ''}${o.token ? ' including the token' : ''}? This replaces this browser's settings.`)) return;
      applyCode(m ? 'kbcfg1.' + m[1] : v); location.reload();
    } catch (e) { toast(e.message); } };
  // ---- settings ---------------------------------------------------------------
  function settingsTab(name) {
    ['general', 'conn'].forEach(n => { const on = n === name; $(n === 'general' ? 'panelGeneral' : 'panelConn').hidden = !on; $(n === 'general' ? 'tabGeneral' : 'tabConn').setAttribute('aria-selected', String(on)); });
    if (name === 'conn') setTimeout(() => $('sRepo').focus(), 30);
  }
  document.querySelectorAll('.stabs button').forEach(b => { b.onclick = () => settingsTab(b.dataset.tab); });
  $('sClose').onclick = $('sDone').onclick = () => $('dlgSettings').close();
  $('btnSettings').onclick = () => { const c = cfg(); $('sVer').textContent = loadedVersion(); settingsTab(c.token ? 'general' : 'conn'); $('sRepo').value = c.repo; $('sBranch').value = c.branch; $('sPath').value = c.path; $('sMe').value = c.me; $('sToken').value = ''; $('sToken').placeholder = c.token ? '(token saved — leave blank to keep)' : 'github_pat_...'; $('dlgSettings').showModal(); };
  const patUrl = () => { const owner = ($('sRepo').value.trim().split('/')[0] || '');
    const q = new URLSearchParams({ name: 'Team Board', description: 'Team board: read and write tasks.json', expires_in: '90', contents: 'write' });
    if (/^[\w.-]+$/.test(owner)) q.set('target_name', owner);
    return 'https://github.com/settings/personal-access-tokens/new?' + q; };
  $('sRepo').addEventListener('input', () => { $('patLink').href = patUrl(); });
  $('btnSettings').addEventListener('click', () => { $('patLink').href = patUrl(); });
  $('sCancel').onclick = () => $('dlgSettings').close();
  $('sForget').onclick = () => { LS.del('kb_token'); $('dlgSettings').close(); state = DEFAULT(); sha = null; lastSyncOk = false; render(); setStatus('Token removed'); };
  $('sSave').onclick = () => {
    LS.set('kb_repo', $('sRepo').value.trim()); LS.set('kb_branch', $('sBranch').value.trim() || 'master'); LS.set('kb_path', $('sPath').value.trim() || 'board/tasks.json'); LS.set('kb_me', $('sMe').value.trim().replace(/^@/, ''));
    if ($('sToken').value.trim()) LS.set('kb_token', $('sToken').value.trim()); $('dlgSettings').close(); load();
  };
  document.querySelectorAll('#viewSw button').forEach(b => { b.onclick = () => setView(b.dataset.view); });
  $('btnUnread').onclick = () => { freshOnly = !freshOnly; render(); };
  $('sMarkAll').onclick = () => { markAllSeen(); render(); toast('All cards marked as read'); };
  $('btnRefresh').onclick = () => load();
  $('btnAgent').onclick = () => copyText(agentPrompt(null), 'Board instructions copied for an agent');
  $('btnFilter').onclick = e => { e.stopPropagation(); const pop = $('filterPop'), open = pop.hidden; closePops(); if (open) { placePop(pop); pop.hidden = false; $('btnFilter').setAttribute('aria-expanded', 'true'); } };
  $('filterPop').addEventListener('click', e => e.stopPropagation()); $('clientPop').addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', closePops); document.addEventListener('keydown', e => { if (e.key === 'Escape') closePops(); });
  $('btnAttn').onclick = () => { $('fAttn').checked = !$('fAttn').checked; render(); };
  $('fClear').onclick = () => { ['fClient', 'fWho', 'fLabel', 'fPrio'].forEach(id => { $(id).value = ''; }); $('fAttn').checked = false; $('fHideDone').checked = false; freshOnly = false; closePops(); render(); };
  { let rz = null; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderTopbar, 120); }); }
  ['fClient', 'fWho', 'fLabel', 'fPrio', 'fAttn', 'fHideDone'].forEach(i => $(i).addEventListener('change', render));
  const canPoll = () => !busy && !document.hidden && !document.querySelector('dialog[open]:not(#dlgCard)') && !document.querySelector('.card.dragging') && lastSyncOk;
  setInterval(() => { if (canPoll()) load(true); }, 30000);   // conditional (ETag) so unchanged polls are 304s
  document.addEventListener('visibilitychange', () => { if (canPoll()) load(true); });  // catch up as soon as the tab is shown again
  setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) render(); }, 60000); // refresh "ago" and stale flags

  $('sStyle').value = window.kbStyle ? window.kbStyle.get() : 'classic'; $('sStyle').onchange = e => { window.kbStyle && window.kbStyle.set(e.target.value); render(); };
  $('sTheme').value = window.kbTheme ? window.kbTheme.get() : 'auto';
  $('sTheme').onchange = e => window.kbTheme && window.kbTheme.set(e.target.value);
  render();
  if (cfg().token) load(); else { setStatus('Not connected. Open Settings.', 'err'); $('btnSettings').click(); }
})();
