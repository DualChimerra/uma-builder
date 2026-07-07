// Рендеринг вкладок

import {
  db, TYPES, TYPE_NAMES, RARITY_NAMES, cardPool, cardImg, cardFullImg,
  skillImg, cardName, gametoraCardUrl, maxLevel, skillSourcesInPool,
} from './data.js';
import * as store from './store.js';
import { buildDeck } from './builder.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 2600);
}

// ============ МОДАЛКА ============
export function openModal(html) {
  $('#modal-content').innerHTML = `<button class="modal-close" onclick="document.getElementById('modal').hidden=true">✕</button>${html}`;
  $('#modal').hidden = false;
}
document.addEventListener('click', (e) => {
  if (e.target.id === 'modal') $('#modal').hidden = true;
  if (!e.target.closest('.skill-picker')) {
    const r = $('#skill-results');
    if (r) r.hidden = true;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#modal').hidden = true;
});

export function showCardModal(id) {
  const c = db.cardById.get(id);
  if (!c) return;
  const lb = store.invHas(id) ? store.invLb(id) : 4;
  const skillRow = (sid, tag) => {
    const s = db.skillById.get(sid);
    if (!s) return '';
    return `<div class="skill-item ${s.rarity === 2 ? 'gold' : ''}">
      <img src="${skillImg(s.icon)}" alt="" loading="lazy">
      <div><div class="sname">${esc(s.name)}${s.rarity === 2 ? '<span class="gold-tag">GOLD</span>' : ''}${tag}</div>
      <div class="sdesc">${esc(s.desc)}</div></div></div>`;
  };
  const effRows = (c.effects || []).map((row) => {
    const eff = db.effects.get(row[0]);
    if (!eff) return '';
    // колонки: [id, lv1, lv5, lv10, ..., lv50] — берём последнее известное значение
    const vals = row.slice(1).filter((v) => v !== -1);
    const val = vals.length ? vals[vals.length - 1] : '?';
    const sym = eff.symbol === 'percent' ? '%' : '';
    return `<tr><td title="${esc(eff.desc)}">${esc(eff.name)}</td><td>${val}${sym}</td></tr>`;
  }).join('');

  openModal(`
    <div class="card-modal-head">
      <img src="${cardFullImg(c.id)}" alt="" onerror="this.src='${cardImg(c.id)}'">
      <div class="meta">
        <h2>${esc(cardName(c))}</h2>
        <div class="meta-row"><span class="type-dot t-${c.type}"></span>${TYPE_NAMES[c.type]} · ${RARITY_NAMES[c.rarity]} · макс. ур. ${maxLevel(c.rarity, lb)} (LB${lb})</div>
        <div class="meta-row">Релиз (Global): ${c.release_en || '—'} · JP: ${c.release || '—'}</div>
        <div class="meta-row">${store.invHas(id) ? `✅ В инвентаре (LB${store.invLb(id)})` : 'Нет в инвентаре'}</div>
        <div class="meta-row" style="margin-top:8px">
          <button class="btn" data-inv-toggle="${id}">${store.invHas(id) ? 'Убрать из инвентаря' : 'Добавить в инвентарь'}</button>
          <a class="btn" href="${gametoraCardUrl(c)}" target="_blank" rel="noopener" style="text-decoration:none">GameTora ↗</a>
        </div>
      </div>
    </div>
    ${c.hints.length ? `<h3>Скиллы-хинты</h3>${c.hints.map((s) => skillRow(s, '')).join('')}` : ''}
    ${c.events.length ? `<h3>Скиллы из ивентов</h3>${c.events.map((s) => skillRow(s, '<span class="src-tag src-event">ивент</span>')).join('')}` : ''}
    ${effRows ? `<h3>Эффекты поддержки (макс. значения)</h3><table class="effects-table">${effRows}</table>` : ''}
  `);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-inv-toggle]');
  if (t) {
    const id = Number(t.dataset.invToggle);
    store.invToggle(id);
    toast(store.invHas(id) ? 'Добавлено в инвентарь' : 'Убрано из инвентаря');
    showCardModal(id);
    refreshInvCount();
    rerenderCurrent();
  }
  const cardEl = e.target.closest('[data-card-modal]');
  if (cardEl) showCardModal(Number(cardEl.dataset.cardModal));
});

