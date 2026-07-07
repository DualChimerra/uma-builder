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
if (!supportsHash || !skillsHash) throw new Error('В манифесте нет ключей support-cards/skills');

console.log(`support-cards: ${supportsHash}, skills: ${skillsHash}`);
const effectsHash = manifest['support_effects'];
const [rawCards, rawSkills, rawEffects] = await Promise.all([
  fetchJson(`${GT}/data/umamusume/support-cards.${supportsHash}.json`),
  fetchJson(`${GT}/data/umamusume/skills.${skillsHash}.json`),
  effectsHash ? fetchJson(`${GT}/data/umamusume/support_effects.${effectsHash}.json`) : [],
]);

console.log(`Карт: ${rawCards.length}, скиллов: ${rawSkills.length}`);

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
}));

// ---- Обработка скиллов (только те, что дают карты поддержки) ----
const referenced = new Set();
for (const c of cards) {
  c.hints.forEach((id) => referenced.add(id));
  c.events.forEach((id) => referenced.add(id));
}

const skills = rawSkills
  .filter((s) => referenced.has(s.id))
  .map((s) => ({
    id: s.id,
    name: s.name_en || s.enname,
    name_jp: s.jpname,
    desc: s.endesc || s.desc_en || '',
    rarity: s.rarity, // 1=обычный (белый), 2=золотой
    icon: s.iconid,
    cost: s.cost ?? null,
  }));

const meta = {
  updated: new Date().toISOString(),
  source: 'gametora.com',
  manifest: { supports: supportsHash, skills: skillsHash },
  counts: { cards: cards.length, skills: skills.length },
};

await fs.mkdir(path.join(ROOT, 'data'), { recursive: true });
await fs.writeFile(path.join(ROOT, 'data', 'cards.json'), JSON.stringify(cards));
await fs.writeFile(path.join(ROOT, 'data', 'skills.json'), JSON.stringify(skills));
const effects = (rawEffects || []).map((e) => ({
  id: e.id,
  name: e.name_en_eon || e.name_en,
  desc: e.desc_en_eon || e.desc_en || '',
  symbol: e.symbol || null,
}));
await fs.writeFile(path.join(ROOT, 'data', 'effects.json'), JSON.stringify(effects));
await fs.writeFile(path.join(ROOT, 'data', 'meta.json'), JSON.stringify(meta, null, 2));
console.log(`Записано: data/cards.json (${cards.length}), data/skills.json (${skills.length})`);

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
