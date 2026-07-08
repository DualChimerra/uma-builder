#!/usr/bin/env node
/**
 * Обновление базы данных из GameTora.
 *
 * Скачивает манифест данных, затем support-cards и skills,
 * обрабатывает их в компактные файлы для приложения и
 * докачивает недостающие картинки (иконки карт и скиллов).
 *
 * Запуск:  node scripts/update-data.mjs [--no-assets]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GT = 'https://gametora.com';
const UA = { 'User-Agent': 'Mozilla/5.0 (uma-builder data updater; github.com/DualChimerra/uma-builder)' };

const noAssets = process.argv.includes('--no-assets');

async function fetchJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function downloadFile(url, dest) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
  return buf.length;
}

console.log('Загружаю манифест GameTora...');
const manifest = await fetchJson(`${GT}/data/manifests/umamusume.json`);

const supportsHash = manifest['support-cards'];
const skillsHash = manifest['skills'];
const charsHash = manifest['character-cards'];
if (!supportsHash || !skillsHash) throw new Error('В манифесте нет ключей support-cards/skills');

console.log(`support-cards: ${supportsHash}, skills: ${skillsHash}, character-cards: ${charsHash}`);
const effectsHash = manifest['support_effects'];
const [rawCards, rawSkills, rawEffects, rawChars] = await Promise.all([
  fetchJson(`${GT}/data/umamusume/support-cards.${supportsHash}.json`),
  fetchJson(`${GT}/data/umamusume/skills.${skillsHash}.json`),
  effectsHash ? fetchJson(`${GT}/data/umamusume/support_effects.${effectsHash}.json`) : [],
  charsHash ? fetchJson(`${GT}/data/umamusume/character-cards.${charsHash}.json`) : [],
]);

console.log(`Карт: ${rawCards.length}, скиллов: ${rawSkills.length}, персонажей: ${rawChars.length}`);

// ---- Обработка карт ----
const cards = rawCards.map((c) => ({
  id: c.support_id,
  char_id: c.char_id,
  char: c.char_name,
  title: c.title_en || c.title_ja || '',
  rarity: c.rarity, // 1=R, 2=SR, 3=SSR
  type: c.type, // speed/stamina/power/guts/intelligence/friend/group
  hints: c.hints?.hint_skills || [],
  events: c.event_skills || [],
  release: c.release || null,
  release_en: c.release_en || null,
  obtained: c.obtained || null,
  url: c.url_name,
  effects: c.effects || [],
  unique: c.unique || null, // {effects:[{type,value}], level}
}));

// ---- Скиллы: вся база (для просмотра); карты ссылаются на подмножество ----
const skills = rawSkills.map((s) => ({
  id: s.id,
  name: s.name_en || s.enname,
  name_jp: s.jpname,
  desc: s.endesc || s.desc_en || '',
  rarity: s.rarity, // 1=белый, 2=золотой, 3-5=уникальные, 6=эволюция
  icon: s.iconid,
  cost: s.cost ?? null,
}));

// ---- Тренируемые персонажи (для бонусов роста статов) ----
const trainees = rawChars.map((c) => ({
  id: c.card_id,
  char_id: c.char_id,
  name: c.name_en,
  title: c.title_en_gl || (c.title ? `[${c.title}]` : ''),
  rarity: c.rarity,
  growth: c.stat_bonus || [0, 0, 0, 0, 0], // [speed, stamina, power, guts, wit] в %
  release_en: c.release_en || null,
  url: c.url_name,
}));

const meta = {
  updated: new Date().toISOString(),
  source: 'gametora.com',
  manifest: { supports: supportsHash, skills: skillsHash, chars: charsHash },
  counts: { cards: cards.length, skills: skills.length, trainees: trainees.length },
};

const effects = (rawEffects || []).map((e) => ({
  id: e.id,
  name: e.name_en_eon || e.name_en,
  desc: e.desc_en_eon || e.desc_en || '',
  symbol: e.symbol || null,
}));

await fs.mkdir(path.join(ROOT, 'data'), { recursive: true });

// пишем файл только если содержимое изменилось (чтобы CI не делал пустых коммитов)
let changed = false;
async function writeIfChanged(name, content) {
  const p = path.join(ROOT, 'data', name);
  const old = await fs.readFile(p, 'utf8').catch(() => null);
  if (old === content) return;
  await fs.writeFile(p, content);
  changed = true;
  console.log(`  обновлён data/${name}`);
}

await writeIfChanged('cards.json', JSON.stringify(cards));
await writeIfChanged('skills.json', JSON.stringify(skills));
await writeIfChanged('trainees.json', JSON.stringify(trainees));
await writeIfChanged('effects.json', JSON.stringify(effects));
if (changed) {
  await fs.writeFile(path.join(ROOT, 'data', 'meta.json'), JSON.stringify(meta, null, 2));
}
console.log(changed
  ? `Данные обновлены: карт ${cards.length}, скиллов ${skills.length}, персонажей ${trainees.length}`
  : 'Изменений в данных нет.');

if (noAssets) {
  console.log('Пропускаю ассеты (--no-assets)');
  process.exit(0);
}

// ---- Ассеты ----
const supDir = path.join(ROOT, 'assets', 'supports');
const skillDir = path.join(ROOT, 'assets', 'skills');
await fs.mkdir(supDir, { recursive: true });
await fs.mkdir(skillDir, { recursive: true });

const have = async (p) => !!(await fs.stat(p).catch(() => null));

let downloaded = 0;
const queue = [];
for (const c of cards) {
  const dest = path.join(supDir, `${c.id}.png`);
  queue.push([`${GT}/images/umamusume/supports/support_card_s_${c.id}.png`, dest]);
}
const icons = new Set(skills.map((s) => s.icon));
for (const icon of icons) {
  const dest = path.join(skillDir, `${icon}.png`);
  queue.push([`${GT}/images/umamusume/skill_icons/utx_ico_skill_${icon}.png`, dest]);
}

// качаем недостающее, по 8 параллельно
const pending = [];
for (const [url, dest] of queue) {
  if (await have(dest)) continue;
  pending.push([url, dest]);
}
console.log(`Недостающих картинок: ${pending.length}`);
for (let i = 0; i < pending.length; i += 8) {
  await Promise.all(
    pending.slice(i, i + 8).map(([url, dest]) =>
      downloadFile(url, dest)
        .then(() => downloaded++)
        .catch((e) => console.warn(`  пропуск: ${e.message}`)),
    ),
  );
  if (i % 80 === 0 && i > 0) console.log(`  ...${i}/${pending.length}`);
}
console.log(`Скачано картинок: ${downloaded}. Готово.`);
