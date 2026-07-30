/* Падел турніри — mobile-first SPA */

const $ = (sel, root = document) => root.querySelector(sel);
const appEl = $('#app');
const titleEl = $('#title');
const backBtn = $('#backBtn');
const actionBtn = $('#actionBtn');
const tabbar = $('#tabbar');
const toastEl = $('#toast');
const modal = $('#modal');

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  view: 'home',
  players: [],
  tournaments: [],
  t: null,
  tab: 'round',
  roundIdx: 0,
  draft: null,
  linked: localStorage.getItem('linked') !== '0',
  sortBy: localStorage.getItem('sortBy') || 'wins',
};

/* ------------------------------------------------------------------ api */

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || 'Помилка сервера');
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.className = 'show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = ''), 2600);
}

async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
    throw err;
  }
}

function confirmDialog(text, okLabel = 'Так') {
  return new Promise((resolve) => {
    modal.innerHTML = `<h3>${esc(text)}</h3>
      <div class="btn-row">
        <button class="btn sec" value="no">Скасувати</button>
        <button class="btn danger" value="yes">${esc(okLabel)}</button>
      </div>`;
    modal.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      modal.close();
      resolve(b.value === 'yes');
    };
    modal.showModal();
  });
}

/* -------------------------------------------------------------- routing */

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'players') state.view = 'players';
  else if (parts[0] === 'new') state.view = 'new';
  else if (parts[0] === 't' && parts[1]) {
    state.view = 'tournament';
    if (!state.t || String(state.t.tournament.id) !== parts[1]) {
      state.t = null;
      render();
      state.t = await guard(() => api('GET', '/tournaments/' + parts[1]));
      state.roundIdx = Math.max(0, state.t.rounds.length - 1);
      state.tab = 'round';
    }
  } else state.view = 'home';

  if (state.view === 'home') state.tournaments = await guard(() => api('GET', '/tournaments'));
  if (state.view === 'players' || state.view === 'new')
    state.players = await guard(() => api('GET', '/players'));
  render();
}

window.addEventListener('hashchange', route);

/* --------------------------------------------------------------- render */

function render() {
  backBtn.hidden = state.view === 'home' || state.view === 'players';
  actionBtn.hidden = true;
  for (const b of tabbar.querySelectorAll('button'))
    b.classList.toggle('active', b.dataset.nav === state.view);

  if (state.view === 'home') return renderHome();
  if (state.view === 'players') return renderPlayers();
  if (state.view === 'new') return renderNew();
  if (state.view === 'tournament') return renderTournament();
}

const FMT = { mexicano: 'Мексикано', americano: 'Американо' };

function renderHome() {
  titleEl.textContent = 'Турніри';
  const list = state.tournaments;
  appEl.innerHTML =
    `<button class="btn" data-act="new">+ Новий турнір</button>` +
    (list.length
      ? `<div style="height:16px"></div>` +
        list
          .map(
            (t) => `<div class="card tap" data-act="open" data-id="${t.id}">
        <div class="row between">
          <div class="grow">
            <p class="t-name">${esc(t.name)}</p>
            <div class="meta">${t.playerCount} гравців · ${t.courts} корт${t.courts > 1 ? 'и' : ''} · до ${t.pointsPerGame} · раундів: ${t.roundCount}</div>
          </div>
          <span class="badge ${t.status === 'finished' ? 'finished' : t.format}">${t.status === 'finished' ? 'завершено' : FMT[t.format]}</span>
        </div>
      </div>`,
          )
          .join('')
      : `<div class="empty"><strong>Ще немає турнірів</strong>Створіть перший — це займе 20 секунд</div>`);
}

