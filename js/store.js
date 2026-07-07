// Персистентное состояние (localStorage) + импорт/экспорт

const KEY = 'umabuilder.v1';

const defaults = () => ({
  inventory: {},          // cardId -> lb (0-4)
  deck: {
    wanted: [],           // [{id, prio}] prio: 1|2|3
    constraints: {},      // type -> min count
    useBorrow: true,
  },
  settings: {
    theme: 'auto',        // auto | light | dark
    globalOnly: true,     // только карты глобальной версии
    dimUnowned: true,     // затемнять карты не из инвентаря
    weights: {
      p1: 100, p2: 55, p3: 25,   // вес приоритета
      gold: 1.6,                  // множитель золотых
      event: 0.65,                // множитель ивентовых скиллов
      dup: 0.15,                  // ценность дубликата скилла
      quality: 1.0,               // вес "качества" карты (редкость + LB)
    },
  },
});

export let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    return merge(defaults(), JSON.parse(raw));
  } catch {
    return defaults();
  }
}

function merge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base;
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    out[k] = k in base ? merge(base[k], patch[k]) : patch[k];
  }
  return out;
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

// --- инвентарь ---
export function invHas(id) { return id in state.inventory; }
export function invLb(id) { return state.inventory[id] ?? 0; }
export function invToggle(id, defaultLb = 4) {
  if (invHas(id)) delete state.inventory[id];
  else state.inventory[id] = defaultLb;
  save();
}
export function invSetLb(id, lb) {
  state.inventory[id] = Math.max(0, Math.min(4, lb));
  save();
}
export function invCount() { return Object.keys(state.inventory).length; }

// --- бекап ---
export function exportBackup() {
  return JSON.stringify({
    app: 'uma-builder',
    version: 1,
    exported: new Date().toISOString(),
    data: state,
  }, null, 2);
}

export function importBackup(json) {
  const parsed = JSON.parse(json);
  const data = parsed?.data ?? parsed; // поддержка и голого стейта
  if (!data || typeof data !== 'object' || !('inventory' in data)) {
    throw new Error('Файл не похож на бекап Uma Deck Builder');
  }
  state = merge(defaults(), data);
  save();
}

export function resetAll() {
  state = defaults();
  save();
}
