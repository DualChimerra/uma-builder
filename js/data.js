// Загрузка БД и индексы

export const TYPES = ['speed', 'stamina', 'power', 'guts', 'intelligence', 'friend', 'group'];
export const TYPE_NAMES = {
  speed: 'Скорость', stamina: 'Выносливость', power: 'Сила',
  guts: 'Кураж', intelligence: 'Интеллект', friend: 'Друг', group: 'Группа',
};
export const RARITY_NAMES = { 1: 'R', 2: 'SR', 3: 'SSR' };

export const db = {
  cards: [],        // все карты
  skills: [],       // скиллы, которые дают карты
  effects: new Map(), // id эффекта -> {name, desc}
  cardById: new Map(),
  skillById: new Map(),
  skillSources: new Map(), // skillId -> [{cardId, src: 'hint'|'event'}]
  meta: null,
};

export async function loadData() {
  const [cards, skills, effects, meta] = await Promise.all([
    fetch('data/cards.json').then((r) => r.json()),
    fetch('data/skills.json').then((r) => r.json()),
    fetch('data/effects.json').then((r) => r.json()).catch(() => []),
    fetch('data/meta.json').then((r) => r.json()).catch(() => null),
  ]);
  db.cards = cards;
  db.skills = skills.sort((a, b) => (b.rarity - a.rarity) || a.name.localeCompare(b.name));
  db.meta = meta;
  effects.forEach((e) => db.effects.set(e.id, e));
  cards.forEach((c) => db.cardById.set(c.id, c));
  skills.forEach((s) => db.skillById.set(s.id, s));
  for (const c of cards) {
    for (const sid of c.hints) addSource(sid, c.id, 'hint');
    for (const sid of c.events) addSource(sid, c.id, 'event');
  }
}

function addSource(skillId, cardId, src) {
  if (!db.skillSources.has(skillId)) db.skillSources.set(skillId, []);
  db.skillSources.get(skillId).push({ cardId, src });
}

// пул карт с учётом настройки "только глобал"
export function cardPool(globalOnly) {
  return globalOnly ? db.cards.filter((c) => c.release_en) : db.cards;
}

// какие карты пула дают скилл
export function skillSourcesInPool(skillId, pool) {
  const poolIds = pool instanceof Set ? pool : new Set(pool.map((c) => c.id));
  return (db.skillSources.get(skillId) || []).filter((s) => poolIds.has(s.cardId));
}

export function cardImg(id) { return `assets/supports/${id}.png`; }
export function cardFullImg(id) { return `https://gametora.com/images/umamusume/supports/tex_support_card_${id}.png`; }
export function skillImg(icon) { return `assets/skills/${icon}.png`; }
export function cardName(c) { return `${c.title} ${c.char}`; }
export function gametoraCardUrl(c) { return `https://gametora.com/umamusume/supports/${c.url}`; }

// уровень карты при заданном LB: R 20..40, SR 25..45, SSR 30..50
export function maxLevel(rarity, lb) {
  return [20, 25, 30][rarity - 1] + lb * 5;
}
