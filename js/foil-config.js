// Foil variants a rarity can roll (see [data-foil] in style.css). "tin" is a plain metallic-grain
// look (no rainbow) - a modest step up from reverse, so it sits in the common/uncommon pools
// alongside it rather than with the flashy rare/legendary-only types.
export const FOIL_OPTIONS = {
  common: ["none", "none", "tin", "reverse"],
  uncommon: ["none", "tin", "reverse", "reverse"],
  rare: ["holo", "cosmos", "none"],
  legendary: ["secret", "secret", "super-holo", "none"],
};

// Curated art cards: an explicit eligible-foil list per card id, overriding the rarity pool above.
// Every entry here gets normal + reverse; the extra type is the one special printing chosen for that card.
export const CARD_FOIL_OPTIONS = {
  "char-sadie": ["none", "reverse", "super-holo"],
  "mech-cidermayer": ["none", "reverse", "cosmos"],
  "char-starlot": ["none", "reverse", "tin"],
  "char-zo": ["none", "reverse", "cosmos"],
  "char-rufus": ["none", "reverse", "holo"],
  "char-llewellyn": ["none", "reverse"],
  "char-blac": ["none", "reverse", "secret"],
  "char-brb": ["none", "reverse", "frost"],
};

export function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function eligibleFoils(card, rarity) {
  return CARD_FOIL_OPTIONS[card.id] || FOIL_OPTIONS[rarity];
}

// Fixed per-id look, used when there's no stored ownership data to fall back on (e.g. a locked/undiscovered preview).
export function pickDeterministicFoil(card, rarity) {
  const options = eligibleFoils(card, rarity);
  if (!options) return "none";
  return options[hashString(card.id) % options.length];
}

// A real per-pull roll, used when a card is actually drawn from a pack. `rarity` is the tier that
// pull just rolled (see pickRandomRarity in engine.js), not a fixed card property anymore.
export function pickRandomFoil(card, rarity) {
  const options = eligibleFoils(card, rarity);
  if (!options) return "none";
  return options[Math.floor(Math.random() * options.length)];
}
