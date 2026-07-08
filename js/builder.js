// Deck building algorithm.
//
// Coverage-aware greedy: each step picks the card with the best marginal value.
// Value =
//  - weights of wanted skills (priority 1 > 2 > 3; gold > normal of same priority);
//  - repeated coverage of a skill is worth only a small fraction (dup);
//  - card "quality": rarity + limit break level (prefer higher uncap);
//  - event skills are worth less than hints (not guaranteed);
//  - optional: how much the deck's expected training output approaches
//    the target stats (real training math, see trainer.js) — soft term.
// Constraints: type minimums, max 1 card per character,
// 5 cards from inventory + 1 borrowed (full pool, treated as MLB).

import { db, cardPool } from './data.js';
import { estimateStats } from './trainer.js';

export function buildDeck({ wanted, constraints, inventory, useBorrow, globalOnly, weights, targets = {}, trainee = null }) {
  const W = weights;
  const pool = cardPool(globalOnly);
  const wantedMap = new Map(wanted.map((w) => [w.id, w.prio]));
  const growth = trainee ? (db.traineeById.get(trainee)?.growth || null) : null;
  const hasTargets = Object.values(targets).some((v) => v > 0);
  const statWeight = hasTargets ? (W.stat || 0) : 0;

  const skillWeight = (skillId) => {
    const prio = wantedMap.get(skillId);
    if (!prio) return 0;
    const s = db.skillById.get(skillId);
    const base = { 1: W.p1, 2: W.p2, 3: W.p3 }[prio] || 0;
    return s && s.rarity === 2 ? base * W.gold : base;
  };

  const quality = (card, lb) =>
    W.quality * ((({ 1: 8, 2: 18, 3: 30 })[card.rarity] || 0) + lb * ({ 1: 2, 2: 3, 3: 5 }[card.rarity] || 3));

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
  const covered = new Map();
  const typeCount = {};
  let ownedUsed = 0;
  let borrowUsed = false;
  let curStatScore = 0;

  const req = { ...constraints };

  const feasible = (candType, slotsLeftAfter) => {
    let need = 0;
    for (const [t, min] of Object.entries(req)) {
      const have = (typeCount[t] || 0) + (candType === t ? 1 : 0);
      need += Math.max(0, (min || 0) - have);
    }
    return need <= slotsLeftAfter;
  };

  const skillGain = (cand) => {
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

  const statGain = (cand) => {
    if (!statWeight) return 0;
    const trial = [...picked, cand];
    const { score } = estimateStats(trial.map((p) => ({ card: p.card, lb: p.lb })), growth, targets);
    return statWeight * score - curStatScore;
  };

  const marginalGain = (cand) => skillGain(cand) + statGain(cand);

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
    // try the borrow slot last, when the coverage gaps are known,
    // or when no owned card can be placed
    const borrowTurn = useBorrow && !borrowUsed &&
      (picked.length === slots - 1 || ownedUsed >= Math.min(maxOwned, owned.length) || !best);
    if (borrowTurn) {
      for (const c of borrowable) consider(c);
    }

    if (!best) {
      // type minimums are unsatisfiable with available cards —
      // fill remaining slots with the best cards ignoring minimums
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

    if (!best) break;

    picked.push(best);
    usedChars.add(best.card.char_id);
    typeCount[best.card.type] = (typeCount[best.card.type] || 0) + 1;
    if (best.borrowed) { borrowUsed = true; borrowable.length = 0; }
    else { ownedUsed++; owned.splice(owned.indexOf(best), 1); }
    for (const sid of best.card.hints) if (wantedMap.has(sid)) covered.set(sid, (covered.get(sid) || 0) + 1);
    for (const sid of best.card.events) if (wantedMap.has(sid)) covered.set(sid, (covered.get(sid) || 0) + 1);
    if (statWeight) {
      const { score } = estimateStats(picked.map((p) => ({ card: p.card, lb: p.lb })), growth, targets);
      curStatScore = statWeight * score;
    }
  }

  const coverage = wanted.map((w) => {
    const sources = [];
    for (const p of picked) {
      if (p.card.hints.includes(w.id)) sources.push({ card: p.card, src: 'hint', borrowed: p.borrowed });
      else if (p.card.events.includes(w.id)) sources.push({ card: p.card, src: 'event', borrowed: p.borrowed });
    }
    return { id: w.id, prio: w.prio, sources };
  });

  const constraintsOk = Object.entries(req).every(([t, min]) => (typeCount[t] || 0) >= (min || 0));

  const statEstimate = hasTargets
    ? estimateStats(picked.map((p) => ({ card: p.card, lb: p.lb })), growth, targets)
    : null;

  return {
    deck: picked,
    coverage,
    typeCount,
    constraintsOk,
    coveredCount: coverage.filter((c) => c.sources.length > 0).length,
    totalWanted: wanted.length,
    statEstimate,
  };
}