export function refreshInvCount() {
  $('#inv-count').textContent = store.invCount();
}

// текущее видимое вью для перерисовки
let currentView = 'deck';
const renderers = {};
export function setCurrent(v) { currentView = v; }
export function rerenderCurrent() { renderers[currentView]?.(); }

// ============ КАРТЫ ============
const cardsFilter = { q: '', types: new Set(), rarity: 0, ownedOnly: false };

renderers.cards = renderCards;
export function renderCards() {
  const root = $('#view-cards');
  const pool = cardPool(store.state.settings.globalOnly);

  root.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input class="input search-input" id="cards-q" placeholder="Поиск по имени или названию…" value="${esc(cardsFilter.q)}">
        <div class="chip-row" id="cards-types">
          ${TYPES.map((t) => `<button class="chip t-${t} ${cardsFilter.types.has(t) ? 'active' : ''}" data-t="${t}"><span class="type-dot t-${t}"></span>${TYPE_NAMES[t]}</button>`).join('')}
        </div>
        <div class="chip-row" id="cards-rarity">
          ${[3, 2, 1].map((r) => `<button class="chip ${cardsFilter.rarity === r ? 'active' : ''}" data-r="${r}">${RARITY_NAMES[r]}</button>`).join('')}
        </div>
        <button class="chip ${cardsFilter.ownedOnly ? 'active' : ''}" id="cards-owned">Только мои</button>
      </div>
      <div class="card-grid" id="cards-grid"></div>
      <p class="count-note" id="cards-count"></p>
    </div>`;

  const grid = $('#cards-grid', root);
  const apply = () => {
    const q = cardsFilter.q.toLowerCase();
    const list = pool.filter((c) =>
      (!q || c.char.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)) &&
      (!cardsFilter.types.size || cardsFilter.types.has(c.type)) &&
      (!cardsFilter.rarity || c.rarity === cardsFilter.rarity) &&
      (!cardsFilter.ownedOnly || store.invHas(c.id)),
    ).sort((a, b) => b.rarity - a.rarity || a.char.localeCompare(b.char));
    grid.innerHTML = list.map((c) => cardTile(c)).join('') || '<p class="empty-note">Ничего не найдено</p>';
    $('#cards-count', root).textContent = `Показано карт: ${list.length} из ${pool.length}`;
  };

  $('#cards-q', root).addEventListener('input', (e) => { cardsFilter.q = e.target.value; apply(); });
  $('#cards-types', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    cardsFilter.types.has(b.dataset.t) ? cardsFilter.types.delete(b.dataset.t) : cardsFilter.types.add(b.dataset.t);
    b.classList.toggle('active');
    apply();
  });
  $('#cards-rarity', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    cardsFilter.rarity = cardsFilter.rarity === Number(b.dataset.r) ? 0 : Number(b.dataset.r);
    renderCards();
  });
  $('#cards-owned', root).addEventListener('click', () => { cardsFilter.ownedOnly = !cardsFilter.ownedOnly; renderCards(); });
  apply();
}

function cardTile(c, { lbStepper = false } = {}) {
  const owned = store.invHas(c.id);
  return `<div class="ucard t-${c.type} ${owned ? 'owned' : ''}" data-card="${c.id}">
    <span class="rarity-badge rarity-${c.rarity}">${RARITY_NAMES[c.rarity]}</span>
    ${owned ? '<span class="own-badge">✓</span>' : ''}
    <img class="art" src="${cardImg(c.id)}" alt="" loading="lazy">
    <div class="cname"><span class="type-dot t-${c.type}"></span>${esc(c.char)}</div>
    <div class="ctitle">${esc(c.title)}</div>
    ${lbStepper && owned ? lbStepperHtml(c.id) : ''}
  </div>`;
}

function lbStepperHtml(id) {
  const lb = store.invLb(id);
  return `<div class="lb-stepper" data-lb-for="${id}">
    <button data-lb-dec>−</button>
    <span class="lb-dots">${[0, 1, 2, 3].map((i) => `<span class="lb-dot ${i < lb ? 'on' : ''}"></span>`).join('')}</span>
    <button data-lb-inc>+</button>
  </div>`;
}

document.addEventListener('click', (e) => {
  const stepBtn = e.target.closest('[data-lb-dec],[data-lb-inc]');
  if (stepBtn) {
    e.stopPropagation();
    const wrap = stepBtn.closest('[data-lb-for]');
    const id = Number(wrap.dataset.lbFor);
    store.invSetLb(id, store.invLb(id) + (stepBtn.hasAttribute('data-lb-inc') ? 1 : -1));
    wrap.outerHTML = lbStepperHtml(id);
    return;
  }
  const tile = e.target.closest('[data-card]');
  if (tile) showCardModal(Number(tile.dataset.card));
});

// ============ СКИЛЛЫ ============
const skillsFilter = { q: '', gold: 0 }; // gold: 0 все, 2 золотые, 1 обычные

renderers.skills = renderSkills;
export function renderSkills() {
  const root = $('#view-skills');
  root.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input class="input search-input" id="skills-q" placeholder="Поиск скилла…" value="${esc(skillsFilter.q)}">
        <div class="chip-row">
          <button class="chip ${skillsFilter.gold === 2 ? 'active' : ''}" id="sk-gold">🥇 Золотые</button>
          <button class="chip ${skillsFilter.gold === 1 ? 'active' : ''}" id="sk-white">Обычные</button>
        </div>
      </div>
      <div class="skill-list" id="skills-list"></div>
      <p class="count-note" id="skills-count"></p>
    </div>`;

  const pool = cardPool(store.state.settings.globalOnly);
  const poolIds = new Set(pool.map((c) => c.id));

  const apply = () => {
    const q = skillsFilter.q.toLowerCase();
    const list = db.skills.filter((s) =>
      (!q || s.name.toLowerCase().includes(q) || (s.name_jp || '').includes(skillsFilter.q)) &&
      (!skillsFilter.gold || s.rarity === skillsFilter.gold) &&
      skillSourcesInPool(s.id, poolIds).length > 0,
    );
    $('#skills-list', root).innerHTML = list.map((s) => `
      <div class="skill-item ${s.rarity === 2 ? 'gold' : ''}" data-skill-modal="${s.id}">
        <img src="${skillImg(s.icon)}" alt="" loading="lazy">
        <div><div class="sname">${esc(s.name)}${s.rarity === 2 ? '<span class="gold-tag">GOLD</span>' : ''}</div>
        <div class="sdesc">${esc(s.desc)}</div></div>
      </div>`).join('') || '<p class="empty-note">Ничего не найдено</p>';
    $('#skills-count', root).textContent = `Скиллов: ${list.length}`;
  };

  $('#skills-q', root).addEventListener('input', (e) => { skillsFilter.q = e.target.value; apply(); });
  $('#sk-gold', root).addEventListener('click', () => { skillsFilter.gold = skillsFilter.gold === 2 ? 0 : 2; renderSkills(); });
  $('#sk-white', root).addEventListener('click', () => { skillsFilter.gold = skillsFilter.gold === 1 ? 0 : 1; renderSkills(); });
  apply();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-skill-modal]');
  if (el) showSkillModal(Number(el.dataset.skillModal));
});

