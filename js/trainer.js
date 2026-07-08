// Training stat estimation model.
//
// Real per-training formula (community-verified, matches datamined game logic):
//   gain = floor( (base + Σ statBonus)
//                 × Π_rainbow (1 + friendship/100)
//                 × (1 + moodValue × (1 + Σ moodEffect/100))
//                 × (1 + Σ trainingEff/100)
//                 × (1 + 0.05 × supportsOnTile)
//                 × (1 + growth/100) )
//
// Card placement each turn: weight (100 + specialtyRate) for its own facility,
// 100 for each other facility, 50 for "absent" → P(own) = (100+r)/(550+r).
// Friend/Group cards have no specialty facility.
//
// Model assumptions (documented in README):
//  - facilities at level 5, mood Great (+20%), bond maxed for ~BOND_UPTIME of the run
//  - expected values are computed per facility using presence probabilities
//  - the trainer allocates training turns to facilities to best approach targets

import { STATS, EFF, cardEffectsAt } from './data.js';

// URA finale base gains at facility level 5 (per training)
// columns: speed, stamina, power, guts, intelligence, skillPts
export const BASE_GAINS_L5 = {
  speed: { speed: 14, power: 7, skillPts: 2 },
  stamina: { stamina: 13, guts: 6, skillPts: 2 },
  power: { power: 12, stamina: 7, skillPts: 2 },
  guts: { guts: 12, speed: 5, power: 5, skillPts: 2 },
  intelligence: { intelligence: 13, speed: 4, skillPts: 4 },
};

const FACILITIES = STATS; // 5 training facilities match the 5 stats
const BOND_UPTIME = 0.75; // share of the run with maxed bond (rainbow available)
const MOOD_VALUE = 0.2;   // Great mood

// presence probability of a card on a facility
function presenceProb(card, eff, facility) {
  const r = eff[EFF.SPECIALTY] || 0;
  const denom = 550 + r;
  if (card.type === facility) return (100 + r) / denom;
  if (FACILITIES.includes(card.type)) return 100 / denom;
  return 100 / 550; // friend/group: uniform, no specialty
}

/**
 * Expected stat gains per training turn on each facility for a deck.
 * deck: [{card, lb}]
 * returns { facility: {stat: gain, skillPts} }
 */
export function facilityGains(deck, growth) {
  const cardsEff = deck.map((d) => ({ card: d.card, eff: cardEffectsAt(d.card, d.lb) }));
  const out = {};
  for (const f of FACILITIES) {
    const base = BASE_GAINS_L5[f];
    let friendshipProd = 1;
    let moodSum = 0;
    let trainSum = 0;
    let nExpected = 0;
    const flat = {};
    for (const { card, eff } of cardsEff) {
      const p = presenceProb(card, eff, f);
      nExpected += p;
      moodSum += p * (eff[EFF.MOOD] || 0);
      trainSum += p * (eff[EFF.TRAINING] || 0);
      for (const s of STATS) flat[s] = (flat[s] || 0) + p * (eff[EFF.STAT_BONUS[s]] || 0);
      // rainbow: card on its own specialty facility with maxed bond
      if (card.type === f) {
        const fb = (eff[EFF.FRIENDSHIP] || 0) / 100;
        friendshipProd *= 1 + p * BOND_UPTIME * fb;
      }
    }
    const mult =
      friendshipProd *
      (1 + MOOD_VALUE * (1 + moodSum / 100)) *
      (1 + trainSum / 100) *
      (1 + 0.05 * nExpected);
    const gains = {};
    for (const s of STATS) {
      const b = base[s] || 0;
      if (!b && !flat[s]) { gains[s] = 0; continue; }
      const g = growth ? growth[STATS.indexOf(s)] || 0 : 0;
      gains[s] = (b + (b ? flat[s] || 0 : 0)) * mult * (1 + g / 100);
    }
    gains.skillPts = base.skillPts * mult;
    out[f] = gains;
  }
  return out;
}

/**
 * Estimate final stats: allocate training turns across facilities
 * greedily to close the largest relative gap to targets.
 *
 * targets: {speed: 1000, ...} (0/empty = don't care)
 * returns { est: {stat: value}, turns: {facility: n}, score: 0..1 }
 */
export function estimateStats(deck, growth, targets, opts = {}) {
  const turnsTotal = opts.turns ?? 45;     // training turns in a run
  const start = opts.start ?? 120;         // rough starting value per stat
  const raceGain = opts.raceGain ?? 60;    // misc gains (races, events) per stat

  const gains = facilityGains(deck, growth);
  const est = {};
  for (const s of STATS) est[s] = start + raceGain;
  const turns = {};

  const active = STATS.filter((s) => (targets[s] || 0) > 0);
  if (!active.length) return { est, turns, score: 1, gains };

  for (let t = 0; t < turnsTotal; t++) {
    // pick the facility that most reduces the max relative deficit
    let bestF = null;
    let bestDeficit = -Infinity;
    for (const f of FACILITIES) {
      // deficit reduced by training f: weight by how far below target each stat is
      let value = 0;
      for (const s of active) {
        const need = Math.max(0, (targets[s] || 0) - est[s]);
        if (need > 0) value += Math.min(gains[f][s] || 0, need) * (need / (targets[s] || 1));
      }
      if (value > bestDeficit) { bestDeficit = value; bestF = f; }
    }
    if (!bestF || bestDeficit <= 0) break;
    turns[bestF] = (turns[bestF] || 0) + 1;
    for (const s of STATS) est[s] += gains[bestF][s] || 0;
  }

  for (const s of STATS) est[s] = Math.round(est[s]);

  // score: average of min(est/target, 1) over targeted stats
  let sum = 0;
  for (const s of active) sum += Math.min(est[s] / (targets[s] || 1), 1);
  const score = sum / active.length;

  return { est, turns, score, gains };
}
