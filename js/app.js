import { loadCatalog, buildWeightedPool, drawPack, getCollection, recordPulls, getAllowance, consumeAllowance, resetAllowance } from "./engine.js";

const BOND_ICON = {
  fast: "fa-bolt",
  tank: "fa-shield-alt",
  arsenal: "fa-bomb",
  stable: "fa-anchor",
  elemental: "fa-atom",
};

let catalog = null;
let weightedPool = null;
let setById = {};

const el = {
  allowanceCount: document.getElementById("allowance-count"),
  openStage: document.getElementById("open-stage"),
  packBtn: document.getElementById("pack-btn"),
  openHint: document.getElementById("open-hint"),
  revealRow: document.getElementById("reveal-row"),
  revealActions: document.getElementById("reveal-actions"),
  revealAllBtn: document.getElementById("reveal-all-btn"),
  againBtn: document.getElementById("again-btn"),
  collectionRoot: document.getElementById("collection-root"),
  tabs: document.querySelectorAll(".tab-btn"),
  views: document.querySelectorAll(".view"),
  cardModal: document.getElementById("card-modal"),
  cardModalFlip: document.getElementById("card-modal-flip"),
  cardModalFront: document.getElementById("card-modal-front"),
  cardModalClose: document.getElementById("card-modal-close"),
  resetAllowanceBtn: document.getElementById("reset-allowance-btn"),
};

init();

async function init() {
  catalog = await loadCatalog();
  setById = Object.fromEntries(catalog.config.sets.map((s) => [s.id, s]));
  weightedPool = buildWeightedPool(catalog.allCards, catalog.config.rarities);

  wireTabs();
  wirePack();
  wireCardModal();
  el.resetAllowanceBtn.addEventListener("click", () => {
    resetAllowance();
    resetOpenStage();
  });
  updateAllowanceDisplay();
  renderCollection();
}

function wireTabs() {
  el.tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      el.tabs.forEach((b) => b.classList.remove("active"));
      el.views.forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.view).classList.add("active");
    });
  });
}

function updateAllowanceDisplay() {
  const state = getAllowance(catalog.config.dailyAllowance);
  el.allowanceCount.textContent = `${state.remaining} / ${catalog.config.dailyAllowance}`;
  el.packBtn.disabled = state.remaining <= 0;
  el.openHint.textContent = state.remaining > 0
    ? "Tap the pack to open it."
    : "No packs left today — come back tomorrow.";
}

function wirePack() {
  el.packBtn.addEventListener("click", openPack);
  el.revealAllBtn.addEventListener("click", () => {
    document.querySelectorAll(".reveal-slot:not(.flipped)").forEach((slot, i) => {
      setTimeout(() => flipSlot(slot), i * 120);
    });
  });
  el.againBtn.addEventListener("click", resetOpenStage);
}

function wireCardModal() {
  el.cardModalFlip.addEventListener("click", () => {
    el.cardModalFlip.classList.toggle("flipped");
  });
  el.cardModalClose.addEventListener("click", closeCardModal);
  el.cardModal.addEventListener("click", (e) => {
    if (e.target === el.cardModal) closeCardModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCardModal();
  });
}

