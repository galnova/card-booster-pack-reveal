import { pickRandomFoil } from "./foil-config.js";

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

export function buildWeightedPool(allCards, raritiesConfig) {
  const countByRarity = {};
  for (const card of allCards) {
    countByRarity[card.rarity] = (countByRarity[card.rarity] || 0) + 1;
  }
  const weightByRarity = {};
  for (const tier of raritiesConfig) {
    weightByRarity[tier.id] = tier.weight / (countByRarity[tier.id] || 1);
  }
  return allCards.map((card) => ({ card, weight: weightByRarity[card.rarity] || 0 }));
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

// Collection entries are a per-variant map, e.g. { normal: 2, cosmos: 1 }. Legacy saves stored a
// bare count instead (pre-foil-tracking) - migrated here in-memory, and persisted in the new shape
// the next time recordPulls() writes.
export function getCollection() {
  const collection = readJson(STORAGE_KEYS.collection, {});
  for (const id of Object.keys(collection)) {
    if (typeof collection[id] === "number") {
      // "none" matches the FOIL_OPTIONS/CARD_FOIL_OPTIONS sentinel for "no foil" everywhere else.
      collection[id] = { none: collection[id] };
    }
  }
  return collection;
}

export function ownedVariants(entry) {
  if (!entry) return [];
  return Object.keys(entry).filter((variant) => entry[variant] > 0);
}

export function totalOwned(entry) {
  return ownedVariants(entry).reduce((sum, variant) => sum + entry[variant], 0);
}

export function isOwned(entry) {
  return totalOwned(entry) > 0;
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

export function recordPulls(cards) {
  const collection = getCollection();
  const isNew = {};
  const pulls = [];
  for (const card of cards) {
    const entry = collection[card.id] || {};
    isNew[card.id] = !isOwned(entry);
    const variant = pickRandomFoil(card);
    entry[variant] = (entry[variant] || 0) + 1;
    collection[card.id] = entry;
    pulls.push({ card, variant });
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
