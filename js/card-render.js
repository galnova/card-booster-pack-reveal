const BOND_ICON = {
  fast: "zap",
  tank: "shield",
  arsenal: "bomb",
  stable: "anchor",
  elemental: "atom",
};

// Temporary: swap in finished PNG samples for these cards so the image version
// can be compared against the live HTML render. Revert by removing this override.
const CARD_IMAGE_OVERRIDES = {
  "char-sadie": "card-samples/HS-Card-Human-Hero-Sadie.png",
  "mech-cidermayer": "card-samples/HS-Card-Mech-Strategist-Cidermayer.png",
  "char-starlot": "card-samples/HS-Card-Human-Gunner-Starlot.png",
  "char-zo": "card-samples/HS-Card-Human-Hero-Sub-Zo.png",
  "char-rufus": "card-samples/HS-Card-Human-Sworder-Rufus.png",
  "char-llewellyn": "card-samples/HS-Card-Human-Leader-Llewellyn.png",
  "char-blac": "card-samples/HS-Card-Human-Brute-Blac.png",
  "char-cagney": "card-samples/HS-Card-Human-Leader-Sub-Cagney.png",
  "char-let": "card-samples/HS-Card-Human-Brute-Sub-Let.png",
  "char-silvy": "card-samples/HS-Card-Human-Hero-Sub-Silvy.png",
  "char-brb": "card-samples/HS-Card-Human-Sworder-Sub-BRB.png",
  "char-bethany": "card-samples/HS-Card-Human-Leader-Sub-Bethany.png",
  "char-celia": "card-samples/HS-Card-Human-Sworder-Sub-Celia.png",
  "mech-coldshoulder": "card-samples/HS-Card-Mech-Elemental-Coldshoulder.png"
};

function scopeClassFor(card, setById) {
  const set = setById[card.set];
  return set.scopeClass ? ` ${set.scopeClass}` : "";
}

export function renderCardFace(card, setById) {
  const set = setById[card.set];

  if (CARD_IMAGE_OVERRIDES[card.id]) {
    return `
    <div class="card card-image-sample${scopeClassFor(card, setById)}" data-id="${card.id}" data-rarity="${card.rarity}" data-set="${card.set}">
      <img class="card-image-sample-img" src="${CARD_IMAGE_OVERRIDES[card.id]}" alt="${card.name}" />
    </div>
  `;
  }

  const secondCostIcon = secondCostIconHtml(card);
  const metaHtml = metaHtml_(card);
  const abilityHtml = card.ability
    ? `<p class="card-ability">${card.ability.name}</p><ul class="card-text">${bulletsHtml(card.ability.text)}</ul>`
    : `<ul class="card-text">${bulletsHtml(card.text)}</ul>`;
  const footerHtml = card.stats
    ? `<div class="card-footer">
        <div class="card-stat"><span class="card-stat-label">AP</span><strong>${signed(card.stats.ap)}</strong></div>
        <div class="card-stat"><span class="card-stat-label">HP</span><strong>${signed(card.stats.hp)}</strong></div>
      </div>`
    : "";

  return `
    <div class="card${scopeClassFor(card, setById)}" data-id="${card.id}" data-rarity="${card.rarity}" data-set="${card.set}">
      <span class="rarity-badge">${card.rarity}</span>
      <div class="card-header">
        <h2 class="card-name">${card.name}</h2>
        <span class="card-cost"><i data-lucide="${set.typeIcon}"></i></span>
        ${secondCostIcon}
      </div>
      <div class="card-graphic"><i data-lucide="${set.typeIcon}"></i></div>
      <div class="card-body">
        <div class="card-meta">
          ${metaHtml}
        </div>
        ${abilityHtml}
        <p class="card-flavor">${card.flavor}</p>
      </div>
      ${footerHtml}
    </div>
  `;
}

export function renderLockedFace(card, setById) {
  return `
    <div class="card card-image-sample locked${scopeClassFor(card, setById)}" data-rarity="${card.rarity}" data-set="${card.set}">
      <img class="card-image-sample-img" src="card-samples/HS-Card-Undiscovered.png" alt="Undiscovered card" />
    </div>
  `;
}

function secondCostIconHtml(card) {
  if (card.set === "characters") {
    return `<span class="card-cost"><i data-lucide="${card.classIcon}"></i></span>`;
  }
  if (card.set === "mechs") {
    return `<span class="card-cost bond-${card.class}"><i data-lucide="${card.classIcon}"></i></span>`;
  }
  if (card.set === "darkMatter") {
    return `<span class="card-cost"><i data-lucide="${card.icon}"></i></span>`;
  }
  return "";
}

function metaHtml_(card) {
  const parts = [];
  if (card.tier) {
    parts.push(`<span class="card-tier ${card.tier}">${card.tier === "main" ? '<i data-lucide="star"></i> Main' : "Sub"}</span>`);
  }
  if (card.set === "darkMatter") {
    parts.push(`<span class="card-role ${card.kind}">${capitalize(card.kind)}</span>`);
  } else if (card.set === "wildcards") {
    parts.push(`<span class="card-role ${card.kind}">${capitalize(card.kind)}</span>`);
  } else if (card.set === "arena") {
    parts.push(`<span class="card-role">Arena</span>`);
  } else if (card.role) {
    parts.push(`<span class="card-role">${card.role}</span>`);
  }
  if (card.bond) {
    parts.push(`<span class="card-bond bond-${card.bond}" title="Bonds with ${capitalize(card.bond)}"><i data-lucide="${BOND_ICON[card.bond]}"></i></span>`);
  }
  if (card.pairNote) {
    parts.push(`<span class="card-dm-pair">${card.pairNote}</span>`);
  }
  return parts.join("");
}

function bulletsHtml(bullets) {
  return bullets.map((b) => `<li class="${b.secondary ? "card-text-secondary" : ""}">${b.text}</li>`).join("");
}

function signed(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}