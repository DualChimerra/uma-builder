// Tab rendering

import {
  db, TYPES, TYPE_NAMES, STATS, STAT_NAMES, RARITY_NAMES, SKILL_RARITY_NAMES,
  cardPool, traineePool, cardImg, cardFullImg, skillImg, traineeImg,
  cardName, gametoraCardUrl, maxLevel, skillSourcesInPool, cardEffectsAt,
} from './data.js';
import * as store from './store.js';
import { buildDeck } from './builder.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IMG_FALLBACK = `onerror="this.style.visibility='hidden'"`;

export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 2600);
}

// ============ MODAL ============
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

// ============ LB PROMPT ============
// Adding a card always asks for the limit break level first.
function promptLb(cardId, onDone) {
  const c = db.cardById.get(cardId);
  openModal(`
    <div style="text-align:center">
      <img src="${cardImg(c.id)}" alt="" style="width:84px;border-radius:12px">
      <h2 style="margin-top:8px">${esc(cardName(c))}</h2>
      <p class="hint-text">Select the limit break (uncap) level of your copy</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
        ${[0, 1, 2, 3, 4].map((lb) => `
          <button class="btn lb-choice" data-lb="${lb}" style="flex-direction:column;padding:10px 14px">
            <div style="font-weight:800;font-size:15px">${lb === 4 ? 'MLB' : lb}</div>
            <div class="hint-text">lv ${maxLevel(c.rarity, lb)}</div>
          </button>`).join('')}
      </div>
    </div>`);
  $('#modal-content').querySelectorAll('.lb-choice').forEach((b) => {
    b.addEventListener('click', () => {
      $('#modal').hidden = true;
      onDone(Number(b.dataset.lb));
    });
  });
}

function addToInventory(cardId, after) {
  promptLb(cardId, (lb) => {
    store.state.inventory[cardId] = lb;
    store.save();
    toast(`Added to inventory (${lb === 4 ? 'MLB' : `LB${lb}`})`);
    refreshInvCount();
    after?.();
  });
}

export function showCardModal(id) {
  const c = db.cardById.get(id);
  if (!c) return;
  const lb = store.invHas(id) ? store.invLb(id) : 4;
  const skillRow = (sid, tag) => {
    const s = db.skillById.get(sid);
    if (!s) return '';
    return `<div class="skill-item ${s.rarity === 2 ? 'gold' : ''}">
      <img src="${skillImg(s.icon)}" alt="" loading="lazy" ${IMG_FALLBACK}>
      <div><div class="sname">${esc(s.name)}${s.rarity === 2 ? '<span class="gold-tag">GOLD</span>' : ''}${tag}</div>
      <div class="sdesc">${esc(s.desc)}</div></div></div>`;
  };
  const effs = cardEffectsAt(c, lb);
  const effRows = Object.entries(effs).map(([id2, val]) => {
    const eff = db.effects.get(Number(id2));
    if (!eff) return '';
    const sym = eff.symbol === 'percent' ? '%' : '';
    return `<tr><td title="${esc(eff.desc)}">${esc(eff.name)}</td><td>${val}${sym}</td></tr>`;
  }).join('');

  openModal(`
    <div class="card-modal-head">
      <img src="${cardFullImg(c.id)}" alt="" onerror="this.src='${cardImg(c.id)}'">
      <div class="meta">
        <h2>${esc(cardName(c))}</h2>
        <div class="meta-row"><span class="type-dot t-${c.type}"></span>${TYPE_NAMES[c.type]} · ${RARITY_NAMES[c.rarity]} · max lv ${maxLevel(c.rarity, lb)} (${lb === 4 ? 'MLB' : `LB${lb}`})</div>
        <div class="meta-row">Release (Global): ${c.release_en || '—'} · JP: ${c.release || '—'}</div>
        <div class="meta-row">${store.invHas(id) ? `✅ In inventory (${store.invLb(id) === 4 ? 'MLB' : `LB${store.invLb(id)}`})` : 'Not in inventory'}</div>
        <div class="meta-row" style="margin-top:8px">
          <button class="btn" data-inv-toggle="${id}">${store.invHas(id) ? 'Remove from inventory' : 'Add to inventory'}</button>
          <a class="btn" href="${gametoraCardUrl(c)}" target="_blank" rel="noopener" style="text-decoration:none">GameTora ↗</a>
        </div>
      </div>
    </div>
    ${c.hints.length ? `<h3>Hint skills</h3>${c.hints.map((s) => skillRow(s, '')).join('')}` : ''}
    ${c.events.length ? `<h3>Event skills</h3>${c.events.map((s) => skillRow(s, '<span class="src-tag src-event">event</span>')).join('')}` : ''}
    ${effRows ? `<h3>Support effects (at ${lb === 4 ? 'MLB' : `LB${lb}`}, lv ${maxLevel(c.rarity, lb)})</h3><table class="effects-table">${effRows}</table>` : ''}
  `);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-inv-toggle]');
  if (t) {
    const id = Number(t.dataset.invToggle);
    if (store.invHas(id)) {
      store.invToggle(id);
      toast('Removed from inventory');
      refreshInvCount();
      showCardModal(id);
      rerenderCurrent();
    } else {
      addToInventory(id, () => { showCardModal(id); rerenderCurrent(); });
    }
  }
  const cardEl = e.target.closest('[data-card-modal]');
  if (cardEl) showCardModal(Number(cardEl.dataset.cardModal));
});