export function showSkillModal(id) {
  const s = db.skillById.get(id);
  if (!s) return;
  const pool = cardPool(store.state.settings.globalOnly);
  const sources = skillSourcesInPool(id, pool);
  const chip = ({ cardId, src }) => {
    const c = db.cardById.get(cardId);
    return `<span class="gives-chip" data-card-modal="${c.id}">
      <img src="${cardImg(c.id)}" alt=""><span class="type-dot t-${c.type}"></span>${esc(c.char)} ${RARITY_NAMES[c.rarity]}
      <span class="src-tag ${src === 'hint' ? 'src-hint' : 'src-event'}">${src === 'hint' ? 'хинт' : 'ивент'}</span>
      ${store.invHas(c.id) ? '✓' : ''}
    </span>`;
  };
  openModal(`
    <div class="card-modal-head">
      <img src="${skillImg(s.icon)}" alt="" style="width:64px;border-radius:0">
      <div class="meta">
        <h2>${esc(s.name)}${s.rarity === 2 ? '<span class="gold-tag">GOLD</span>' : ''}</h2>
        <div class="meta-row">${esc(s.name_jp || '')}</div>
        <div class="meta-row">${esc(s.desc)}</div>
        ${s.cost ? `<div class="meta-row">Стоимость: ${s.cost} SP</div>` : ''}
        <div class="meta-row" style="margin-top:8px"><button class="btn primary" data-want-add="${s.id}">+ В список желаемых</button></div>
      </div>
    </div>
    <h3>Какие карты дают (${sources.length})</h3>
    <div class="gives-chips">${sources.map(chip).join('') || '—'}</div>
  `);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-want-add]');
  if (b) {
    addWanted(Number(b.dataset.wantAdd));
    $('#modal').hidden = true;
    toast('Скилл добавлен в конструктор колоды');
  }
});

