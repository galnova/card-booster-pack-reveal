const BOND_ICON = {
  fast: "zap",
  tank: "shield",
  arsenal: "bomb",
  stable: "anchor",
  elemental: "atom",
};

function scopeClassFor(card, setById) {
  const set = setById[card.set];
  return set.scopeClass ? ` ${set.scopeClass}` : "";
}

export function renderCardFace(card, setById) {
  const set = setById[card.set];

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
    <div class="card locked${scopeClassFor(card, setById)}" data-rarity="${card.rarity}" data-set="${card.set}">
      <span class="rarity-badge">${card.rarity}</span>
      <div class="card-header">
        <h2 class="card-name">???</h2>
        <span class="card-cost"><i data-lucide="lock"></i></span>
      </div>
      <div class="card-graphic"><i data-lucide="circle-help"></i></div>
      <div class="card-body">
        <div class="card-meta">
          <span class="card-role">Undiscovered</span>
        </div>
        <p class="card-flavor">Open packs to reveal this card.</p>
      </div>
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