export function refreshInvCount() {
  $('#inv-count').textContent = store.invCount();
}

let currentView = 'deck';
const renderers = {};
export function setCurrent(v) { currentView = v; }
export function rerenderCurrent() { renderers[currentView]?.(); }

// ============ CARDS ============
const cardsFilter = { q: '', types: new Set(), rarity: 0, ownedOnly: false };

renderers.cards = renderCards;
export function renderCards() {
  const root = $('#view-cards');
  const pool = cardPool(store.state.settings.globalOnly);

  root.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input class="input search-input" id="cards-q" placeholder="Search by character or card title…" value="${esc(cardsFilter.q)}">
        <div class="chip-row" id="cards-types">
          ${TYPES.map((t) => `<button class="chip t-${t} ${cardsFilter.types.has(t) ? 'active' : ''}" data-t="${t}"><span class="type-dot t-${t}"></span>${TYPE_NAMES[t]}</button>`).join('')}
        </div>
        <div class="chip-row" id="cards-rarity">
          ${[3, 2, 1].map((r) => `<button class="chip ${cardsFilter.rarity === r ? 'active' : ''}" data-r="${r}">${RARITY_NAMES[r]}</button>`).join('')}
        </div>
        <button class="chip ${cardsFilter.ownedOnly ? 'active' : ''}" id="cards-owned">Owned only</button>
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
    grid.innerHTML = list.map((c) => cardTile(c)).join('') || '<p class="empty-note">Nothing found</p>';
    $('#cards-count', root).textContent = `Showing ${list.length} of ${pool.length} cards`;
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

function cardTile(c) {
  const owned = store.invHas(c.id);
  return `<div class="ucard t-${c.type} ${owned ? 'owned' : ''}" data-card="${c.id}">
    <span class="rarity-badge rarity-${c.rarity}">${RARITY_NAMES[c.rarity]}</span>
    ${owned ? '<span class="own-badge">✓</span>' : ''}
    <img class="art" src="${cardImg(c.id)}" alt="" loading="lazy">
    <div class="cname"><span class="type-dot t-${c.type}"></span>${esc(c.char)}</div>
    <div class="ctitle">${esc(c.title)}</div>
  </div>`;
}

function lbStepperHtml(id) {
  const lb = store.invLb(id);
  return `<div class="lb-stepper" data-lb-for="${id}" title="Limit break level">
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

// ============ SKILLS ============
const skillsFilter = { q: '', cat: 'all', fromCards: true };
const SKILL_CATS = [
  ['all', 'All'], ['normal', 'Normal'], ['gold', 'Gold'], ['unique', 'Unique'], ['evolved', 'Evolved'],
];
const catMatch = (s, cat) => {
  if (cat === 'all') return true;
  if (cat === 'normal') return s.rarity === 1;
  if (cat === 'gold') return s.rarity === 2;
  if (cat === 'unique') return s.rarity >= 3 && s.rarity <= 5;
  if (cat === 'evolved') return s.rarity === 6;
  return true;
};

renderers.skills = renderSkills;
export function renderSkills() {
  const root = $('#view-skills');
  root.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input class="input search-input" id="skills-q" placeholder="Search skills…" value="${esc(skillsFilter.q)}">
        <div class="chip-row" id="sk-cats">
          ${SKILL_CATS.map(([k, label]) => `<button class="chip ${skillsFilter.cat === k ? 'active' : ''}" data-cat="${k}">${label}</button>`).join('')}
        </div>
        <button class="chip ${skillsFilter.fromCards ? 'active' : ''}" id="sk-from-cards" title="Only skills obtainable from support cards in the current pool">From support cards</button>
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
      catMatch(s, skillsFilter.cat) &&
      (!skillsFilter.fromCards || skillSourcesInPool(s.id, poolIds).length > 0),
    ).slice(0, 400);
    $('#skills-list', root).innerHTML = list.map((s) => `
      <div class="skill-item ${s.rarity === 2 ? 'gold' : ''}" data-skill-modal="${s.id}">
        <img src="${skillImg(s.icon)}" alt="" loading="lazy" ${IMG_FALLBACK}>
        <div><div class="sname">${esc(s.name)}${skillBadge(s)}</div>
        <div class="sdesc">${esc(s.desc)}</div></div>
      </div>`).join('') || '<p class="empty-note">Nothing found</p>';
    $('#skills-count', root).textContent = `${list.length} skills${list.length === 400 ? ' (first 400 shown — refine your search)' : ''}`;
  };

  $('#skills-q', root).addEventListener('input', (e) => { skillsFilter.q = e.target.value; apply(); });
  $('#sk-cats', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    skillsFilter.cat = b.dataset.cat;
    renderSkills();
  });
  $('#sk-from-cards', root).addEventListener('click', () => { skillsFilter.fromCards = !skillsFilter.fromCards; renderSkills(); });
  apply();
}

function skillBadge(s) {
  if (s.rarity === 2) return '<span class="gold-tag">GOLD</span>';
  if (s.rarity >= 3 && s.rarity <= 5) return '<span class="gold-tag" style="background:var(--c-guts)">UNIQUE</span>';
  if (s.rarity === 6) return '<span class="gold-tag" style="background:var(--c-group)">EVOLVED</span>';
  return '';
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
  const obtainable = sources.length > 0;
  const chip = ({ cardId, src }) => {
    const c = db.cardById.get(cardId);
    return `<span class="gives-chip" data-card-modal="${c.id}">
      <img src="${cardImg(c.id)}" alt=""><span class="type-dot t-${c.type}"></span>${esc(c.char)} ${RARITY_NAMES[c.rarity]}
      <span class="src-tag ${src === 'hint' ? 'src-hint' : 'src-event'}">${src}</span>
      ${store.invHas(c.id) ? '✓' : ''}
    </span>`;
  };
  openModal(`
    <div class="card-modal-head">
      <img src="${skillImg(s.icon)}" alt="" style="width:64px;border-radius:0" ${IMG_FALLBACK}>
      <div class="meta">
        <h2>${esc(s.name)}${skillBadge(s)}</h2>
        <div class="meta-row">${esc(s.name_jp || '')}</div>
        <div class="meta-row">${esc(s.desc)}</div>
        ${s.cost ? `<div class="meta-row">Cost: ${s.cost} SP</div>` : ''}
        ${obtainable ? `<div class="meta-row" style="margin-top:8px"><button class="btn primary" data-want-add="${s.id}">+ Add to wanted skills</button></div>` : ''}
      </div>
    </div>
    <h3>Given by support cards (${sources.length})</h3>
    <div class="gives-chips">${sources.map(chip).join('') || '<span class="hint-text">Not obtainable from support cards in the current pool</span>'}</div>
  `);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-want-add]');
  if (b) {
    addWanted(Number(b.dataset.wantAdd));
    $('#modal').hidden = true;
    toast('Skill added to the deck builder');
  }
});

// ============ INVENTORY ============
const invFilter = { q: '', types: new Set(), mode: 'all' };

renderers.inventory = renderInventory;
export function renderInventory() {
  const root = $('#view-inventory');
  const pool = cardPool(store.state.settings.globalOnly);

  root.innerHTML = `
    <div class="panel">
      <h2>My inventory</h2>
      <p class="hint-text">Click a card to view details. Use +Add to put it in your inventory — you'll pick the limit break (uncap) level right away. Everything is saved in your browser.</p>
      <div class="toolbar" style="margin-top:12px">
        <input class="input search-input" id="inv-q" placeholder="Search…" value="${esc(invFilter.q)}">
        <div class="chip-row" id="inv-types">
          ${TYPES.map((t) => `<button class="chip t-${t} ${invFilter.types.has(t) ? 'active' : ''}" data-t="${t}"><span class="type-dot t-${t}"></span>${TYPE_NAMES[t]}</button>`).join('')}
        </div>
        <button class="chip ${invFilter.mode === 'owned' ? 'active' : ''}" id="inv-owned">Owned only (${store.invCount()})</button>
        <span style="flex:1"></span>
        <button class="btn" id="inv-export">⬇︎ Export</button>
        <button class="btn" id="inv-import">⬆︎ Import</button>
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
    $('#inv-grid', root).innerHTML = list.map((c) => invTile(c)).join('') || '<p class="empty-note">Empty. Add your cards with the + button</p>';
    $('#inv-note', root).textContent = `${store.invCount()} cards in inventory`;
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
    <div style="margin-top:6px"><button class="btn" style="padding:4px 12px;font-size:12px" data-inv-quick="${c.id}">${owned ? 'Remove' : '+ Add'}</button></div>
  </div>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-inv-quick]');
  if (!b) return;
  e.stopPropagation();
  const id = Number(b.dataset.invQuick);
  if (store.invHas(id)) {
    store.invToggle(id);
    refreshInvCount();
    renderInventory();
  } else {
    addToInventory(id, renderInventory);
  }
});