function renderPlayers() {
  titleEl.textContent = 'Гравці';
  appEl.innerHTML =
    `<div class="row" style="gap:8px;margin-bottom:14px">
       <input type="text" id="newPlayer" placeholder="Імʼя гравця" autocomplete="off" />
       <button class="btn sm" data-act="addPlayer" style="min-height:50px">Додати</button>
     </div>` +
    (state.players.length
      ? `<div class="list">${state.players
          .map(
            (p) => `<div class="player-row">
              <div class="grow">${esc(p.name)}<div class="meta">турнірів: ${p.tournaments}</div></div>
              <button class="mini" data-act="renamePlayer" data-id="${p.id}" data-name="${esc(p.name)}">✎</button>
              <button class="mini" data-act="delPlayer" data-id="${p.id}" data-name="${esc(p.name)}">🗑</button>
            </div>`,
          )
          .join('')}</div>`
      : `<div class="empty"><strong>Список порожній</strong>Додайте гравців — вони збережуться для наступних турнірів</div>`);
}

const POINT_PRESETS = [11, 16, 21, 24, 32];

function renderNew() {
  titleEl.textContent = 'Новий турнір';
  if (!state.draft)
    state.draft = {
      name: '',
      format: 'mexicano',
      courts: 1,
      pointsPerGame: 21,
      playerIds: [],
    };
  const d = state.draft;
  const maxPlayers = d.courts * 4;

  appEl.innerHTML = `
    <label class="field"><span>Назва</span>
      <input type="text" id="tName" value="${esc(d.name)}" placeholder="Напр. Четверговий падел" autocomplete="off"/>
    </label>

    <label class="field"><span>Формат</span>
      <div class="seg">
        <button data-act="fmt" data-v="mexicano" class="${d.format === 'mexicano' ? 'on' : ''}">Мексикано</button>
        <button data-act="fmt" data-v="americano" class="${d.format === 'americano' ? 'on' : ''}">Американо</button>
      </div>
      <div class="meta" style="margin-top:7px">${
        d.format === 'mexicano'
          ? 'Пари складаються за поточним рейтингом: 1+4 проти 2+3 на першому корті, далі за списком.'
          : 'Партнери постійно змінюються, повтори пар і суперників мінімізуються.'
      }</div>
    </label>

    <label class="field"><span>Кортів</span>
      <div class="stepper">
        <button data-act="courts" data-v="-1">−</button>
        <input type="number" inputmode="numeric" id="courts" value="${d.courts}" min="1" max="12"/>
        <button data-act="courts" data-v="1">+</button>
      </div>
      <div class="meta" style="margin-top:7px">Одночасно грає ${maxPlayers} гравц${maxPlayers === 4 ? 'і' : 'ів'}. Решта відпочиває по черзі.</div>
    </label>

    <label class="field"><span>Гра до скількох поінтів</span>
      <div class="chips" style="margin-bottom:8px">
        ${POINT_PRESETS.map(
          (p) => `<button class="chip ${d.pointsPerGame === p ? 'on' : ''}" data-act="pts" data-v="${p}">${p}</button>`,
        ).join('')}
      </div>
      <div class="stepper">
        <button data-act="ptsStep" data-v="-1">−</button>
        <input type="number" inputmode="numeric" id="pts" value="${d.pointsPerGame}" min="1" max="200"/>
        <button data-act="ptsStep" data-v="1">+</button>
      </div>
    </label>

    <div class="section-title">Гравці · обрано ${d.playerIds.length}</div>
    <div class="chips">
      ${state.players
        .map(
          (p) =>
            `<button class="chip ${d.playerIds.includes(p.id) ? 'on' : ''}" data-act="togglePlayer" data-id="${p.id}">${esc(p.name)}</button>`,
        )
        .join('')}
      <button class="chip add" data-act="quickAdd">+ Новий</button>
    </div>
    ${d.playerIds.length && d.playerIds.length < 4 ? '<div class="meta" style="margin-top:10px">Потрібно щонайменше 4 гравці</div>' : ''}

    <div style="height:20px"></div>
    <button class="btn" data-act="createT" ${d.playerIds.length < 4 ? 'disabled' : ''}>Створити турнір</button>
  `;
}

