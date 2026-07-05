const STORAGE_KEYS = {
  collection: "hs-packs:collection",
  allowance: "hs-packs:allowance",
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

export function getCollection() {
  return readJson(STORAGE_KEYS.collection, {});
}

export function resetCollection() {
  localStorage.removeItem(STORAGE_KEYS.collection);
}

export function recordPulls(cardIds) {
  const collection = getCollection();
  const isNew = {};
  for (const id of cardIds) {
    isNew[id] = !collection[id];
    collection[id] = (collection[id] || 0) + 1;
  }
  writeJson(STORAGE_KEYS.collection, collection);
  return isNew;
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