export function exportFile() {
  const blob = new Blob([store.exportBackup()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `uma-builder-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup downloaded');
}

export function importFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    try {
      const text = await input.files[0].text();
      store.importBackup(text);
      toast('Backup imported ✓');
      refreshInvCount();
      rerenderCurrent();
      applyTheme();
    } catch (err) {
      toast(`Import failed: ${err.message}`);
    }
  };
  input.click();
}

// ============ DECK BUILDER ============
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
  const trainee = d.trainee ? db.traineeById.get(d.trainee) : null;

  root.innerHTML = `
    <div class="deck-layout">
      <div>
        <div class="panel">
          <h2>1 · Wanted skills</h2>
          <p class="hint-text">Add skills and set priorities: <b style="color:var(--danger)">1</b> — critical, <b style="color:var(--c-power)">2</b> — important, <b style="color:var(--c-intelligence)">3</b> — nice to have. Gold skills outweigh normal ones of the same priority.</p>
          <div class="skill-picker" style="margin:10px 0">
            <input class="input" style="width:100%" id="skill-search" placeholder="🔍 Search and add a skill…" autocomplete="off">
            <div class="skill-picker-results" id="skill-results" hidden></div>
          </div>
          <div class="wanted-list" id="wanted-list"></div>
        </div>

        <div class="panel">
          <h2>2 · Trainee &amp; target stats</h2>
          <p class="hint-text">Optional. Pick your trainee to account for her stat growth bonuses, and set target stats — the builder will softly prefer decks whose expected training output gets closer to them (real training math, URA assumptions).</p>
          <div style="margin:10px 0">
            <button class="btn" id="trainee-btn" style="display:flex;align-items:center;gap:8px">
              ${trainee ? `${esc(trainee.name)} <span class="hint-text">${esc(trainee.title)}</span>` : 'Select trainee…'}
            </button>
            ${trainee ? `<div class="chip-row" style="margin-top:8px">${trainee.growth.map((g, i) => g ? `<span class="chip" style="cursor:default"><span class="type-dot t-${STATS[i]}"></span>${STAT_NAMES[STATS[i]]} +${g}%</span>` : '').join('')}
              <button class="chip" id="trainee-clear">✕ clear</button></div>` : ''}
          </div>
          <div class="constraints-grid">
            ${STATS.map((s) => `
              <div class="constraint-row">
                <span class="tlabel"><span class="type-dot t-${s}"></span>${STAT_NAMES[s]} target</span>
                <input class="input" type="number" min="0" max="1300" step="50" style="width:90px" data-target="${s}" value="${d.targets[s] || ''}" placeholder="—">
              </div>`).join('')}
          </div>
        </div>

        <div class="panel">
          <h2>3 · Deck composition</h2>
          <p class="hint-text">Minimum number of cards of each type (0 = no constraint). The sum must not exceed 6.</p>
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
          <div class="setting-row" style="margin-top:6px">
            <div><div class="slabel">Borrowed card slot</div><div class="sdesc">1 card from the whole pool (treated as MLB), 5 from your inventory</div></div>
            <label class="toggle"><input type="checkbox" id="use-borrow" ${d.useBorrow ? 'checked' : ''}><span class="track"></span></label>
          </div>
          <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
            <button class="btn primary big" id="build-btn">⚡ Build deck</button>
            <span class="hint-text">Inventory: ${store.invCount()} cards</span>
          </div>
        </div>
      </div>

      <div>
        <div class="panel" id="result-panel">
          <h2>Result</h2>
          <div id="deck-result"><p class="empty-note">Pick skills and press “Build deck”</p></div>
        </div>
      </div>
    </div>`;

  renderWantedList();
  updateConsSum();

  // — skill search —
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
        <img src="${skillImg(s.icon)}" alt="" ${IMG_FALLBACK}>
        <div><div class="pk-name">${esc(s.name)}${s.rarity === 2 ? '<span class="gold-tag">GOLD</span>' : ''}</div>
        <div class="pk-desc">${esc(s.desc.slice(0, 90))}</div></div>
      </div>`).join('') || '<div class="picker-item">No skills found (obtainable from support cards)</div>';
    results.hidden = false;
  });
  results.addEventListener('click', (e) => {
    const item = e.target.closest('[data-pick]');
    if (!item) return;
    addWanted(Number(item.dataset.pick));
    searchInput.value = '';
    results.hidden = true;
  });

  // — trainee —
  $('#trainee-btn', root).addEventListener('click', showTraineePicker);
  $('#trainee-clear', root)?.addEventListener('click', () => {
    store.state.deck.trainee = null;
    store.save();
    renderDeck();
  });

  // — targets —
  root.querySelectorAll('[data-target]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const s = inp.dataset.target;
      const v = Number(inp.value) || 0;
      if (v > 0) store.state.deck.targets[s] = v;
      else delete store.state.deck.targets[s];
      store.save();
    });
  });

  // — constraints —
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