/* ---------------------------------------------------------- турнір */

function renderTournament() {
  if (!state.t) {
    appEl.innerHTML = '<div class="loader">Завантаження…</div>';
    return;
  }
  const { tournament: t, players, rounds } = state.t;
  titleEl.textContent = (t.status === 'finished' ? '🏁 ' : '') + t.name;
  actionBtn.hidden = false;
  actionBtn.textContent = '⋯';

  appEl.innerHTML = `
    <div class="tabs">
      <button data-act="tab" data-v="round" class="${state.tab === 'round' ? 'on' : ''}">Раунд</button>
      <button data-act="tab" data-v="table" class="${state.tab === 'table' ? 'on' : ''}">Таблиця</button>
      <button data-act="tab" data-v="squad" class="${state.tab === 'squad' ? 'on' : ''}">Склад</button>
    </div>
    <div id="tabBody"></div>`;

  const body = $('#tabBody');
  if (state.tab === 'round') body.innerHTML = roundHtml();
  else if (state.tab === 'table') body.innerHTML = tableHtml();
  else body.innerHTML = squadHtml();
}

function nameOf(id) {
  const p = state.t.players.find((x) => x.id === id);
  return p ? p.name : '—';
}

const FINISHED_NOTE = `<div class="byes" style="border-color:rgba(240,103,74,.4);color:var(--fg)">
    🏁 Турнір завершено. Нові раунди не створюються.
  </div>
  <button class="btn sec" data-act="resume">Відновити турнір</button>`;

function roundHtml() {
  const { tournament: t, rounds } = state.t;
  const finished = t.status === 'finished';
  if (!rounds.length) {
    return `<div class="empty"><strong>${finished ? 'Турнір завершено' : 'Турнір готовий до старту'}</strong>
        ${FMT[t.format]} · ${state.t.players.length} гравців · ${t.courts} корт${t.courts > 1 ? 'и' : ''} · до ${t.pointsPerGame} поінтів</div>
      ${finished ? FINISHED_NOTE : '<button class="btn" data-act="nextRound">Згенерувати 1-й раунд</button>'}`;
  }
  state.roundIdx = Math.min(state.roundIdx, rounds.length - 1);
  const r = rounds[state.roundIdx];
  const isLast = state.roundIdx === rounds.length - 1;
  const filled = r.matches.every((m) => m.scoreA != null && m.scoreB != null);
  const untouched = r.matches.every((m) => m.scoreA == null && m.scoreB == null);

  const matches = r.matches
    .map((m) => {
      const aWin = m.scoreA != null && m.scoreB != null && m.scoreA > m.scoreB;
      const bWin = m.scoreA != null && m.scoreB != null && m.scoreB > m.scoreA;
      return `<div class="match">
      <div class="match-head"><span>Корт ${m.court}</span><span>до ${t.pointsPerGame}</span></div>
      ${teamHtml(m, 'A', aWin)}
      ${teamHtml(m, 'B', bWin)}
    </div>`;
    })
    .join('');

  const byes = r.byes.length
    ? `<div class="byes">🪑 Відпочивають: ${r.byes.map((id) => esc(nameOf(id))).join(', ')}</div>`
    : '';

  return `
    <div class="round-nav">
      <button class="icon-btn" data-act="round" data-v="-1" ${state.roundIdx === 0 ? 'disabled style="opacity:.35"' : ''}>‹</button>
      <div class="label">Раунд ${r.number} <span class="meta">з ${rounds.length}</span></div>
      <button class="icon-btn" data-act="round" data-v="1" ${isLast ? 'disabled style="opacity:.35"' : ''}>›</button>
    </div>
    ${byes}
    ${matches}
    <label class="row" style="gap:8px;margin:14px 2px;color:var(--fg-dim);font-size:14px">
      <input type="checkbox" data-act="linked" ${state.linked ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)"/>
      Автоматично рахувати рахунок суперника до ${t.pointsPerGame}
    </label>
    ${
      !isLast
        ? ''
        : finished
          ? FINISHED_NOTE
          : `<button class="btn" data-act="nextRound" ${filled ? '' : 'disabled'}>Наступний раунд →</button>
           <div class="btn-row">
             ${untouched ? '<button class="btn sec sm" style="flex:1" data-act="reshuffle">🔀 Перемішати</button>' : ''}
             <button class="btn danger sm" style="flex:1" data-act="delRound">Видалити раунд</button>
           </div>
           ${filled ? '' : '<div class="meta" style="text-align:center;margin-top:10px">Внесіть рахунок усіх матчів, щоб створити наступний раунд</div>'}`
    }`;
}

