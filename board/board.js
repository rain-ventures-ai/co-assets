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
  const setStatus = (m, k = '') => { const s = $('status'); s.textContent = m; s.className = k; };
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
      if (!Array.isArray(t.todos)) t.todos = []; if (!Array.isArray(t.history)) t.history = [];
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
      const data = await res.json(); sha = data.sha; etag = res.headers.get('ETag'); state = normalise(JSON.parse(b64d(data.content))); lastSyncOk = true;
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
  const IGNORE = new Set(['updated', 'updatedBy', 'history']);
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
      const pm = new Map(p.todos.map(d => [d.id, d])), tm = new Map(t.todos.map(d => [d.id, d]));
      t.todos.forEach(d => { const o = pm.get(d.id); if (!o) add('added to-do: ' + d.text); else if (!o.done && d.done) add('✓ ' + d.text); else if (o.done && !d.done) add('reopened: ' + d.text); });
      p.todos.forEach(d => { if (!tm.has(d.id)) add('removed to-do: ' + d.text); });
      if (p.claim && !t.claim) add('claim released'); else if (p.claim && t.claim && p.claim.status !== t.claim.status) add('claim ' + t.claim.status);
    });
  }

  // Apply an edit to the LATEST file on GitHub (never overwrite with stale state); retry on a SHA conflict.
  async function mutate(fn, message, targetIds = []) {
    if (busy) { setStatus('Busy, try again', 'err'); return; }
    busy = true; const before = clone(state); let resolved = false;
    try {
      const o = clone(state); fn(o); state = o; render(); // optimistic
      for (let i = 0; i < 4; i++) {
        const res = await gh('GET');
        if (!res.ok && res.status !== 404) { setStatus(`GitHub error ${res.status}`, 'err'); state = before; render(); return; }
        let latest = DEFAULT();
        if (res.ok) { const d = await res.json(); sha = d.sha; latest = normalise(JSON.parse(b64d(d.content))); } else sha = null;
        const pre = clone(latest); fn(latest);
        if (!resolved) {
          const gone = deletedUnderMe(before, pre, targetIds);
          const conflicts = findConflicts(before, pre, latest);
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
  function filtered(t) {
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
    fillSelect($('fClient'), state.clients.map(c => [c, c]), 'All');
    fillSelect($('fWho'), [...state.people.map(p => [p.github, '@' + p.github]), ['__none', 'Unassigned'], ['__agent', 'Claimed by an agent']], 'Everyone');
    fillSelect($('fLabel'), state.labels.map(l => [l.name, l.name]), 'All');
    const board = $('board'); board.textContent = ''; const hideDone = $('fHideDone').checked;
    state.columns.forEach((col, ci) => {
      if (hideDone && col.id === 'done') return;
      const items = state.tasks.filter(t => t.column === col.id && filtered(t));
      const c = el('section', 'col' + (col.id === activeCol() ? ' active' : '')); c.dataset.col = col.id; const h = el('h2'); h.append(el('span', 'dot'), el('span', 'cname', col.name), el('span', 'count', String(items.length))); c.append(h);
      const cards = el('div', 'cards');
      cards.addEventListener('dragover', e => { e.preventDefault(); c.classList.add('over'); });
      cards.addEventListener('dragleave', () => c.classList.remove('over'));
      cards.addEventListener('drop', e => { e.preventDefault(); c.classList.remove('over'); dropOn(e, col.id, null); });
      items.forEach(t => cards.append(cardEl(t, ci))); if (!items.length) cards.append(el('div', 'emptycol', 'Nothing here. Drop a card or add one below.')); c.append(cards);
      const add = el('div', 'add'), inp = el('input'), btn = el('button', 'primary', 'Add'); inp.placeholder = 'Add a task…';
      const go = () => { const v = inp.value.trim(); if (!v) return; inp.value = ''; addTask(v, col.id); };
      btn.onclick = go; inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      add.append(inp, btn); c.append(add); board.append(c);
    });
    renderStats(); renderTabs();
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
      if (t.links.length) L.push('- links:', ...t.links.map(l => `    ${l.title}: ${l.url}`));
      if (t.contacts.length) L.push('- contacts:', ...t.contacts.map(k => `    ${[k.name, k.role, k.email, k.phone].filter(Boolean).join(' | ')}`));
      if (t.claim) L.push(`- NOTE: already claimed by ${t.claim.agent} (session ${t.claim.session_id || '?'}, ${claimState(t.claim)}). Do not take it over unless the user says so.`);
      L.push('', 'Do this, in order:',
        `1. python3 board/board.py show ${t.id}   (re-read the latest card first)`,
        `2. python3 board/board.py claim ${t.id} --note "starting: <one-line plan>"`,
        `3. Do the work. While working, keep the board current: python3 board/board.py heartbeat ${t.id} --note "<what you are doing>" at each milestone and at least every 10 minutes. Tick off each to-do the moment it is finished: python3 board/board.py todo-done ${t.id} <number>; add any new steps you discover with python3 board/board.py todo-add ${t.id} "<text>". The card keeps a history log automatically.`,
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
    const open = state.tasks.filter(t => t.column !== 'done'), attn = open.filter(needsAttention).length;
    const agents = state.tasks.filter(t => t.claim && ['running', 'stale', 'blocked', 'stuck'].includes(claimState(t.claim))).length;
    const box = $('stats'); box.textContent = '';
    const chip = (txt, cls) => box.append(el('span', 'stat' + (cls ? ' ' + cls : ''), txt));
    chip(`${open.length} open`); if (agents) chip(`${agents} with an agent`, 'agent'); if (attn) chip(`${attn} need attention`, 'warn');
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
  function renderDlgTodos() {
    const t = state.tasks.find(x => x.id === editing), box = $('cTodos'); box.textContent = ''; if (!t) return;
    box.append(todoList(t, true));
  }
  const ago2 = iso => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
  function renderDlgHistory(t) {
    const ol = $('cHist'); ol.textContent = ''; $('cHistSum').textContent = `History (${t.history.length})`;
    t.history.slice().reverse().forEach(h => { const li = el('li'); const tm = el('time', null, ago2(h.at)); tm.title = h.at; li.append(tm, el('b', null, ' ' + (h.by || '?') + ' '), document.createTextNode(h.text)); ol.append(li); });
    if (!t.history.length) ol.append(el('li', null, 'No history yet.'));
  }

  function avatar(login) {
    const p = state.people.find(x => x.github.toLowerCase() === String(login).toLowerCase());
    const name = (p && p.name) || login; let h = 0; for (const ch of String(login).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
    const a = el('span', 'av', name.slice(0, 2).toUpperCase()); a.style.setProperty('--h', h); a.title = '@' + login + (p && p.name ? ' (' + p.name + ')' : ''); return a;
  }

  function cardEl(t, ci) {
    const c = el('div', 'card' + (t.priority ? ' p-' + t.priority : '')); c.draggable = true;
    c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', t.id); c.classList.add('dragging'); });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
    c.addEventListener('dragover', e => e.preventDefault());
    c.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); dropOn(e, t.column, t.id); });
    c.addEventListener('dblclick', () => openCard(t.id));
    const top = el('div', 'top'); if (t.priority) top.append(el('span', 'prio ' + t.priority, t.priority)); top.append(el('span', 'spacer'));
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
  function addTask(title, col) {
    const fc = $('fClient').value, w = $('fWho').value;
    const mine = me() && state.people.some(p => p.github.toLowerCase() === me().toLowerCase()) ? [state.people.find(p => p.github.toLowerCase() === me().toLowerCase()).github] : [];
    const as = w && w[0] !== '_' ? [w] : (w === '__none' ? [] : mine);
    const t = { id: uid(), title, column: col, client: fc || '', priority: 'medium', due: '', labels: [], assignees: as, details: '', links: [], contacts: [], todos: [], history: [], claim: null, created: nowIso(), updated: nowIso() };
    if (me()) { t.createdBy = me(); t.updatedBy = me(); }
    mutate(n => { n.tasks.push(t); }, `Add task: ${title}`);
  }

  // ---- edit dialog ----------------------------------------------------------
  let editing = null;
  const parseLinks = txt => txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const p = l.split('|').map(x => x.trim()); const url = p.length > 1 ? p.slice(1).join('|').trim() : p[0]; return { title: p.length > 1 ? p[0] : url, url }; }).filter(x => safeUrl(x.url));
  const parseContacts = txt => txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const p = l.split('|').map(x => x.trim()); return { name: p[0] || '', role: p[1] || '', email: p[2] || '', phone: p[3] || '' }; });
  const linksText = ls => (ls || []).map(l => l.title && l.title !== l.url ? `${l.title} | ${l.url}` : l.url).join('\n');
  const contactsText = cs => (cs || []).map(c => [c.name, c.role, c.email, c.phone].join(' | ').replace(/( \| )+$/, '')).join('\n');

  function updatePreview() {
    const p = $('cPreview'), txt = $('cDetails').value; p.textContent = '';
    p.hidden = !/https?:\/\//.test(txt); if (!p.hidden) linkify(p, txt);
  }
  function openCard(id) {
    const t = state.tasks.find(x => x.id === id); if (!t) return; editing = id;
    $('cardHeading').textContent = 'Task';
    fillSelect($('cClient'), [['', '(none)'], ...state.clients.map(c => [c, c])]); $('cClient').value = t.client || '';
    fillSelect($('cCol'), state.columns.map(c => [c.id, c.name])); $('cCol').value = t.column;
    const w = $('cWho'); w.textContent = '';
    state.people.concat((t.assignees || []).filter(a => !state.people.some(p => p.github === a)).map(a => ({ github: a, name: a }))).forEach(p => {
      const l = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.value = p.github; cb.checked = t.assignees.includes(p.github); l.append(cb, document.createTextNode('@' + p.github + (p.name && p.name !== p.github ? ` (${p.name})` : ''))); w.append(l);
    });
    $('cTitle').value = t.title; $('cPrio').value = t.priority || 'medium'; $('cDue').value = t.due || '';
    $('cLabels').value = t.labels.join(', '); $('labelList').textContent = ''; state.labels.forEach(l => { const o = el('option'); o.value = l.name; $('labelList').append(o); });
    $('cDetails').value = t.details || ''; $('cLinks').value = linksText(t.links); $('cContacts').value = contactsText(t.contacts);
    updatePreview(); renderDlgTodos(); renderDlgHistory(t); $('cHistWrap').open = false;
    const wrap = $('cClaimWrap'); wrap.hidden = !t.claim; const dl = $('cClaim'); dl.textContent = '';
    if (t.claim) { const k = t.claim, st = claimState(k); [['Agent', k.agent], ['On behalf of', k.on_behalf_of && '@' + k.on_behalf_of], ['State', st], ['Session', k.session_id], ['Session URL', k.session_url], ['Host', k.host], ['Working dir', k.cwd], ['Branch', k.branch], ['Claimed', k.claimed_at && `${k.claimed_at} (${ago(k.claimed_at)})`], ['Last heartbeat', k.heartbeat_at && `${k.heartbeat_at} (${ago(k.heartbeat_at)})`], ['Note', k.note]].forEach(([a, b]) => { if (!b) return; dl.append(el('dt', null, a)); const dd = el('dd'); linkify(dd, b); dl.append(dd); }); }
    $('dlgCard').showModal();
  }
  $('cDetails').addEventListener('input', updatePreview);
  $('cCancel').onclick = () => $('dlgCard').close();
  $('cSave').onclick = () => {
    const id = editing, v = {
      title: $('cTitle').value.trim(), client: $('cClient').value, column: $('cCol').value, priority: $('cPrio').value, due: $('cDue').value,
      assignees: [...$('cWho').querySelectorAll('input:checked')].map(x => x.value), labels: $('cLabels').value.split(',').map(x => x.trim()).filter(Boolean),
      details: $('cDetails').value, links: parseLinks($('cLinks').value), contacts: parseContacts($('cContacts').value),
    };
    if (!v.title) return; $('dlgCard').close();
    mutate(n => {
      const t = n.tasks.find(x => x.id === id); if (!t) return;
      Object.assign(t, { title: v.title, client: v.client, priority: v.priority, due: v.due, assignees: v.assignees, labels: v.labels, details: v.details, links: v.links, contacts: v.contacts }); stamp(t);
      v.labels.forEach(l => { if (!n.labels.some(x => x.name === l)) n.labels.push({ name: l, color: '#6b778c' }); });
      if (t.column !== v.column) place(n, id, v.column, null);
    }, `Edit task: ${v.title}`, [id]);
  };
  $('cDelete').onclick = () => { const id = editing; if (!confirm(`Delete "${titleOf(id)}"?`)) return; const title = titleOf(id); $('dlgCard').close(); mutate(n => { n.tasks = n.tasks.filter(x => x.id !== id); }, `Delete task: ${title}`, [id]); };
  $('cStuck').onclick = () => { const id = editing; $('dlgCard').close(); mutate(n => { const t = n.tasks.find(x => x.id === id); if (t && t.claim) { t.claim.status = 'stuck'; t.claim.note = (t.claim.note ? t.claim.note + ' | ' : '') + `marked stuck by ${me() || 'human'}`; stamp(t); } }, `Mark stuck: ${titleOf(id)}`, [id]); };
  $('cRelease').onclick = () => { const id = editing; if (!confirm('Release the agent claim? The agent session may still be running.')) return; $('dlgCard').close(); mutate(n => { const t = n.tasks.find(x => x.id === id); if (t) { t.claim = null; stamp(t); } }, `Release claim: ${titleOf(id)}`, [id]); };

  // ---- settings ---------------------------------------------------------------
  $('btnSettings').onclick = () => { const c = cfg(); $('sRepo').value = c.repo; $('sBranch').value = c.branch; $('sPath').value = c.path; $('sMe').value = c.me; $('sToken').value = ''; $('sToken').placeholder = c.token ? '(token saved — leave blank to keep)' : 'github_pat_...'; $('dlgSettings').showModal(); };
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
  $('btnRefresh').onclick = () => load();
  $('btnAgent').onclick = () => copyText(agentPrompt(null), 'Board instructions copied for an agent');
  $('btnFilters').onclick = () => { const o = document.body.classList.toggle('filters-open'); $('btnFilters').setAttribute('aria-expanded', String(o)); };
  ['fClient', 'fWho', 'fLabel', 'fPrio', 'fAttn', 'fHideDone'].forEach(i => $(i).addEventListener('change', render));
  const canPoll = () => !busy && !document.hidden && !document.querySelector('dialog[open]') && !document.querySelector('.card.dragging') && lastSyncOk;
  setInterval(() => { if (canPoll()) load(true); }, 30000);   // conditional (ETag) so unchanged polls are 304s
  document.addEventListener('visibilitychange', () => { if (canPoll()) load(true); });  // catch up as soon as the tab is shown again
  setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) render(); }, 60000); // refresh "ago" and stale flags

  $('sTheme').value = window.kbTheme ? window.kbTheme.get() : 'auto';
  $('sTheme').onchange = e => window.kbTheme && window.kbTheme.set(e.target.value);
  render();
  if (cfg().token) load(); else { setStatus('Not connected. Open Settings.', 'err'); $('btnSettings').click(); }
})();