// ============ ИНВЕНТАРЬ ============
const invFilter = { q: '', types: new Set(), mode: 'all' }; // mode: all | owned

renderers.inventory = renderInventory;
export function renderInventory() {
  const root = $('#view-inventory');
  const pool = cardPool(store.state.settings.globalOnly);

  root.innerHTML = `
    <div class="panel">
      <h2>Мой инвентарь</h2>
      <p class="hint-text">Кликни на карту, чтобы открыть её. Кнопкой ✓/+ добавляй в инвентарь, у своих карт настрой уровень анлока (LB 0–4). Всё сохраняется в браузере.</p>
      <div class="toolbar" style="margin-top:12px">
        <input class="input search-input" id="inv-q" placeholder="Поиск…" value="${esc(invFilter.q)}">
        <div class="chip-row" id="inv-types">
          ${TYPES.map((t) => `<button class="chip t-${t} ${invFilter.types.has(t) ? 'active' : ''}" data-t="${t}"><span class="type-dot t-${t}"></span>${TYPE_NAMES[t]}</button>`).join('')}
        </div>
        <button class="chip ${invFilter.mode === 'owned' ? 'active' : ''}" id="inv-owned">Только мои (${store.invCount()})</button>
        <span style="flex:1"></span>
        <button class="btn" id="inv-export">⬇︎ Экспорт</button>
        <button class="btn" id="inv-import">⬆︎ Импорт</button>
      </div>
      <div class="card-grid" id="inv-grid"></div>
      <p class="count-note" id="inv-note"></p>
    </div>`;

  const apply = () => {
    const q = invFilter.q.toLowerCase();
    const list = pool.filter((c) =>
      (!q || c.char.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)) &&
      (!invFilter.types.size || invFilter.types.has(c.type)) &&
      (invFilter.mode !== 'owned' || store.invHas(c.id)),
    ).sort((a, b) => (store.invHas(b.id) - store.invHas(a.id)) || b.rarity - a.rarity || a.char.localeCompare(b.char));
    $('#inv-grid', root).innerHTML = list.map((c) => invTile(c)).join('') || '<p class="empty-note">Пусто. Добавь карты кнопкой +</p>';
    $('#inv-note', root).textContent = `В инвентаре: ${store.invCount()} карт`;
  };

  $('#inv-q', root).addEventListener('input', (e) => { invFilter.q = e.target.value; apply(); });
  $('#inv-types', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    invFilter.types.has(b.dataset.t) ? invFilter.types.delete(b.dataset.t) : invFilter.types.add(b.dataset.t);
    b.classList.toggle('active');
    apply();
  });
  $('#inv-owned', root).addEventListener('click', () => {
    invFilter.mode = invFilter.mode === 'owned' ? 'all' : 'owned';
    renderInventory();
  });
  $('#inv-export', root).addEventListener('click', exportFile);
  $('#inv-import', root).addEventListener('click', importFile);
  apply();
}

function invTile(c) {
  const owned = store.invHas(c.id);
  return `<div class="ucard t-${c.type} ${owned ? 'owned' : store.state.settings.dimUnowned ? 'not-owned-dim' : ''}">
    <span class="rarity-badge rarity-${c.rarity}">${RARITY_NAMES[c.rarity]}</span>
    <img class="art" src="${cardImg(c.id)}" alt="" loading="lazy" data-card="${c.id}">
    <div class="cname" data-card="${c.id}"><span class="type-dot t-${c.type}"></span>${esc(c.char)}</div>
    <div class="ctitle">${esc(c.title)}</div>
    ${owned ? lbStepperHtml(c.id) : ''}
    <div style="margin-top:6px"><button class="btn" style="padding:4px 12px;font-size:12px" data-inv-quick="${c.id}">${owned ? 'Убрать' : '+ Добавить'}</button></div>
  </div>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-inv-quick]');
  if (!b) return;
  e.stopPropagation();
  store.invToggle(Number(b.dataset.invQuick));
  refreshInvCount();
  renderInventory();
});

export function exportFile() {
  const blob = new Blob([store.exportBackup()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `uma-builder-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Бекап скачан');
}