function teamHtml(m, side, win) {
  const p1 = side === 'A' ? m.a1 : m.b1;
  const p2 = side === 'A' ? m.a2 : m.b2;
  const score = side === 'A' ? m.scoreA : m.scoreB;
  return `<div class="team ${win ? 'win' : ''}">
    <div class="team-names"><b>${esc(nameOf(p1))}</b><b>${esc(nameOf(p2))}</b></div>
    <div class="score-box">
      <button data-act="score" data-id="${m.id}" data-side="${side}" data-d="-1">−</button>
      <input type="number" inputmode="numeric" pattern="[0-9]*" data-score="${m.id}" data-side="${side}"
             value="${score ?? ''}" placeholder="–" />
      <button data-act="score" data-id="${m.id}" data-side="${side}" data-d="1">+</button>
    </div>
  </div>`;
}

function tableHtml() {
  const rows = [...state.t.standings];
  if (state.sortBy === 'points')
    rows.sort((a, b) => b.pointsFor - a.pointsFor || b.wins - a.wins || b.diff - a.diff);
  else rows.sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor || b.diff - a.diff);
  rows.forEach((r, i) => (r._rank = i + 1));

  if (!state.t.rounds.length)
    return '<div class="empty"><strong>Ще немає зіграних матчів</strong>Таблиця зʼявиться після першого раунду</div>';

  return `
    <div class="seg" style="margin-bottom:14px">
      <button data-act="sort" data-v="wins" class="${state.sortBy === 'wins' ? 'on' : ''}">За перемогами</button>
      <button data-act="sort" data-v="points" class="${state.sortBy === 'points' ? 'on' : ''}">За мʼячами</button>
    </div>
    <table class="standings">
      <thead><tr>
        <th></th><th>Гравець</th><th>І</th><th>В</th><th>Мʼячі</th><th>±</th>
      </tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr class="${r._rank <= 3 ? 'top' : ''}">
          <td class="rank">${r._rank}</td>
          <td>${esc(r.name)}</td>
          <td>${r.gamesPlayed}</td>
          <td class="${state.sortBy === 'wins' ? 'hl' : ''}">${r.wins}</td>
          <td class="${state.sortBy === 'points' ? 'hl' : ''}">${r.pointsFor}</td>
          <td style="color:${r.diff > 0 ? 'var(--accent)' : r.diff < 0 ? 'var(--red)' : 'var(--fg-dim)'}">${r.diff > 0 ? '+' : ''}${r.diff}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    <div class="legend">І — зіграно ігор · В — виграно ігор · Мʼячі — набрано поінтів · ± — різниця мʼячів</div>`;
}

function squadHtml() {
  const inT = new Set(state.t.players.map((p) => p.id));
  const others = state.players.filter((p) => !inT.has(p.id));
  return `
    <div class="section-title">У турнірі · ${state.t.players.length}</div>
    <div class="list">
      ${state.t.players
        .map(
          (p) => `<div class="player-row">
            <div class="grow">${esc(p.name)}</div>
            <button class="mini" data-act="renameInT" data-id="${p.id}" data-name="${esc(p.name)}">✎</button>
            <button class="mini" data-act="removeFromT" data-id="${p.id}">✕</button>
          </div>`,
        )
        .join('')}
    </div>
    <div class="section-title">Додати з бази</div>
    <div class="chips">
      ${others.map((p) => `<button class="chip" data-act="addToT" data-id="${p.id}">+ ${esc(p.name)}</button>`).join('')}
      <button class="chip add" data-act="quickAddToT">+ Новий гравець</button>
    </div>
    <div class="meta" style="margin-top:14px">Нових гравців можна додавати посеред турніру — вони підключаться з наступного раунду.</div>`;
}

