import { pickRandomFoil } from "./foil-config.js";
import { LEGACY_CARD_RARITY } from "./legacy-rarity.js";

const STORAGE_KEYS = {
  collection: "hs-packs:collection",
  allowance: "hs-packs:allowance",
  packsOpened: "hs-packs:packs-opened",
};

export async function loadCatalog() {
  const config = await fetchJson("data/pack-config.json");
  const bySet = {};
  for (const set of config.sets) {
    bySet[set.id] = (await fetchJson(set.file)).map((card) => ({
      ...card,
      set: set.id,
    }));
  }
  const allCards = Object.values(bySet).flat();
  const cardsById = new Map(allCards.map((c) => [c.id, c]));
  return { config, bySet, allCards, cardsById };
}

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

// Which card gets drawn is now independent of rarity (rarity is rolled separately per pull, see
// pickRandomRarity/recordPulls below), so every card gets an equal draw weight.
export function buildDrawPool(allCards) {
  return allCards.map((card) => ({ card, weight: 1 }));
}

// Rolls a rarity tier independently of which card was drawn, using the same weighted-random shape
// as pickRandomFoil, so any card can come out common one pull and legendary the next.
export function pickRandomRarity(raritiesConfig) {
  const total = raritiesConfig.reduce((sum, tier) => sum + tier.weight, 0);
  let roll = Math.random() * total;
  for (const tier of raritiesConfig) {
    roll -= tier.weight;
    if (roll <= 0) return tier.id;
  }
  return raritiesConfig[raritiesConfig.length - 1].id;
}

export function drawPack(weightedPool, packSize) {
  const total = weightedPool.reduce((sum, e) => sum + e.weight, 0);
  const results = [];
  for (let i = 0; i < packSize; i++) {
    let roll = Math.random() * total;
    for (const entry of weightedPool) {
      roll -= entry.weight;
      if (roll <= 0) {
        results.push(entry.card);
        break;
      }
    }
  }
  return results;
}

// Collection entries are keyed by rarity tier, then by foil variant, e.g.
// { common: { none: 2, tin: 1 }, legendary: { none: 1 } }, since rarity is now rolled per pull just
// like foil. Older saves are migrated here in-memory, and persisted in the new shape the next time
// recordPulls() writes:
//   - oldest legacy: a bare count (pre-foil-tracking) -> { none: count }
//   - pre-rarity-split legacy: a flat { variant: count } map with no rarity axis -> lifted under
//     that card's old fixed rarity (LEGACY_CARD_RARITY), since that's the only rarity those pulls
//     could have come from before this feature existed.
export function getCollection() {
  const collection = readJson(STORAGE_KEYS.collection, {});
  for (const id of Object.keys(collection)) {
    let entry = collection[id];
    if (typeof entry === "number") {
      // "none" matches the FOIL_OPTIONS/CARD_FOIL_OPTIONS sentinel for "no foil" everywhere else.
      entry = { none: entry };
    }
    if (isFlatVariantMap(entry)) {
      const legacyRarity = LEGACY_CARD_RARITY[id] || "common";
      entry = { [legacyRarity]: entry };
    }
    collection[id] = entry;
  }
  return collection;
}

function isFlatVariantMap(entry) {
  const values = Object.values(entry);
  return values.length > 0 && values.every((v) => typeof v === "number");
}

function rarityBucketVariants(bucket) {
  if (!bucket) return [];
  return Object.keys(bucket).filter((variant) => bucket[variant] > 0);
}

function rarityBucketTotal(bucket) {
  return rarityBucketVariants(bucket).reduce((sum, variant) => sum + bucket[variant], 0);
}

export function ownedRarities(entry) {
  if (!entry) return [];
  return Object.keys(entry).filter((rarity) => rarityBucketTotal(entry[rarity]) > 0);
}

export function rarityCount(entry, rarity) {
  return entry ? rarityBucketTotal(entry[rarity]) : 0;
}

export function rarityVariants(entry, rarity) {
  return entry ? rarityBucketVariants(entry[rarity]) : [];
}

// All foil variants owned for this card across every rarity tier.
export function ownedVariants(entry) {
  if (!entry) return [];
  const variants = new Set();
  for (const rarity of Object.keys(entry)) {
    rarityBucketVariants(entry[rarity]).forEach((variant) => variants.add(variant));
  }
  return [...variants];
}

// Grand total copies owned across every rarity+foil combo.
export function totalOwned(entry) {
  return ownedRarities(entry).reduce((sum, rarity) => sum + rarityBucketTotal(entry[rarity]), 0);
}

export function isOwned(entry) {
  return totalOwned(entry) > 0;
}

// The rarity tier this card is most-owned at, ties favoring the rarer tier - used where a single
// representative print needs to be chosen for display (Roster Builder chips/export).
export function dominantRarity(entry, raritiesConfig) {
  let best = null;
  let bestCount = -1;
  for (let i = raritiesConfig.length - 1; i >= 0; i--) {
    const tier = raritiesConfig[i];
    const count = rarityCount(entry, tier.id);
    if (count > bestCount) {
      bestCount = count;
      best = tier.id;
    }
  }
  return best;
}

export function resetCollection() {
  localStorage.removeItem(STORAGE_KEYS.collection);
  localStorage.removeItem(STORAGE_KEYS.packsOpened);
}

export function getPacksOpenedCount() {
  return readJson(STORAGE_KEYS.packsOpened, 0);
}

export function recordPackOpened() {
  const count = getPacksOpenedCount() + 1;
  writeJson(STORAGE_KEYS.packsOpened, count);
  return count;
}

export function recordPulls(cards, raritiesConfig) {
  const collection = getCollection();
  const isNew = {};
  const pulls = [];
  for (const card of cards) {
    const entry = collection[card.id] || {};
    isNew[card.id] = !isOwned(entry);
    const rarity = pickRandomRarity(raritiesConfig);
    const variant = pickRandomFoil(card, rarity);
    const bucket = entry[rarity] || {};
    bucket[variant] = (bucket[variant] || 0) + 1;
    entry[rarity] = bucket;
    collection[card.id] = entry;
    pulls.push({ card, variant, rarity });
  }
  writeJson(STORAGE_KEYS.collection, collection);
  return { isNew, pulls };
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function getAllowance(dailyAllowance) {
  const state = readJson(STORAGE_KEYS.allowance, null);
  const today = todayKey();
  if (!state || state.day !== today) {
    const fresh = { day: today, remaining: dailyAllowance };
    writeJson(STORAGE_KEYS.allowance, fresh);
    return fresh;
  }
  return state;
}

export function consumeAllowance(dailyAllowance) {
  const state = getAllowance(dailyAllowance);
  if (state.remaining <= 0) return null;
  state.remaining -= 1;
  writeJson(STORAGE_KEYS.allowance, state);
  return state;
}

export function resetAllowance() {
  localStorage.removeItem(STORAGE_KEYS.allowance);
}

export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