export function importFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    try {
      const text = await input.files[0].text();
      store.importBackup(text);
      toast('Бекап загружен ✓');
      refreshInvCount();
      rerenderCurrent();
      applyTheme();
    } catch (err) {
      toast(`Ошибка импорта: ${err.message}`);
    }
  };
  input.click();
}

// ============ КОЛОДА ============
renderers.deck = renderDeck;
let lastResult = null;

function addWanted(id) {
  const w = store.state.deck.wanted;
  if (!w.find((x) => x.id === id)) {
    w.push({ id, prio: 1 });
    store.save();
  }
  if (currentView === 'deck') renderDeck();
}

export function renderDeck() {
  const root = $('#view-deck');
  const d = store.state.deck;
  const cons = d.constraints;

  root.innerHTML = `
    <div class="deck-layout">
      <div>
        <div class="panel">
          <h2>1 · Нужные скиллы</h2>
          <p class="hint-text">Добавь скиллы и расставь приоритеты: <b style="color:var(--danger)">1</b> — критично, <b style="color:var(--c-power)">2</b> — важно, <b style="color:var(--c-intelligence)">3</b> — желательно. Золотые скиллы весят больше обычных того же приоритета.</p>
          <div class="skill-picker" style="margin:10px 0">
            <input class="input" style="width:100%" id="skill-search" placeholder="🔍 Найти и добавить скилл…" autocomplete="off">
            <div class="skill-picker-results" id="skill-results" hidden></div>
          </div>
          <div class="wanted-list" id="wanted-list"></div>
        </div>

        <div class="panel">
          <h2>2 · Состав по типам</h2>
          <p class="hint-text">Минимум карт каждого типа в колоде (0 = без ограничений). Сумма минимумов не должна превышать 6.</p>
          <div class="constraints-grid" style="margin-top:10px">
            ${TYPES.map((t) => `
              <div class="constraint-row">
                <span class="tlabel"><span class="type-dot t-${t}"></span>${TYPE_NAMES[t]}</span>
                <div class="num-stepper" data-cons="${t}">
                  <button data-dec>−</button>
                  <span class="nval">${cons[t] || 0}</span>
                  <button data-inc>+</button>
                </div>
              </div>`).join('')}
          </div>
          <p class="hint-text" id="cons-sum" style="margin-top:8px"></p>
        </div>

        <div class="panel">
          <h2>3 · Параметры</h2>
          <div class="setting-row">
            <div><div class="slabel">Слот заимствованной карты</div><div class="sdesc">1 карта из всей базы (считается MLB), 5 из инвентаря</div></div>
            <label class="toggle"><input type="checkbox" id="use-borrow" ${d.useBorrow ? 'checked' : ''}><span class="track"></span></label>
          </div>
          <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
            <button class="btn primary big" id="build-btn">⚡ Собрать колоду</button>
            <span class="hint-text">Инвентарь: ${store.invCount()} карт</span>
          </div>
        </div>
      </div>

      <div>
        <div class="panel" id="result-panel">
          <h2>Результат</h2>
          <div id="deck-result"><p class="empty-note">Выбери скиллы и нажми «Собрать колоду»</p></div>
        </div>
      </div>
    </div>`;

  renderWantedList();
  updateConsSum();

  // — поиск скиллов —
  const searchInput = $('#skill-search', root);
  const results = $('#skill-results', root);
  const pool = cardPool(store.state.settings.globalOnly);
  const poolIds = new Set(pool.map((c) => c.id));

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (q.length < 2) { results.hidden = true; return; }
    const found = db.skills.filter((s) =>
      (s.name.toLowerCase().includes(q) || (s.name_jp || '').includes(searchInput.value.trim())) &&
      skillSourcesInPool(s.id, poolIds).length > 0 &&
      !store.state.deck.wanted.find((w) => w.id === s.id),
    ).slice(0, 12);
    results.innerHTML = found.map((s) => `
      <div class="picker-item" data-pick="${s.id}">
        <img src="${skillImg(s.icon)}" alt="">
        <div><div class="pk-name">${esc(s.name)}${s.rarity === 2 ? '<span class="gold-tag">GOLD</span>' : ''}</div>
        <div class="pk-desc">${esc(s.desc.slice(0, 90))}</div></div>
      </div>`).join('') || '<div class="picker-item">Не найдено</div>';
    results.hidden = false;
  });
  results.addEventListener('click', (e) => {
    const item = e.target.closest('[data-pick]');
    if (!item) return;
    addWanted(Number(item.dataset.pick));
    searchInput.value = '';
    results.hidden = true;
  });

  // — ограничения —
  root.querySelectorAll('[data-cons]').forEach((st) => {
    st.addEventListener('click', (e) => {
      const dec = e.target.closest('[data-dec]');
      const inc = e.target.closest('[data-inc]');
      if (!dec && !inc) return;
      const t = st.dataset.cons;
      const cur = store.state.deck.constraints[t] || 0;
      const next = Math.max(0, Math.min(6, cur + (inc ? 1 : -1)));
      if (next === 0) delete store.state.deck.constraints[t];
      else store.state.deck.constraints[t] = next;
      store.save();
      st.querySelector('.nval').textContent = next;
      updateConsSum();
    });
  });

  $('#use-borrow', root).addEventListener('change', (e) => {
    store.state.deck.useBorrow = e.target.checked;
    store.save();
  });

  $('#build-btn', root).addEventListener('click', runBuild);

  if (lastResult) renderResult(lastResult);
}