/* ------------------------------------------------------------ дії */

let saveTimers = {};

function findMatch(id) {
  for (const r of state.t.rounds) {
    const m = r.matches.find((x) => x.id === Number(id));
    if (m) return m;
  }
  return null;
}

function setScore(matchId, side, value) {
  const m = findMatch(matchId);
  if (!m) return;
  const N = state.t.tournament.pointsPerGame;
  const v = value === '' || value == null ? null : Math.max(0, Math.min(200, Number(value)));
  if (side === 'A') m.scoreA = v;
  else m.scoreB = v;
  if (state.linked && v != null) {
    const other = Math.max(0, N - v);
    if (side === 'A') m.scoreB = other;
    else m.scoreA = other;
  }
  queueSave(m);
}

function queueSave(m) {
  clearTimeout(saveTimers[m.id]);
  saveTimers[m.id] = setTimeout(async () => {
    try {
      const fresh = await api('PATCH', '/matches/' + m.id, { scoreA: m.scoreA, scoreB: m.scoreB });
      const idx = state.roundIdx;
      const tab = state.tab;
      state.t = fresh;
      state.roundIdx = idx;
      state.tab = tab;
      if (state.tab === 'round') $('#tabBody').innerHTML = roundHtml();
      else renderTournament();
    } catch (err) {
      toast(err.message, true);
    }
  }, 600);
}

async function promptName(title) {
  return new Promise((resolve) => {
    modal.innerHTML = `<h3>${esc(title)}</h3>
      <input type="text" id="pn" autocomplete="off" placeholder="Імʼя" />
      <div class="btn-row">
        <button class="btn sec" value="no">Скасувати</button>
        <button class="btn" value="yes">Зберегти</button>
      </div>`;
    modal.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const val = $('#pn', modal).value.trim();
      modal.close();
      resolve(b.value === 'yes' && val ? val : null);
    };
    modal.showModal();
    setTimeout(() => $('#pn', modal).focus(), 50);
  });
}

async function reloadT(keep = true) {
  const idx = state.roundIdx;
  const tab = state.tab;
  state.t = await api('GET', '/tournaments/' + state.t.tournament.id);
  state.roundIdx = keep ? Math.min(idx, Math.max(0, state.t.rounds.length - 1)) : state.t.rounds.length - 1;
  state.tab = tab;
  renderTournament();
}

