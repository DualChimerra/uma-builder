// Алгоритм составления колоды.
//
// Жадный алгоритм с учётом покрытия: на каждом шаге выбирается карта
// с максимальным приростом ценности. Ценность складывается из:
//  - веса нужных скиллов (приоритет 1 > 2 > 3, золотые выше обычных того же приоритета);
//  - повторное покрытие скилла даёт лишь малую долю веса (dup);
//  - "качества" карты: редкость + уровень анлока (LB), приоритет более раскрытым;
//  - ивентовые скиллы ценятся ниже хинтов (не гарантированы).
// Ограничения: типы (минимум карт типа X), не более 1 карты на персонажа,
// 5 карт из инвентаря + 1 заимствованная (из полного пула, считается MLB).

import { db, cardPool } from './data.js';

/**
 * @param {Object} p
 * @param {Array<{id:number, prio:1|2|3}>} p.wanted - нужные скиллы
 * @param {Object} p.constraints - {type: minCount}
 * @param {Object} p.inventory - {cardId: lb}
 * @param {boolean} p.useBorrow - использовать слот заимствованной карты
 * @param {boolean} p.globalOnly - пул только из карт глобальной версии
 * @param {Object} p.weights
 */
export function buildDeck({ wanted, constraints, inventory, useBorrow, globalOnly, weights }) {
  const W = weights;
  const pool = cardPool(globalOnly);
  const wantedMap = new Map(wanted.map((w) => [w.id, w.prio]));

  // ценность скилла (полная, при первом покрытии)
  const skillWeight = (skillId) => {
    const prio = wantedMap.get(skillId);
    if (!prio) return 0;
    const s = db.skillById.get(skillId);
    const base = { 1: W.p1, 2: W.p2, 3: W.p3 }[prio] || 0;
    return s && s.rarity === 2 ? base * W.gold : base;
  };

  const quality = (card, lb) =>
    W.quality * ((({ 1: 8, 2: 18, 3: 30 })[card.rarity] || 0) + lb * ({ 1: 2, 2: 3, 3: 5 }[card.rarity] || 3));

  // кандидаты
  const owned = [];
  for (const [idStr, lb] of Object.entries(inventory)) {
    const card = db.cardById.get(Number(idStr));
    if (card) owned.push({ card, lb, borrowed: false });
  }
  const borrowable = useBorrow ? pool.map((card) => ({ card, lb: 4, borrowed: true })) : [];

  const slots = 6;
  const maxOwned = useBorrow ? 5 : 6;

  const picked = [];
  const usedChars = new Set();
  const covered = new Map(); // skillId -> сколько раз покрыт
  const typeCount = {};
  let ownedUsed = 0;
  let borrowUsed = false;

  const req = { ...constraints }; // type -> min

  const feasible = (candType, slotsLeftAfter) => {
    // после выбора кандидата должно хватить слотов на оставшиеся минимумы
    let need = 0;
    for (const [t, min] of Object.entries(req)) {
      const have = (typeCount[t] || 0) + (candType === t ? 1 : 0);
      need += Math.max(0, (min || 0) - have);
    }
    return need <= slotsLeftAfter;
  };

  const marginalGain = (cand) => {
    let gain = 0;
    const seen = new Set();
    for (const sid of cand.card.hints) {
      if (!wantedMap.has(sid) || seen.has(sid)) continue;
      seen.add(sid);
      const w = skillWeight(sid);
      gain += (covered.get(sid) || 0) === 0 ? w : w * W.dup;
    }
    for (const sid of cand.card.events) {
      if (!wantedMap.has(sid) || seen.has(sid)) continue;
      seen.add(sid);
      const w = skillWeight(sid) * W.event;
      gain += (covered.get(sid) || 0) === 0 ? w : w * W.dup;
    }
    return gain + quality(cand.card, cand.lb);
  };

  while (picked.length < slots) {
    const slotsLeftAfter = slots - picked.length - 1;
    let best = null;
    let bestGain = -Infinity;

    const consider = (cand) => {
      if (usedChars.has(cand.card.char_id)) return;
      if (!feasible(cand.card.type, slotsLeftAfter)) return;
      const g = marginalGain(cand);
      if (g > bestGain) { bestGain = g; best = cand; }
    };

    if (ownedUsed < maxOwned) {
      for (const c of owned) consider(c);
    }
    // заимствованный слот пробуем в последнюю очередь, когда известны дыры,
    // либо если из своих карт поставить некого
    const borrowTurn = useBorrow && !borrowUsed &&
      (picked.length === slots - 1 || ownedUsed >= Math.min(maxOwned, owned.length) || !best);
    if (borrowTurn) {
      for (const c of borrowable) consider(c);
    }

    if (!best) {
      // ограничения по типам не выполнить имеющимися картами —
      // заполняем оставшиеся слоты лучшими из доступных без учёта минимумов
      if (ownedUsed < maxOwned) {
        for (const c of owned) {
          if (usedChars.has(c.card.char_id)) continue;
          const g = marginalGain(c);
          if (g > bestGain) { bestGain = g; best = c; }
        }
      }
      if (!best && useBorrow && !borrowUsed) {
        for (const c of borrowable) {
          if (usedChars.has(c.card.char_id)) continue;
          const g = marginalGain(c);
          if (g > bestGain) { bestGain = g; best = c; }
        }
      }
    }

    if (!best) break; // больше некого ставить

    picked.push(best);
    usedChars.add(best.card.char_id);
    typeCount[best.card.type] = (typeCount[best.card.type] || 0) + 1;
    if (best.borrowed) { borrowUsed = true; borrowable.length = 0; }
    else { ownedUsed++; owned.splice(owned.indexOf(best), 1); }
    for (const sid of best.card.hints) if (wantedMap.has(sid)) covered.set(sid, (covered.get(sid) || 0) + 1);
    for (const sid of best.card.events) if (wantedMap.has(sid)) covered.set(sid, (covered.get(sid) || 0) + 1);
  }

  // --- итоговое покрытие ---
  const coverage = wanted.map((w) => {
    const sources = [];
    for (const p of picked) {
      if (p.card.hints.includes(w.id)) sources.push({ card: p.card, src: 'hint', borrowed: p.borrowed });
      else if (p.card.events.includes(w.id)) sources.push({ card: p.card, src: 'event', borrowed: p.borrowed });
    }
    return { id: w.id, prio: w.prio, sources };
  });

  const constraintsOk = Object.entries(req).every(([t, min]) => (typeCount[t] || 0) >= (min || 0));

  return {
    deck: picked,
    coverage,
    typeCount,
    constraintsOk,
    coveredCount: coverage.filter((c) => c.sources.length > 0).length,
    totalWanted: wanted.length,
  };
}