function openCardModal(card) {
  el.cardModalFront.innerHTML = renderCardFace(card, {});
  el.cardModalFlip.classList.remove("flipped");
  el.cardModal.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeCardModal() {
  el.cardModal.classList.remove("open");
  document.body.style.overflow = "";
}

function openPack() {
  const state = consumeAllowance(catalog.config.dailyAllowance);
  if (!state) return;
  updateAllowanceDisplay();

  const pulled = drawPack(weightedPool, catalog.config.packSize);
  recordPulls(pulled.map((c) => c.id));
  renderCollection();

  el.packBtn.classList.add("opening");
  setTimeout(() => showRevealRow(pulled), 480);
}

function showRevealRow(pulled) {
  el.packBtn.classList.remove("opening");
  el.packBtn.style.display = "none";
  el.openHint.style.display = "none";
  el.revealRow.innerHTML = "";
  el.revealActions.style.display = "flex";
  el.revealAllBtn.disabled = false;

  pulled.forEach((card, i) => {
    const slot = document.createElement("div");
    slot.className = "reveal-slot";
    slot.innerHTML = `
      <div class="slot-face slot-back"><i class="fas fa-question"></i></div>
      <div class="slot-face slot-front">${renderCardFace(card)}</div>
    `;
    slot.addEventListener("click", () => {
      if (slot.classList.contains("flipped")) {
        openCardModal(card);
      } else {
        flipSlot(slot);
      }
    });
    el.revealRow.appendChild(slot);
    setTimeout(() => slot.classList.add("visible"), 20 + i * 90);
  });
}

function flipSlot(slot) {
  slot.classList.add("flipped");
}

function resetOpenStage() {
  el.revealRow.innerHTML = "";
  el.revealActions.style.display = "none";
  el.packBtn.style.display = "";
  el.openHint.style.display = "";
  updateAllowanceDisplay();
}

function renderCollection() {
  const collection = getCollection();
  el.collectionRoot.innerHTML = "";

  for (const set of catalog.config.sets) {
    const cards = catalog.bySet[set.id];
    const ownedCount = cards.filter((c) => collection[c.id]).length;

    const section = document.createElement("div");
    section.className = "set-section";
    section.innerHTML = `
      <div class="set-section-title">
        <span class="set-swatch" style="background:var(${set.accentVar})"></span>
        ${set.label}s
        <span class="set-section-count">${ownedCount} / ${cards.length} discovered</span>
      </div>
      <div class="card-wrap"></div>
    `;

    const wrap = section.querySelector(".card-wrap");
    for (const card of cards) {
      const count = collection[card.id] || 0;
      const slot = document.createElement("div");
      slot.className = "card-slot";
      if (count > 0) {
        const holder = document.createElement("div");
        holder.innerHTML = renderCardFace(card);
        const cardEl = holder.firstElementChild;
        cardEl.classList.add("clickable");
        cardEl.addEventListener("click", () => openCardModal(card));
        slot.appendChild(cardEl);
        if (count > 1) {
          const caption = document.createElement("span");
          caption.className = "card-owned-count";
          caption.textContent = `Owned ×${count}`;
          slot.appendChild(caption);
        }
      } else {
        const holder = document.createElement("div");
        holder.innerHTML = renderLockedFace(card);
        slot.appendChild(holder.firstElementChild);
      }
      wrap.appendChild(slot);
    }

    el.collectionRoot.appendChild(section);
  }
}

function scopeClassFor(card) {
  const set = setById[card.set];
  return set.scopeClass ? ` ${set.scopeClass}` : "";
}

function renderCardFace(card) {
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
    <div class="card${scopeClassFor(card)}" data-rarity="${card.rarity}" data-set="${card.set}">
      <span class="rarity-badge">${card.rarity}</span>
      <div class="card-header">
        <h2 class="card-name">${card.name}</h2>
        <span class="card-cost"><i class="fas ${set.typeIcon}"></i></span>
        ${secondCostIcon}
      </div>
      <div class="card-graphic"><i class="fas ${set.typeIcon}"></i></div>
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

function renderLockedFace(card) {
  const set = setById[card.set];
  return `
    <div class="card locked${scopeClassFor(card)}" data-rarity="${card.rarity}" data-set="${card.set}">
      <span class="rarity-badge">${card.rarity}</span>
      <div class="card-header">
        <h2 class="card-name">???</h2>
        <span class="card-cost"><i class="fas fa-lock"></i></span>
      </div>
      <div class="card-graphic"><i class="fas fa-question"></i></div>
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
    return `<span class="card-cost"><i class="fas ${card.classIcon}"></i></span>`;
  }
  if (card.set === "mechs") {
    return `<span class="card-cost bond-${card.class}"><i class="fas ${card.classIcon}"></i></span>`;
  }
  if (card.set === "darkMatter") {
    return `<span class="card-cost"><i class="fas ${card.icon}"></i></span>`;
  }
  return "";
}

function metaHtml_(card) {
  const parts = [];
  if (card.tier) {
    parts.push(`<span class="card-tier ${card.tier}">${card.tier === "main" ? '<i class="fas fa-star"></i> Main' : "Sub"}</span>`);
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
    parts.push(`<span class="card-bond bond-${card.bond}" title="Bonds with ${capitalize(card.bond)}"><i class="fas ${BOND_ICON[card.bond]}"></i></span>`);
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