appEl.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const d = state.draft;

  try {
    switch (act) {
      case 'new':
        state.draft = null;
        go('#/new');
        break;
      case 'open':
        go('#/t/' + el.dataset.id);
        break;

      /* --- створення --- */
      case 'fmt':
        d.name = $('#tName').value;
        d.format = el.dataset.v;
        renderNew();
        break;
      case 'courts': {
        d.name = $('#tName').value;
        d.courts = Math.max(1, Math.min(12, Number($('#courts').value) + Number(el.dataset.v)));
        renderNew();
        break;
      }
      case 'pts':
        d.name = $('#tName').value;
        d.pointsPerGame = Number(el.dataset.v);
        renderNew();
        break;
      case 'ptsStep':
        d.name = $('#tName').value;
        d.pointsPerGame = Math.max(1, Math.min(200, Number($('#pts').value) + Number(el.dataset.v)));
        renderNew();
        break;
      case 'togglePlayer': {
        d.name = $('#tName').value;
        const id = Number(el.dataset.id);
        d.playerIds = d.playerIds.includes(id)
          ? d.playerIds.filter((x) => x !== id)
          : [...d.playerIds, id];
        renderNew();
        break;
      }
      case 'quickAdd': {
        d.name = $('#tName').value;
        const nm = await promptName('Новий гравець');
        if (!nm) break;
        const p = await api('POST', '/players', { name: nm });
        state.players = await api('GET', '/players');
        if (!d.playerIds.includes(p.id)) d.playerIds.push(p.id);
        renderNew();
        break;
      }
      case 'createT': {
        d.name = $('#tName').value.trim();
        d.courts = Math.max(1, Number($('#courts').value) || 1);
        d.pointsPerGame = Math.max(1, Number($('#pts').value) || 21);
        const created = await api('POST', '/tournaments', d);
        state.t = created;
        state.draft = null;
        state.roundIdx = 0;
        state.tab = 'round';
        go('#/t/' + created.tournament.id);
        break;
      }

      /* --- глобальні гравці --- */
      case 'addPlayer': {
        const nm = $('#newPlayer').value.trim();
        if (!nm) break;
        await api('POST', '/players', { name: nm });
        state.players = await api('GET', '/players');
        renderPlayers();
        toast('Додано');
        break;
      }
      case 'renamePlayer': {
        const nm = await promptName('Перейменувати: ' + el.dataset.name);
        if (!nm) break;
        await api('PATCH', '/players/' + el.dataset.id, { name: nm });
        state.players = await api('GET', '/players');
        renderPlayers();
        break;
      }
      case 'delPlayer': {
        if (!(await confirmDialog(`Прибрати «${el.dataset.name}» зі списку?`, 'Прибрати'))) break;
        await api('DELETE', '/players/' + el.dataset.id);
        state.players = await api('GET', '/players');
        renderPlayers();
        break;
      }

      /* --- турнір --- */
      case 'tab':
        state.tab = el.dataset.v;
        if (state.tab === 'squad') state.players = await api('GET', '/players');
        renderTournament();
        break;
      case 'round':
        state.roundIdx = Math.max(
          0,
          Math.min(state.t.rounds.length - 1, state.roundIdx + Number(el.dataset.v)),
        );
        $('#tabBody').innerHTML = roundHtml();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'score': {
        const m = findMatch(el.dataset.id);
        const side = el.dataset.side;
        const cur = side === 'A' ? m.scoreA : m.scoreB;
        setScore(el.dataset.id, side, Math.max(0, (cur ?? 0) + Number(el.dataset.d)));
        $('#tabBody').innerHTML = roundHtml();
        break;
      }
      case 'nextRound':
        el.disabled = true;
        state.t = await api('POST', `/tournaments/${state.t.tournament.id}/rounds`);
        state.roundIdx = state.t.rounds.length - 1;
        renderTournament();
        window.scrollTo({ top: 0 });
        break;
      case 'resume':
        state.t = await api('PATCH', '/tournaments/' + state.t.tournament.id, { status: 'active' });
        renderTournament();
        toast('Турнір відновлено');
        break;
      case 'reshuffle':
        state.t = await api('POST', `/tournaments/${state.t.tournament.id}/rounds/reshuffle`);
        renderTournament();
        toast('Перемішано');
        break;
      case 'delRound':
        if (!(await confirmDialog('Видалити останній раунд?', 'Видалити'))) break;
        state.t = await api('DELETE', `/tournaments/${state.t.tournament.id}/rounds/last`);
        state.roundIdx = Math.max(0, state.t.rounds.length - 1);
        renderTournament();
        break;
      case 'sort':
        state.sortBy = el.dataset.v;
        localStorage.setItem('sortBy', state.sortBy);
        $('#tabBody').innerHTML = tableHtml();
        break;
      case 'addToT':
        state.t = await api('POST', `/tournaments/${state.t.tournament.id}/players`, {
          playerId: Number(el.dataset.id),
        });
        renderTournament();
        break;
      case 'renameInT': {
        const nm = await promptName('Перейменувати: ' + el.dataset.name);
        if (!nm) break;
        await api('PATCH', '/players/' + el.dataset.id, { name: nm });
        state.players = await api('GET', '/players');
        state.t = await api('GET', '/tournaments/' + state.t.tournament.id);
        renderTournament();
        toast('Перейменовано');
        break;
      }
      case 'removeFromT':
        state.t = await api(
          'DELETE',
          `/tournaments/${state.t.tournament.id}/players/${el.dataset.id}`,
        );
        renderTournament();
        break;
      case 'quickAddToT': {
        const nm = await promptName('Новий гравець');
        if (!nm) break;
        const p = await api('POST', '/players', { name: nm });
        state.players = await api('GET', '/players');
        state.t = await api('POST', `/tournaments/${state.t.tournament.id}/players`, {
          playerId: p.id,
        });
        renderTournament();
        break;
      }
    }
  } catch (err) {
    toast(err.message, true);
    if (state.view === 'tournament' && state.t) renderTournament();
  }
});