function showTraineePicker() {
  const pool = traineePool(store.state.settings.globalOnly);
  openModal(`
    <h2>Select trainee</h2>
    <input class="input" style="width:100%;margin-bottom:10px" id="trainee-q" placeholder="Search…" autocomplete="off">
    <div id="trainee-list" style="display:flex;flex-direction:column;gap:6px;max-height:60vh;overflow-y:auto"></div>
  `);
  const listEl = $('#trainee-list');
  const render = (q = '') => {
    const list = pool.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
    listEl.innerHTML = list.map((t) => `
      <div class="picker-item" data-trainee="${t.id}" style="border:1px solid var(--border);border-radius:10px">
        <img src="${traineeImg(t)}" alt="" style="width:40px;height:40px;object-fit:cover;object-position:top;border-radius:8px" loading="lazy" ${IMG_FALLBACK}>
        <div style="flex:1"><div class="pk-name">${esc(t.name)} <span class="hint-text">${esc(t.title)}</span></div>
        <div class="pk-desc">${t.growth.map((g, i) => g ? `${STAT_NAMES[STATS[i]]} +${g}%` : '').filter(Boolean).join(' · ') || 'no growth bonuses'}</div></div>
        <span>${'★'.repeat(t.rarity)}</span>
      </div>`).join('') || '<p class="empty-note">Nothing found</p>';
    listEl.querySelectorAll('[data-trainee]').forEach((el) => {
      el.addEventListener('click', () => {
        store.state.deck.trainee = Number(el.dataset.trainee);
        store.save();
        $('#modal').hidden = true;
        renderDeck();
      });
    });
  };
  $('#trainee-q').addEventListener('input', (e) => render(e.target.value));
  render();
}