function updateConsSum() {
  const sum = Object.values(store.state.deck.constraints).reduce((a, b) => a + (b || 0), 0);
  const el = $('#cons-sum');
  if (!el) return;
  el.innerHTML = sum > 6
    ? `<span style="color:var(--danger)">⚠ Сумма минимумов ${sum} > 6 — колоду собрать невозможно</span>`
    : sum > 0 ? `Занято минимумами: ${sum} из 6 слотов` : '';
}

function renderWantedList() {
  const el = $('#wanted-list');
  const w = store.state.deck.wanted;
  if (!w.length) { el.innerHTML = '<p class="empty-note" style="padding:12px">Скиллы пока не выбраны</p>'; return; }
  // сортировка: приоритет, потом золотые
  const sorted = [...w].sort((a, b) => a.prio - b.prio || (db.skillById.get(b.id)?.rarity || 0) - (db.skillById.get(a.id)?.rarity || 0));
  el.innerHTML = sorted.map(({ id, prio }) => {
    const s = db.skillById.get(id);
    if (!s) return '';
    return `<div class="wanted-item ${s.rarity === 2 ? 'gold' : ''}" data-wid="${id}">
      <img src="${skillImg(s.icon)}" alt="">
      <span class="wname" data-skill-modal="${id}" style="cursor:pointer" title="${esc(s.desc)}">${esc(s.name)}${s.rarity === 2 ? '<span class="gold-tag">GOLD</span>' : ''}</span>
      <div class="prio-seg">
        ${[1, 2, 3].map((p) => `<button class="${p === prio ? `on p${p}` : ''}" data-prio="${p}">${p}</button>`).join('')}
      </div>
      <button class="remove-btn" data-remove title="Убрать">✕</button>
    </div>`;
  }).join('');

  el.querySelectorAll('.wanted-item').forEach((item) => {
    const id = Number(item.dataset.wid);
    item.addEventListener('click', (e) => {
      const pb = e.target.closest('[data-prio]');
      if (pb) {
        const entry = store.state.deck.wanted.find((x) => x.id === id);
        entry.prio = Number(pb.dataset.prio);
        store.save();
        renderWantedList();
        return;
      }
      if (e.target.closest('[data-remove]')) {
        store.state.deck.wanted = store.state.deck.wanted.filter((x) => x.id !== id);
        store.save();
        renderWantedList();
      }
    });
  });
}

function runBuild() {
  const d = store.state.deck;
  if (!d.wanted.length) { toast('Сначала добавь хотя бы один скилл'); return; }
  const sum = Object.values(d.constraints).reduce((a, b) => a + (b || 0), 0);
  if (sum > 6) { toast('Сумма минимумов по типам больше 6'); return; }
  if (!store.invCount()) { toast('Инвентарь пуст — добавь свои карты'); return; }

  lastResult = buildDeck({
    wanted: d.wanted,
    constraints: d.constraints,
    inventory: store.state.inventory,
    useBorrow: d.useBorrow,
    globalOnly: store.state.settings.globalOnly,
    weights: store.state.settings.weights,
  });
  renderResult(lastResult);
}