appEl.addEventListener('change', (e) => {
  const el = e.target.closest('[data-act="linked"]');
  if (el) {
    state.linked = el.checked;
    localStorage.setItem('linked', state.linked ? '1' : '0');
  }
});

appEl.addEventListener('input', (e) => {
  const el = e.target.closest('[data-score]');
  if (!el) return;
  setScore(el.dataset.score, el.dataset.side, el.value);
});

appEl.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Enter' && e.target.id === 'newPlayer') {
      e.preventDefault();
      appEl.querySelector('[data-act="addPlayer"]').click();
    }
  },
  true,
);

backBtn.addEventListener('click', () => history.back());

actionBtn.addEventListener('click', async () => {
  if (state.view !== 'tournament' || !state.t) return;
  const t = state.t.tournament;
  modal.innerHTML = `<h3>${esc(t.name)}</h3>
    <div class="meta" style="margin-bottom:14px">${FMT[t.format]} · ${t.courts} корт(и) · до ${t.pointsPerGame} поінтів</div>
    <button class="btn sec" value="rename" style="margin-bottom:8px">Перейменувати</button>
    <button class="btn sec" value="courts" style="margin-bottom:8px">Змінити кількість кортів</button>
    <button class="btn sec" value="points" style="margin-bottom:8px">Змінити кількість поінтів</button>
    <button class="btn sec" value="status" style="margin-bottom:8px">${t.status === 'finished' ? 'Відновити турнір' : 'Завершити турнір'}</button>
    <button class="btn danger" value="delete">Видалити турнір</button>`;
  modal.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    modal.close();
    try {
      if (b.value === 'rename') {
        const nm = await promptName('Назва турніру');
        if (nm) state.t = await api('PATCH', '/tournaments/' + t.id, { name: nm });
      } else if (b.value === 'courts') {
        const v = prompt('Кількість кортів', t.courts);
        if (v) state.t = await api('PATCH', '/tournaments/' + t.id, { courts: Number(v) });
      } else if (b.value === 'points') {
        const v = prompt('До скількох поінтів', t.pointsPerGame);
        if (v) state.t = await api('PATCH', '/tournaments/' + t.id, { pointsPerGame: Number(v) });
      } else if (b.value === 'status') {
        state.t = await api('PATCH', '/tournaments/' + t.id, {
          status: t.status === 'finished' ? 'active' : 'finished',
        });
      } else if (b.value === 'delete') {
        if (!(await confirmDialog('Видалити турнір разом з усіма раундами?', 'Видалити'))) return;
        await api('DELETE', '/tournaments/' + t.id);
        state.t = null;
        go('#/');
        return;
      }
      renderTournament();
    } catch (err) {
      toast(err.message, true);
    }
  };
  modal.showModal();
});

tabbar.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.t = null;
  go(b.dataset.nav === 'home' ? '#/' : '#/players');
});

route();