function updateConsSum() {
  const sum = Object.values(store.state.deck.constraints).reduce((a, b) => a + (b || 0), 0);
  const el = $('#cons-sum');
  if (!el) return;
  el.innerHTML = sum > 6
    ? `<span style="color:var(--danger)">⚠ Type minimums add up to ${sum} > 6 — impossible to build</span>`
    : sum > 0 ? `${sum} of 6 slots reserved by type minimums` : '';
}

function renderWantedList() {
  const el = $('#wanted-list');
  const w = store.state.deck.wanted;
  if (!w.length) { el.innerHTML = '<p class="empty-note" style="padding:12px">No skills selected yet</p>'; return; }
  const sorted = [...w].sort((a, b) => a.prio - b.prio || (db.skillById.get(b.id)?.rarity || 0) - (db.skillById.get(a.id)?.rarity || 0));
  el.innerHTML = sorted.map(({ id, prio }) => {
    const s = db.skillById.get(id);
    if (!s) return '';
    return `<div class="wanted-item ${s.rarity === 2 ? 'gold' : ''}" data-wid="${id}">
      <img src="${skillImg(s.icon)}" alt="" ${IMG_FALLBACK}>
      <span class="wname" data-skill-modal="${id}" style="cursor:pointer" title="${esc(s.desc)}">${esc(s.name)}${s.rarity === 2 ? '<span class="gold-tag">GOLD</span>' : ''}</span>
      <div class="prio-seg">
        ${[1, 2, 3].map((p) => `<button class="${p === prio ? `on p${p}` : ''}" data-prio="${p}">${p}</button>`).join('')}
      </div>
      <button class="remove-btn" data-remove title="Remove">✕</button>
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
  if (!d.wanted.length && !Object.keys(d.targets).length) { toast('Add at least one skill or a stat target'); return; }
  const sum = Object.values(d.constraints).reduce((a, b) => a + (b || 0), 0);
  if (sum > 6) { toast('Type minimums add up to more than 6'); return; }
  if (!store.invCount()) { toast('Inventory is empty — add your cards first'); return; }

  lastResult = buildDeck({
    wanted: d.wanted,
    constraints: d.constraints,
    inventory: store.state.inventory,
    useBorrow: d.useBorrow,
    globalOnly: store.state.settings.globalOnly,
    weights: store.state.settings.weights,
    targets: d.targets,
    trainee: d.trainee,
  });
  renderResult(lastResult);
}

function renderResult(res) {
  const el = $('#deck-result');
  if (!el) return;
  const slots = res.deck.map((p) => `
    <div class="deck-slot ${p.borrowed ? 'borrowed' : ''}" data-card-modal="${p.card.id}">
      ${p.borrowed ? '<span class="borrow-badge">borrowed</span>' : ''}
      <span class="rarity-badge rarity-${p.card.rarity}">${RARITY_NAMES[p.card.rarity]}</span>
      <img class="art" src="${cardImg(p.card.id)}" alt="">
      <div class="cname"><span class="type-dot t-${p.card.type}"></span>${esc(p.card.char)}</div>
      <div class="ctitle">${esc(p.card.title)}</div>
      <div class="lb-dots" style="justify-content:center;display:flex;margin-top:6px">
        ${[0, 1, 2, 3].map((i) => `<span class="lb-dot ${i < p.lb ? 'on' : ''}"></span>`).join('')}
      </div>
    </div>`);
  while (slots.length < 6) slots.push('<div class="empty-slot">Could not fill this slot<br>(not enough cards in inventory?)</div>');

  const covRows = [...res.coverage]
    .sort((a, b) => a.prio - b.prio || (db.skillById.get(b.id)?.rarity || 0) - (db.skillById.get(a.id)?.rarity || 0))
    .map((cov) => {
      const s = db.skillById.get(cov.id);
      const srcHtml = cov.sources.length
        ? cov.sources.map((src) => `
            <span class="gives-chip" data-card-modal="${src.card.id}" style="margin:2px 0">
              <img src="${cardImg(src.card.id)}" alt="">
              <span class="type-dot t-${src.card.type}"></span>${esc(src.card.char)}
              <span class="src-tag ${src.src === 'hint' ? 'src-hint' : 'src-event'}">${src.src}</span>
              ${src.borrowed ? '<span class="src-tag src-hint">borrowed</span>' : ''}
            </span>`).join('<br>')
        : '<span class="cov-missing">not covered</span>';
      return `<tr>
        <td><span class="cov-skill"><span class="prio-pill p${cov.prio}">${cov.prio}</span><img src="${skillImg(s.icon)}" alt="" ${IMG_FALLBACK}>${esc(s.name)}${s.rarity === 2 ? '<span class="gold-tag">GOLD</span>' : ''}</span></td>
        <td>${srcHtml}</td>
      </tr>`;
    }).join('');

  const typeSummary = Object.entries(res.typeCount)
    .map(([t, n]) => `<span class="chip" style="cursor:default"><span class="type-dot t-${t}"></span>${TYPE_NAMES[t]} × ${n}</span>`).join(' ');

  // estimated stats vs targets
  let statsHtml = '';
  if (res.statEstimate) {
    const { est, turns } = res.statEstimate;
    const targets = store.state.deck.targets;
    statsHtml = `
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-dim);margin:16px 0 8px">Estimated stats <span style="text-transform:none;font-weight:400">(URA · lv5 facilities · great mood · ~45 training turns)</span></h3>
      <table class="coverage-table">
        <thead><tr><th>Stat</th><th>Target</th><th>Estimate</th><th></th></tr></thead>
        <tbody>
          ${STATS.map((s) => {
            const t = targets[s] || 0;
            const v = est[s];
            const ok = !t || v >= t;
            return `<tr>
              <td><span class="type-dot t-${s}"></span>${STAT_NAMES[s]}</td>
              <td>${t || '—'}</td>
              <td><b class="${t ? (ok ? 'cov-ok' : 'cov-missing') : ''}">${v}</b></td>
              <td>${t ? (ok ? '✓' : `${v - t}`) : ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <p class="hint-text" style="margin-top:6px">Suggested training split: ${Object.entries(turns).map(([f, n]) => `${STAT_NAMES[f]} ×${n}`).join(' · ') || '—'}</p>`;
  }

  el.innerHTML = `
    <div class="deck-result-grid">${slots.join('')}</div>
    <div class="deck-score">
      Skills covered: <b class="${res.coveredCount === res.totalWanted ? 'cov-ok' : ''}">${res.coveredCount} / ${res.totalWanted}</b>
      ${res.constraintsOk ? '' : ' · <span class="cov-missing">⚠ type minimums could not be satisfied</span>'}
    </div>
    <div class="chip-row" style="margin-top:8px">${typeSummary}</div>
    ${res.totalWanted ? `
    <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-dim);margin:16px 0 8px">Skill coverage</h3>
    <table class="coverage-table">
      <thead><tr><th>Skill</th><th>From</th></tr></thead>
      <tbody>${covRows}</tbody>
    </table>` : ''}
    ${statsHtml}`;
}

// ============ SETTINGS ============
renderers.settings = renderSettings;
export function renderSettings() {
  const root = $('#view-settings');
  const s = store.state.settings;
  const w = s.weights;
  const meta = db.meta;

  root.innerHTML = `
    <div class="settings-grid">
      <div class="panel">
        <h2>General</h2>
        <div class="setting-row">
          <div><div class="slabel">Theme</div><div class="sdesc">App appearance</div></div>
          <select class="input" id="set-theme">
            <option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>System</option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
          </select>
        </div>
        <div class="setting-row">
          <div><div class="slabel">Global version only</div><div class="sdesc">Show only cards released on the Global (EN) server</div></div>
          <label class="toggle"><input type="checkbox" id="set-global" ${s.globalOnly ? 'checked' : ''}><span class="track"></span></label>
        </div>
        <div class="setting-row">
          <div><div class="slabel">Dim unowned cards</div><div class="sdesc">In the inventory, cards you don't own are shown faded</div></div>
          <label class="toggle"><input type="checkbox" id="set-dim" ${s.dimUnowned ? 'checked' : ''}><span class="track"></span></label>
        </div>
      </div>

      <div class="panel">
        <h2>Algorithm weights</h2>
        <p class="hint-text">Fine-tune the deck builder. Defaults are balanced — you can leave them as is.</p>
        ${[
          ['p1', 'Priority 1 weight', 'Critical skills'],
          ['p2', 'Priority 2 weight', 'Important skills'],
          ['p3', 'Priority 3 weight', 'Nice-to-have skills'],
          ['gold', 'Gold multiplier', 'How much more a gold skill is worth'],
          ['event', 'Event skill multiplier', 'Event skills are not guaranteed'],
          ['dup', 'Duplicate coverage value', 'Fraction of weight for covering a skill again'],
          ['quality', 'Card quality weight', 'Impact of rarity and limit break level'],
          ['stat', 'Stat targets weight', 'How strongly target stats influence card choice'],
        ].map(([k, label, desc]) => `
          <div class="setting-row">
            <div><div class="slabel">${label}</div><div class="sdesc">${desc}</div></div>
            <input class="input" type="number" step="${['gold', 'event', 'dup', 'quality'].includes(k) ? '0.05' : '5'}" min="0" id="w-${k}" value="${w[k]}">
          </div>`).join('')}
        <div style="margin-top:12px"><button class="btn" id="w-reset">Reset weights</button></div>
      </div>

      <div class="panel">
        <h2>Data &amp; backup</h2>
        <div class="setting-row">
          <div><div class="slabel">Database</div>
          <div class="sdesc">${meta ? `${meta.counts.cards} cards · ${meta.counts.skills} skills · ${meta.counts.trainees || 0} trainees<br>Updated: ${new Date(meta.updated).toLocaleString('en-GB')}` : '—'}<br>Source: gametora.com</div></div>
        </div>
        <div class="setting-row">
          <div><div class="slabel">Backup</div><div class="sdesc">Inventory, settings and deck setup in one JSON file</div></div>
          <div style="display:flex;gap:8px">
            <button class="btn" id="set-export">⬇︎ Export</button>
            <button class="btn" id="set-import">⬆︎ Import</button>
          </div>
        </div>
        <div class="setting-row">
          <div><div class="slabel">Full reset</div><div class="sdesc">Delete inventory and all settings</div></div>
          <button class="btn danger" id="set-reset">Reset everything</button>
        </div>
      </div>
    </div>`;

  $('#set-theme', root).addEventListener('change', (e) => { s.theme = e.target.value; store.save(); applyTheme(); });
  $('#set-global', root).addEventListener('change', (e) => { s.globalOnly = e.target.checked; store.save(); toast(e.target.checked ? 'Pool: Global only' : 'Pool: all cards (JP)'); });
  $('#set-dim', root).addEventListener('change', (e) => { s.dimUnowned = e.target.checked; store.save(); });
  ['p1', 'p2', 'p3', 'gold', 'event', 'dup', 'quality', 'stat'].forEach((k) => {
    $(`#w-${k}`, root).addEventListener('change', (e) => {
      w[k] = Number(e.target.value) || 0;
      store.save();
    });
  });
  $('#w-reset', root).addEventListener('click', () => {
    Object.assign(w, { p1: 100, p2: 55, p3: 25, gold: 1.6, event: 0.65, dup: 0.15, quality: 1.0, stat: 60 });
    store.save();
    renderSettings();
    toast('Weights reset');
  });
  $('#set-export', root).addEventListener('click', exportFile);
  $('#set-import', root).addEventListener('click', importFile);
  $('#set-reset', root).addEventListener('click', () => {
    if (confirm('Really delete your inventory and all settings?')) {
      store.resetAll();
      refreshInvCount();
      rerenderCurrent();
      applyTheme();
      toast('All data reset');
    }
  });
}

// ============ THEME ============
export function applyTheme() {
  const pref = store.state.settings.theme;
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const btn = $('#theme-toggle');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}
