import { readJson, writeJson } from "./engine.js";

const ROSTER_KEY = "hs-packs:roster";
const SAVED_ROSTERS_KEY = "hs-packs:saved-rosters";

export const ROSTER_RULES = {
  subs: 4,
  mechs: 5,
  wildcards: 3,
  darkMatterMax: 2,
};

export function emptyRoster() {
  return {
    main: null,
    subs: [],
    mechs: [],
    wildcards: [],
    pairings: {},
    darkMatter: [],
  };
}

export function getRoster() {
  return readJson(ROSTER_KEY, emptyRoster());
}

export function saveRoster(roster) {
  writeJson(ROSTER_KEY, roster);
}

/** Named, saved rosters ("favorites") - separate from the single active working roster above. */
export function getSavedRosters() {
  return readJson(SAVED_ROSTERS_KEY, []);
}

export function saveRosterAsFavorite(name, roster) {
  const list = getSavedRosters();
  list.push({ id: `saved-${Date.now()}`, name, savedAt: Date.now(), roster: structuredClone(roster) });
  writeJson(SAVED_ROSTERS_KEY, list);
  return list;
}

export function deleteSavedRoster(id) {
  const list = getSavedRosters().filter((entry) => entry.id !== id);
  writeJson(SAVED_ROSTERS_KEY, list);
  return list;
}

/** Drops any card reference the player no longer owns (e.g. after Reset Collection). Called once on load. */
export function sanitizeRoster(roster, collection) {
  const owns = (id) => Boolean(collection[id]);
  const next = emptyRoster();
  next.main = roster.main && owns(roster.main) ? roster.main : null;
  next.subs = roster.subs.filter(owns);
  next.mechs = roster.mechs.filter(owns);
  next.wildcards = roster.wildcards.filter(owns);

  const rosterCharacterIds = new Set([next.main, ...next.subs].filter(Boolean));
  for (const mechId of next.mechs) {
    const pairing = roster.pairings[mechId];
    if (!pairing) continue;
    const base = pairing.base && rosterCharacterIds.has(pairing.base) ? pairing.base : null;
    const co = pairing.co && pairing.co !== base && rosterCharacterIds.has(pairing.co) ? pairing.co : null;
    if (base || co) next.pairings[mechId] = { base, co };
  }

  const rosterCardIds = new Set([...rosterCharacterIds, ...next.mechs]);
  next.darkMatter = roster.darkMatter.filter(
    (dm) => rosterCardIds.has(dm.hostId) && owns(dm.gainId) && owns(dm.penaltyId)
  );

  return next;
}

/** All character ids (main + subs) currently in the roster, in a stable order. */
export function rosterCharacterIds(roster) {
  return [roster.main, ...roster.subs].filter(Boolean);
}

/** Which roster character (if any) currently holds a seat on any mech. */
export function seatedCharacterIds(roster) {
  const seated = new Set();
  for (const pairing of Object.values(roster.pairings)) {
    if (pairing.base) seated.add(pairing.base);
    if (pairing.co) seated.add(pairing.co);
  }
  return seated;
}

export function validateRoster(roster) {
  const checks = [];

  checks.push({
    key: "main",
    label: "Main Character",
    have: roster.main ? 1 : 0,
    need: 1,
    ok: Boolean(roster.main),
  });
  checks.push({
    key: "subs",
    label: "Sub Characters",
    have: roster.subs.length,
    need: ROSTER_RULES.subs,
    ok: roster.subs.length === ROSTER_RULES.subs,
  });
  checks.push({
    key: "mechs",
    label: "Mechs",
    have: roster.mechs.length,
    need: ROSTER_RULES.mechs,
    ok: roster.mechs.length === ROSTER_RULES.mechs,
  });
  checks.push({
    key: "wildcards",
    label: "Wildcards",
    have: roster.wildcards.length,
    need: ROSTER_RULES.wildcards,
    ok: roster.wildcards.length === ROSTER_RULES.wildcards,
  });

  const charIds = rosterCharacterIds(roster);
  const seated = seatedCharacterIds(roster);
  const unseated = charIds.filter((id) => !seated.has(id));
  checks.push({
    key: "pairing",
    label: "Pilot Assignments",
    have: charIds.length - unseated.length,
    need: charIds.length,
    ok: charIds.length > 0 && unseated.length === 0,
  });

  const complete = checks.every((c) => c.ok);
  return { checks, complete, unseated };
}
