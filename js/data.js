// Data loading and indexes

export const TYPES = ['speed', 'stamina', 'power', 'guts', 'intelligence', 'friend', 'group'];
export const TYPE_NAMES = {
  speed: 'Speed', stamina: 'Stamina', power: 'Power',
  guts: 'Guts', intelligence: 'Wit', friend: 'Friend', group: 'Group',
};
export const STATS = ['speed', 'stamina', 'power', 'guts', 'intelligence'];
export const STAT_NAMES = { speed: 'Speed', stamina: 'Stamina', power: 'Power', guts: 'Guts', intelligence: 'Wit' };
export const RARITY_NAMES = { 1: 'R', 2: 'SR', 3: 'SSR' };
export const SKILL_RARITY_NAMES = { 1: 'Normal', 2: 'Gold', 3: 'Unique', 4: 'Unique', 5: 'Unique', 6: 'Evolved' };

export const db = {
  cards: [],
  skills: [],
  trainees: [],
  effects: new Map(),
  cardById: new Map(),
  skillById: new Map(),
  traineeById: new Map(),
  skillSources: new Map(), // skillId -> [{cardId, src: 'hint'|'event'}]
  meta: null,
};

export async function loadData() {
  const [cards, skills, trainees, effects, meta] = await Promise.all([
    fetch('data/cards.json').then((r) => r.json()),
    fetch('data/skills.json').then((r) => r.json()),
    fetch('data/trainees.json').then((r) => r.json()).catch(() => []),
    fetch('data/effects.json').then((r) => r.json()).catch(() => []),
    fetch('data/meta.json').then((r) => r.json()).catch(() => null),
  ]);
  db.cards = cards;
  db.skills = skills.sort((a, b) => a.name.localeCompare(b.name));
  db.trainees = trainees.sort((a, b) => a.name.localeCompare(b.name) || b.rarity - a.rarity);
  db.meta = meta;
  effects.forEach((e) => db.effects.set(e.id, e));
  cards.forEach((c) => db.cardById.set(c.id, c));
  skills.forEach((s) => db.skillById.set(s.id, s));
  trainees.forEach((t) => db.traineeById.set(t.id, t));
  for (const c of cards) {
    for (const sid of c.hints) addSource(sid, c.id, 'hint');
    for (const sid of c.events) addSource(sid, c.id, 'event');
  }
}

function addSource(skillId, cardId, src) {
  if (!db.skillSources.has(skillId)) db.skillSources.set(skillId, []);
  db.skillSources.get(skillId).push({ cardId, src });
}

export function cardPool(globalOnly) {
  return globalOnly ? db.cards.filter((c) => c.release_en) : db.cards;
}
export function traineePool(globalOnly) {
  return globalOnly ? db.trainees.filter((t) => t.release_en) : db.trainees;
}

export function skillSourcesInPool(skillId, pool) {
  const poolIds = pool instanceof Set ? pool : new Set(pool.map((c) => c.id));
  return (db.skillSources.get(skillId) || []).filter((s) => poolIds.has(s.cardId));
}

export function cardImg(id) { return `assets/supports/${id}.png`; }
export function cardFullImg(id) { return `https://gametora.com/images/umamusume/supports/tex_support_card_${id}.png`; }
export function skillImg(icon) { return `assets/skills/${icon}.png`; }
export function traineeImg(t) { return `https://gametora.com/images/umamusume/characters/chara_stand_${t.char_id}_${t.id}.png`; }
export function cardName(c) { return `${c.title} ${c.char}`; }
export function gametoraCardUrl(c) { return `https://gametora.com/umamusume/supports/${c.url}`; }

// card level cap by rarity and limit break: R 20..40, SR 25..45, SSR 30..50
export function maxLevel(rarity, lb) {
  return [20, 25, 30][rarity - 1] + lb * 5;
}

// ===== support effect values =====
// effects row: [effectId, v@1, v@5, v@10, v@15, v@20, v@25, v@30, v@35, v@40, v@45, v@50]
// -1 = not specified: interpolate linearly between nearest known breakpoints
const EFFECT_LEVELS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

export function effectValueAt(row, level) {
  const pts = [];
  for (let i = 0; i < EFFECT_LEVELS.length; i++) {
    const v = row[i + 1];
    if (v !== undefined && v !== -1) pts.push([EFFECT_LEVELS[i], v]);
  }
  if (!pts.length) return 0;
  if (level <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (level <= pts[i][0]) {
      const [l0, v0] = pts[i - 1];
      const [l1, v1] = pts[i];
      return Math.floor(v0 + ((v1 - v0) * (level - l0)) / (l1 - l0));
    }
  }
  return pts[pts.length - 1][1];
}

// all effect values of a card at given LB as {effectId: value}
export function cardEffectsAt(card, lb) {
  const level = maxLevel(card.rarity, lb);
  const out = {};
  for (const row of card.effects || []) {
    out[row[0]] = effectValueAt(row, level);
  }
  // SSR unique bonus unlocks at a fixed level
  if (card.unique && level >= (card.unique.level || 99)) {
    for (const { type, value } of card.unique.effects || []) {
      out[type] = (out[type] || 0) + value;
    }
  }
  return out;
}

// effect ids used by the training model
export const EFF = {
  FRIENDSHIP: 1, MOOD: 2,
  STAT_BONUS: { speed: 3, stamina: 4, power: 5, guts: 6, intelligence: 7 },
  TRAINING: 8, SPECIALTY: 19,
};