function renderResult(res) {
  const el = $('#deck-result');
  if (!el) return;
  const slots = res.deck.map((p) => `
    <div class="deck-slot ${p.borrowed ? 'borrowed' : ''}" data-card-modal="${p.card.id}">
      ${p.borrowed ? '<span class="borrow-badge">заимств.</span>' : ''}
      <span class="rarity-badge rarity-${p.card.rarity}">${RARITY_NAMES[p.card.rarity]}</span>
      <img class="art" src="${cardImg(p.card.id)}" alt="">
      <div class="cname"><span class="type-dot t-${p.card.type}"></span>${esc(p.card.char)}</div>
      <div class="ctitle">${esc(p.card.title)}</div>
      <div class="lb-dots" style="justify-content:center;display:flex;margin-top:6px">
        ${[0, 1, 2, 3].map((i) => `<span class="lb-dot ${i < p.lb ? 'on' : ''}"></span>`).join('')}
      </div>
    </div>`);
  while (slots.length < 6) slots.push('<div class="empty-slot">Не удалось заполнить слот<br>(мало карт в инвентаре?)</div>');

  const covRows = [...res.coverage]
    .sort((a, b) => a.prio - b.prio || (db.skillById.get(b.id)?.rarity || 0) - (db.skillById.get(a.id)?.rarity || 0))
    .map((cov) => {
      const s = db.skillById.get(cov.id);
      const srcHtml = cov.sources.length
        ? cov.sources.map((src) => `<span class="cov-ok">${esc(src.card.char)}</span><span class="src-tag ${src.src === 'hint' ? 'src-hint' : 'src-event'}">${src.src === 'hint' ? 'хинт' : 'ивент'}</span>${src.borrowed ? ' <span class="src-tag src-hint">заимств.</span>' : ''}`).join('<br>')
        : '<span class="cov-missing">не покрыт</span>';
      return `<tr>
        <td><span class="cov-skill"><span class="prio-pill p${cov.prio}">${cov.prio}</span><img src="${skillImg(s.icon)}" alt="">${esc(s.name)}${s.rarity === 2 ? '<span class="gold-tag">GOLD</span>' : ''}</span></td>
        <td>${srcHtml}</td>
      </tr>`;
    }).join('');

  const typeSummary = Object.entries(res.typeCount)
    .map(([t, n]) => `<span class="chip" style="cursor:default"><span class="type-dot t-${t}"></span>${TYPE_NAMES[t]} × ${n}</span>`).join(' ');

  el.innerHTML = `
    <div class="deck-result-grid">${slots.join('')}</div>
    <div class="deck-score">
      Покрыто скиллов: <b class="${res.coveredCount === res.totalWanted ? 'cov-ok' : ''}">${res.coveredCount} / ${res.totalWanted}</b>
      ${res.constraintsOk ? '' : ' · <span class="cov-missing">⚠ ограничения по типам выполнить не удалось</span>'}
    </div>
    <div class="chip-row" style="margin-top:8px">${typeSummary}</div>
    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-dim);margin:16px 0 8px">Покрытие скиллов</h3>
    <table class="coverage-table">
      <thead><tr><th>Скилл</th><th>Откуда</th></tr></thead>
      <tbody>${covRows}</tbody>
    </table>`;
}

