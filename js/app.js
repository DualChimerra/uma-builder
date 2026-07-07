import { loadData } from './data.js';
import * as store from './store.js';
import {
  renderDeck, renderCards, renderSkills, renderInventory, renderSettings,
  refreshInvCount, applyTheme, setCurrent, toast,
} from './views.js';

const views = {
  deck: renderDeck,
  cards: renderCards,
  skills: renderSkills,
  inventory: renderInventory,
  settings: renderSettings,
};

function switchTab(name) {
  setCurrent(name);
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  views[name]();
  history.replaceState(null, '', `#${name}`);
}

async function init() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const s = store.state.settings;
    const dark = document.documentElement.dataset.theme === 'dark';
    s.theme = dark ? 'light' : 'dark';
    store.save();
    applyTheme();
  });

  document.getElementById('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) switchTab(tab.dataset.tab);
  });

  try {
    await loadData();
  } catch (err) {
    document.getElementById('loading').innerHTML = `<p>Не удалось загрузить базу данных 😿<br>${err.message}</p>`;
    return;
  }

  document.getElementById('loading').hidden = true;
  refreshInvCount();

  const hash = location.hash.slice(1);
  switchTab(views[hash] ? hash : 'deck');
}

init();