// ============ НАСТРОЙКИ ============
renderers.settings = renderSettings;
export function renderSettings() {
  const root = $('#view-settings');
  const s = store.state.settings;
  const w = s.weights;
  const meta = db.meta;

  root.innerHTML = `
    <div class="settings-grid">
      <div class="panel">
        <h2>Общие</h2>
        <div class="setting-row">
          <div><div class="slabel">Тема</div><div class="sdesc">Оформление приложения</div></div>
          <select class="input" id="set-theme">
            <option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Как в системе</option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Светлая</option>
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Тёмная</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="slabel">Только глобальная версия</div><div class="sdesc">Показывать лишь карты, вышедшие на Global (EN)</div></div>
          <label class="toggle"><input type="checkbox" id="set-global" ${s.globalOnly ? 'checked' : ''}><span class="track"></span></label>
        </div>
        <div class="setting-row">
          <div><div class="slabel">Затемнять чужие карты</div><div class="sdesc">В инвентаре карты не из коллекции показываются бледнее</div></div>
          <label class="toggle"><input type="checkbox" id="set-dim" ${s.dimUnowned ? 'checked' : ''}><span class="track"></span></label>
        </div>
      </div>

      <div class="panel">
        <h2>Веса алгоритма</h2>
        <p class="hint-text">Тонкая настройка подбора колоды. Можно не трогать — значения по умолчанию сбалансированы.</p>
        ${[
          ['p1', 'Вес приоритета 1', 'Критичные скиллы'],
          ['p2', 'Вес приоритета 2', 'Важные скиллы'],
          ['p3', 'Вес приоритета 3', 'Желательные скиллы'],
          ['gold', 'Множитель золотых', 'Во сколько раз золотой ценнее обычного'],
          ['event', 'Множитель ивентовых', 'Скиллы из ивентов не гарантированы'],
          ['dup', 'Ценность дубликата', 'Доля веса за повторное покрытие скилла'],
          ['quality', 'Вес качества карты', 'Влияние редкости и LB на выбор'],
        ].map(([k, label, desc]) => `
          <div class="setting-row">
            <div><div class="slabel">${label}</div><div class="sdesc">${desc}</div></div>
            <input class="input" type="number" step="${['gold', 'event', 'dup', 'quality'].includes(k) ? '0.05' : '5'}" min="0" id="w-${k}" value="${w[k]}">
          </div>`).join('')}
        <div style="margin-top:12px"><button class="btn" id="w-reset">Сбросить веса</button></div>
      </div>

      <div class="panel">
        <h2>Данные и бекап</h2>
        <div class="setting-row">
          <div><div class="slabel">База данных</div>
          <div class="sdesc">${meta ? `Карт: ${meta.counts.cards} · Скиллов: ${meta.counts.skills}<br>Обновлено: ${new Date(meta.updated).toLocaleString('ru')}` : '—'}<br>Источник: gametora.com</div></div>
        </div>
        <div class="setting-row">
          <div><div class="slabel">Бекап</div><div class="sdesc">Инвентарь, настройки и выбранные скиллы в одном JSON</div></div>
          <div style="display:flex;gap:8px">
            <button class="btn" id="set-export">⬇︎ Экспорт</button>
            <button class="btn" id="set-import">⬆︎ Импорт</button>
          </div>
        </div>
        <div class="setting-row">
          <div><div class="slabel">Полный сброс</div><div class="sdesc">Удалить инвентарь и все настройки</div></div>
          <button class="btn danger" id="set-reset">Сбросить всё</button>
        </div>
      </div>
    </div>`;

  $('#set-theme', root).addEventListener('change', (e) => { s.theme = e.target.value; store.save(); applyTheme(); });
  $('#set-global', root).addEventListener('change', (e) => { s.globalOnly = e.target.checked; store.save(); toast(e.target.checked ? 'Пул: только Global' : 'Пул: все карты (JP)'); });
  $('#set-dim', root).addEventListener('change', (e) => { s.dimUnowned = e.target.checked; store.save(); });
  ['p1', 'p2', 'p3', 'gold', 'event', 'dup', 'quality'].forEach((k) => {
    $(`#w-${k}`, root).addEventListener('change', (e) => {
      w[k] = Number(e.target.value) || 0;
      store.save();
    });
  });
  $('#w-reset', root).addEventListener('click', () => {
    Object.assign(w, { p1: 100, p2: 55, p3: 25, gold: 1.6, event: 0.65, dup: 0.15, quality: 1.0 });
    store.save();
    renderSettings();
    toast('Веса сброшены');
  });
  $('#set-export', root).addEventListener('click', exportFile);
  $('#set-import', root).addEventListener('click', importFile);
  $('#set-reset', root).addEventListener('click', () => {
    if (confirm('Точно удалить инвентарь и все настройки?')) {
      store.resetAll();
      refreshInvCount();
      rerenderCurrent();
      applyTheme();
      toast('Все данные сброшены');
    }
  });
}

// ============ ТЕМА ============
export function applyTheme() {
  const pref = store.state.settings.theme;
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const btn = $('#theme-toggle');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}
