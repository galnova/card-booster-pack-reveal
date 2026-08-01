import { getCollection, isOwned } from "./engine.js";
import {
  getRoster,
  saveRoster,
  sanitizeRoster,
  validateRoster,
  rosterCharacterIds,
  seatedCharacterIds,
  ROSTER_RULES,
  getSavedRosters,
  saveRosterAsFavorite,
  deleteSavedRoster,
  emptyRoster,
} from "./roster.js";
import { renderCardFace } from "./card-render.js";
import { confirmAction, promptAction } from "./confirm-modal.js";

const CATEGORY_DEFS = {
  main: { max: 1, label: "Main Character", setId: "characters", filter: (c) => c.tier === "main" },
  subs: { max: ROSTER_RULES.subs, label: "Sub Characters", setId: "characters", filter: (c) => c.tier === "sub" },
  mechs: { max: ROSTER_RULES.mechs, label: "Mechs", setId: "mechs", filter: () => true },
  wildcards: { max: ROSTER_RULES.wildcards, label: "Wildcards", setId: "wildcards", filter: () => true },
};

let catalog = null;
let setById = null;
let roster = null;
let goToPacksTab = () => {};
let cardsByCategory = {};
let wasRosterComplete = false;

const el = {};

export function initRosterUI({ catalog: cat, goToPacksTab: goPacks }) {
  catalog = cat;
  setById = Object.fromEntries(catalog.config.sets.map((s) => [s.id, s]));
  goToPacksTab = goPacks || goToPacksTab;

  for (const [key, def] of Object.entries(CATEGORY_DEFS)) {
    cardsByCategory[key] = catalog.bySet[def.setId].filter(def.filter);
  }

  el.checklist = document.getElementById("roster-checklist");
  el.liveStatus = document.getElementById("roster-live-status");
  el.stepsNav = document.getElementById("roster-steps");
  el.pairingList = document.getElementById("roster-pairing-list");
  el.darkMatterList = document.getElementById("roster-darkmatter-list");
  el.addDarkMatterBtn = document.getElementById("add-darkmatter-btn");
  el.review = document.getElementById("roster-review");
  el.exportBtn = document.getElementById("export-roster-btn");
  el.resetBtn = document.getElementById("reset-roster-btn");
  el.printRoot = document.getElementById("roster-print-root");
  el.saveFavoriteBtn = document.getElementById("save-favorite-btn");
  el.savedRostersList = document.getElementById("saved-rosters-list");

  for (const key of Object.keys(CATEGORY_DEFS)) {
    el[`pool_${key}`] = document.getElementById(`pool-${key}`);
    el[`slot_${key}`] = document.getElementById(`slot-${key}`);
    el[`count_${key}`] = document.getElementById(`count-${key}`);
  }

  roster = sanitizeRoster(getRoster(), getCollection());
  saveRoster(roster);
  // Baseline so an already-complete roster doesn't re-celebrate on every load/tab-switch.
  wasRosterComplete = validateRoster(roster).complete;

  wireStepsNav();
  wireDragAndDrop();
  el.addDarkMatterBtn.addEventListener("click", () => {
    if (roster.darkMatter.length >= ROSTER_RULES.darkMatterMax) return;
    roster.darkMatter.push({ hostId: null, cardId: null });
    persistAndRender();
  });
  el.exportBtn.addEventListener("click", exportRoster);
  el.saveFavoriteBtn.addEventListener("click", async () => {
    const main = roster.main ? catalog.cardsById.get(roster.main) : null;
    const name = await promptAction({
      message: "Name this roster to save it as a favorite.",
      confirmLabel: "Save",
      defaultValue: main ? `${main.name}'s Squad` : "My Roster",
    });
    if (!name) return;
    saveRosterAsFavorite(name, roster);
    renderSavedRosters();
    announce(`Saved roster "${name}".`);
  });
  el.resetBtn.addEventListener("click", async () => {
    const ok = await confirmAction({
      message: "Clear the entire roster? This can't be undone.",
      confirmLabel: "Clear Roster",
    });
    if (!ok) return;
    roster = emptyRoster();
    persistAndRender();
  });

  renderAll();
}

export function refreshRosterUI() {
  if (!catalog) return;
  roster = sanitizeRoster(roster, getCollection());
  saveRoster(roster);
  renderAll();
}

function persistAndRender() {
  saveRoster(roster);
  // renderAll() rebuilds everything from scratch and drops focus - restore it by stable id.
  const activeId = document.activeElement && document.activeElement.id;
  renderAll();
  if (activeId) {
    const restored = document.getElementById(activeId);
    if (restored) restored.focus({ preventScroll: true });
  }
}

function renderAll() {
  const collection = getCollection();
  const validation = validateRoster(roster);
  for (const key of Object.keys(CATEGORY_DEFS)) renderCategory(key, collection);
  renderPairing();
  renderDarkMatter(collection);
  renderChecklist(validation);
  renderReview(validation);
  renderSavedRosters();
  if (typeof lucide !== "undefined") lucide.createIcons();
}

// ---------------------------------------------------------------------------
// Steps sub-nav
// ---------------------------------------------------------------------------
function wireStepsNav() {
  el.stepsNav.querySelectorAll(".roster-step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      el.stepsNav.querySelectorAll(".roster-step-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".roster-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      document.querySelector(`.roster-panel[data-step-panel="${btn.dataset.step}"]`).classList.add("active");
    });
  });
}

// ---------------------------------------------------------------------------
// Category pools + slots (main / subs / mechs / wildcards)
// ---------------------------------------------------------------------------
function selectedIds(category) {
  return category === "main" ? (roster.main ? [roster.main] : []) : roster[category];
}

function setSelectedIds(category, ids) {
  if (category === "main") roster.main = ids[0] || null;
  else roster[category] = ids;
}

function renderCategory(key, collection) {
  const def = CATEGORY_DEFS[key];
  const owned = cardsByCategory[key].filter((c) => isOwned(collection[c.id]));
  const selected = new Set(selectedIds(key));
  const poolCards = owned.filter((c) => !selected.has(c.id));
  const slotCards = selectedIds(key).map((id) => catalog.cardsById.get(id)).filter(Boolean);

  el[`count_${key}`].textContent = `${slotCards.length} / ${def.max}`;

  const poolEl = el[`pool_${key}`];
  poolEl.innerHTML = "";
  if (owned.length === 0) {
    poolEl.innerHTML = `<div class="roster-pool-empty-hint">You don't own any ${def.label.toLowerCase()} yet. <button type="button" class="roster-goto-packs">Open some packs</button></div>`;
    poolEl.querySelector(".roster-goto-packs").addEventListener("click", goToPacksTab);
  } else if (poolCards.length === 0) {
    poolEl.innerHTML = `<div class="roster-pool-empty-hint">All owned ${def.label.toLowerCase()} are in your roster.</div>`;
  } else {
    for (const card of poolCards) {
      poolEl.appendChild(buildChip(card, "add", key));
    }
  }

  const slotEl = el[`slot_${key}`];
  slotEl.innerHTML = "";
  slotEl.classList.toggle("roster-slots-full", slotCards.length === def.max);
  if (slotCards.length === 0) {
    slotEl.innerHTML = `<div class="roster-slots-empty-hint">Drag cards here, or click "Add" on a card above.</div>`;
  } else {
    for (const card of slotCards) {
      slotEl.appendChild(buildChip(card, "remove", key));
    }
  }
}

function buildChip(card, mode, category) {
  const wrap = document.createElement("div");
  wrap.className = "roster-card-chip";
  wrap.dataset.cardId = card.id;
  const btnLabel = mode === "add" ? '<i data-lucide="plus"></i> Add' : '<i data-lucide="minus"></i> Remove';
  const btnClass = mode === "add" ? "roster-card-add" : "roster-card-remove";
  wrap.innerHTML = `${renderCardFace(card, setById)}<button type="button" class="${btnClass}">${btnLabel}</button>`;
  wrap.querySelector("button").addEventListener("click", () => {
    if (mode === "add") addToCategory(category, card.id);
    else removeFromCategory(category, card.id);
  });
  return wrap;
}

function addToCategory(category, cardId) {
  const def = CATEGORY_DEFS[category];
  const current = selectedIds(category);
  if (current.length >= def.max || current.includes(cardId)) return;
  setSelectedIds(category, [...current, cardId]);
  persistAndRender();
  announce(`${catalog.cardsById.get(cardId).name} added to ${def.label}.`);
}

function removeFromCategory(category, cardId) {
  const def = CATEGORY_DEFS[category];
  setSelectedIds(category, selectedIds(category).filter((id) => id !== cardId));
  if (category === "main" || category === "subs") {
    for (const mechId of Object.keys(roster.pairings)) {
      const p = roster.pairings[mechId];
      if (p.base === cardId) p.base = null;
      if (p.co === cardId) p.co = null;
      if (!p.base && !p.co) delete roster.pairings[mechId];
    }
  }
  if (category === "mechs") delete roster.pairings[cardId];
  persistAndRender();
  announce(`${catalog.cardsById.get(cardId).name} removed from ${def.label}.`);
}

function wireDragAndDrop() {
  if (typeof Sortable === "undefined") return;
  for (const key of Object.keys(CATEGORY_DEFS)) {
    const groupName = `roster-${key}`;
    const def = CATEGORY_DEFS[key];

    Sortable.create(el[`pool_${key}`], {
      group: { name: groupName, pull: true, put: true },
      animation: 150,
      onAdd: (evt) => {
        removeFromCategory(key, evt.item.dataset.cardId);
      },
    });

    Sortable.create(el[`slot_${key}`], {
      group: { name: groupName, pull: true, put: (to) => selectedIds(key).length < def.max },
      animation: 150,
      onAdd: (evt) => {
        addToCategory(key, evt.item.dataset.cardId);
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------
function renderPairing() {
  const characters = rosterCharacterIds(roster).map((id) => catalog.cardsById.get(id));
  const mechs = roster.mechs.map((id) => catalog.cardsById.get(id));

  if (mechs.length === 0) {
    el.pairingList.innerHTML = `<div class="roster-empty-state">Pick your Mechs first, then come back here to assign pilots.</div>`;
    return;
  }
  if (characters.length === 0) {
    el.pairingList.innerHTML = `<div class="roster-empty-state">Pick your Characters first, then come back here to assign pilots.</div>`;
    return;
  }

  el.pairingList.innerHTML = "";
  const seated = seatedCharacterIds(roster);
  for (const mech of mechs) {
    const pairing = roster.pairings[mech.id] || { base: null, co: null };
    const row = document.createElement("div");
    row.className = "roster-pairing-row";
    row.innerHTML = `
      <div class="roster-pairing-mech">
        <span class="roster-pairing-mech-icon"><i data-lucide="${mech.classIcon}"></i></span>
        ${mech.name}
      </div>
      <div class="roster-pairing-fields">
        <div class="roster-pairing-field">
          <label for="base-${mech.id}">Base Pilot</label>
          ${buildPilotSelect(mech, characters, pairing, "base", seated)}
        </div>
        <div class="roster-pairing-field">
          <label for="co-${mech.id}">Co-Pilot</label>
          ${buildPilotSelect(mech, characters, pairing, "co", seated)}
        </div>
      </div>
    `;
    row.querySelector(`#base-${mech.id}`).addEventListener("change", (e) => setPairing(mech.id, "base", e.target.value || null));
    row.querySelector(`#co-${mech.id}`).addEventListener("change", (e) => setPairing(mech.id, "co", e.target.value || null));
    el.pairingList.appendChild(row);
  }
}

function buildPilotSelect(mech, characters, pairing, seat, seated) {
  const currentValue = pairing[seat];
  const otherSeatValue = seat === "base" ? pairing.co : pairing.base;
  const options = characters
    .filter((c) => c.id === currentValue || (c.id !== otherSeatValue && !seated.has(c.id)))
    .map((c) => `<option value="${c.id}" ${c.id === currentValue ? "selected" : ""}>${c.name}${c.bond === mech.class ? " ★ Match" : ""}</option>`)
    .join("");
  const isMatch = currentValue && catalog.cardsById.get(currentValue)?.bond === mech.class;
  return `<select id="${seat}-${mech.id}" class="roster-pairing-select${isMatch ? " bond-match" : ""}"><option value="">(None)</option>${options}</select>`;
}

function setPairing(mechId, seat, characterId) {
  const pairing = roster.pairings[mechId] || { base: null, co: null };
  if (characterId && (pairing.base === characterId || pairing.co === characterId)) return;
  pairing[seat] = characterId;
  if (pairing.base || pairing.co) roster.pairings[mechId] = pairing;
  else delete roster.pairings[mechId];
  persistAndRender();
}

// ---------------------------------------------------------------------------
// Dark Matter
// ---------------------------------------------------------------------------
function renderDarkMatter(collection) {
  const hosts = [
    ...rosterCharacterIds(roster).map((id) => catalog.cardsById.get(id)),
    ...roster.mechs.map((id) => catalog.cardsById.get(id)),
  ];
  const dmCards = catalog.bySet.darkMatter.filter((c) => isOwned(collection[c.id]));

  el.addDarkMatterBtn.disabled = roster.darkMatter.length >= ROSTER_RULES.darkMatterMax || hosts.length === 0;

  if (roster.darkMatter.length === 0) {
    el.darkMatterList.innerHTML = `<div class="roster-empty-state">No corruptions added. Dark Matter is optional.</div>`;
    return;
  }

  el.darkMatterList.innerHTML = "";
  const allHostIds = roster.darkMatter.map((d) => d.hostId);
  roster.darkMatter.forEach((dm, i) => {
    const usedHosts = new Set(allHostIds.filter((_, j) => j !== i));
    const hostOptions = hosts
      .filter((h) => h.id === dm.hostId || !usedHosts.has(h.id))
      .map((h) => `<option value="${h.id}" ${h.id === dm.hostId ? "selected" : ""}>${h.name}</option>`)
      .join("");
    const cardOptions = dmCards.map((c) => `<option value="${c.id}" ${c.id === dm.cardId ? "selected" : ""}>${c.name}</option>`).join("");

    const row = document.createElement("div");
    row.className = "roster-darkmatter-row";
    row.innerHTML = `
      <div class="roster-pairing-field">
        <label for="dm-host-${i}">Host card</label>
        <select id="dm-host-${i}" class="roster-pairing-select"><option value="">(Choose)</option>${hostOptions}</select>
      </div>
      <div class="roster-pairing-field">
        <label for="dm-card-${i}">Dark Matter</label>
        <select id="dm-card-${i}" class="roster-pairing-select"><option value="">(Choose)</option>${cardOptions}</select>
      </div>
      <button type="button" class="icon-btn-danger" aria-label="Remove this corruption"><i data-lucide="x"></i></button>
    `;
    row.querySelector(`#dm-host-${i}`).addEventListener("change", (e) => { dm.hostId = e.target.value || null; persistAndRender(); });
    row.querySelector(`#dm-card-${i}`).addEventListener("change", (e) => { dm.cardId = e.target.value || null; persistAndRender(); });
    row.querySelector(".icon-btn-danger").addEventListener("click", () => {
      roster.darkMatter.splice(i, 1);
      persistAndRender();
    });
    el.darkMatterList.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Checklist strip + step-nav checkmarks + review
// ---------------------------------------------------------------------------
function renderChecklist(validation) {
  const { checks } = validation;
  el.checklist.innerHTML = checks
    .map(
      (c) => `
      <li class="roster-checklist-item${c.ok ? " complete" : ""}">
        <span class="roster-checklist-icon">${c.ok ? '<i data-lucide="check"></i>' : `${c.have}/${c.need}`}</span>
        ${c.label}
      </li>`
    )
    .join("");

  const stepCompletion = {
    characters: checks.find((c) => c.key === "main").ok && checks.find((c) => c.key === "subs").ok,
    mechs: checks.find((c) => c.key === "mechs").ok,
    wildcards: checks.find((c) => c.key === "wildcards").ok,
    pairing: checks.find((c) => c.key === "pairing").ok,
  };
  el.stepsNav.querySelectorAll(".roster-step-btn").forEach((btn) => {
    const done = stepCompletion[btn.dataset.step];
    const existing = btn.querySelector(".roster-step-check");
    if (done && !existing) {
      btn.insertAdjacentHTML("beforeend", '<i data-lucide="check" class="roster-step-check"></i>');
    } else if (!done && existing) {
      existing.remove();
    }
  });
}

function renderReview(validation) {
  const { checks, complete, unseated } = validation;
  el.exportBtn.disabled = !complete;

  if (complete && !wasRosterComplete) {
    celebrateRosterComplete();
  }
  wasRosterComplete = complete;

  const issues = [];
  for (const c of checks) {
    if (!c.ok && c.key !== "pairing") issues.push(`${c.label}: ${c.have} / ${c.need}`);
  }
  if (unseated.length) {
    issues.push(`Unassigned pilots: ${unseated.map((id) => catalog.cardsById.get(id)?.name).join(", ")}`);
  }

  let html = "";
  if (complete) {
    html += `<div class="roster-review-complete-banner"><i data-lucide="circle-check"></i> Roster complete! Ready to export.</div>`;
  } else {
    html += `<div class="roster-review-summary">`;
    html += `<p class="roster-hint" style="margin-bottom:12px">Still needed:</p>`;
    for (const issue of issues) {
      html += `<div class="roster-review-issue"><i data-lucide="circle-alert"></i> ${issue}</div>`;
    }
    html += `</div>`;
  }

  html += buildRosterSummaryHtml();
  el.review.innerHTML = html;
}

function celebrateRosterComplete() {
  if (typeof confetti !== "function") return;
  const gold = getComputedStyle(document.documentElement).getPropertyValue("--rarity-legendary").trim();
  confetti({
    particleCount: 90,
    spread: 100,
    origin: { y: 0.6 },
    colors: [gold, "#ffffff"],
    disableForReducedMotion: true,
  });
}

function buildRosterSummaryHtml() {
  const main = roster.main ? catalog.cardsById.get(roster.main) : null;
  const subs = roster.subs.map((id) => catalog.cardsById.get(id));
  const wildcards = roster.wildcards.map((id) => catalog.cardsById.get(id));
  const mechRows = roster.mechs.map((id) => {
    const mech = catalog.cardsById.get(id);
    const pairing = roster.pairings[id] || {};
    const base = pairing.base ? catalog.cardsById.get(pairing.base) : null;
    const co = pairing.co ? catalog.cardsById.get(pairing.co) : null;
    return `<li><strong>${mech.name}</strong> - Base: ${base ? base.name : "-"}${co ? `, Co-Pilot: ${co.name}` : ""}</li>`;
  });
  const dmRows = roster.darkMatter
    .filter((d) => d.hostId && d.cardId)
    .map((d) => {
      const host = catalog.cardsById.get(d.hostId);
      const card = catalog.cardsById.get(d.cardId);
      return `<li>${host.name}: ${card.name}</li>`;
    });

  return `
    <div class="roster-review-summary">
      <p><strong>Main:</strong> ${main ? main.name : "-"}</p>
      <p><strong>Subs:</strong> ${subs.length ? subs.map((c) => c.name).join(", ") : "-"}</p>
      <p><strong>Mechs &amp; Pilots:</strong></p>
      <ul>${mechRows.join("") || "<li>-</li>"}</ul>
      <p><strong>Wildcards:</strong> ${wildcards.length ? wildcards.map((c) => c.name).join(", ") : "-"}</p>
      <p><strong>Dark Matter:</strong></p>
      <ul>${dmRows.join("") || "<li>None</li>"}</ul>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Saved rosters (favorites)
// ---------------------------------------------------------------------------
function rosterIsEmpty(r) {
  return !r.main && r.subs.length === 0 && r.mechs.length === 0 && r.wildcards.length === 0;
}

function renderSavedRosters() {
  const saved = getSavedRosters();
  if (saved.length === 0) {
    el.savedRostersList.innerHTML = `<p class="roster-saved-empty-hint">No saved rosters yet. Build one and click "Save as Favorite".</p>`;
    return;
  }

  el.savedRostersList.innerHTML = "";
  for (const entry of saved) {
    const date = new Date(entry.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const row = document.createElement("div");
    row.className = "roster-saved-row";
    row.innerHTML = `
      <div class="roster-saved-info">
        <span class="roster-saved-name">${entry.name}</span>
        <span class="roster-saved-date">Saved ${date}</span>
      </div>
      <div class="roster-saved-actions">
        <button type="button" class="btn secondary roster-saved-load">Load</button>
        <button type="button" class="icon-btn-danger roster-saved-delete" aria-label="Delete ${entry.name}"><i data-lucide="trash-2"></i></button>
      </div>
    `;
    row.querySelector(".roster-saved-load").addEventListener("click", () => loadSavedRoster(entry));
    row.querySelector(".roster-saved-delete").addEventListener("click", async () => {
      const ok = await confirmAction({
        message: `Delete the saved roster "${entry.name}"? This can't be undone.`,
        confirmLabel: "Delete",
      });
      if (!ok) return;
      deleteSavedRoster(entry.id);
      renderSavedRosters();
      if (typeof lucide !== "undefined") lucide.createIcons();
    });
    el.savedRostersList.appendChild(row);
  }
}

async function loadSavedRoster(entry) {
  if (!rosterIsEmpty(roster)) {
    const ok = await confirmAction({
      message: `Load "${entry.name}"? This replaces your current in-progress roster.`,
      confirmLabel: "Load",
    });
    if (!ok) return;
  }
  roster = sanitizeRoster(entry.roster, getCollection());
  persistAndRender();
  announce(`Loaded roster "${entry.name}".`);
}

// ---------------------------------------------------------------------------
// Export / print
// ---------------------------------------------------------------------------
function buildVisualRosterHtml() {
  const main = roster.main ? catalog.cardsById.get(roster.main) : null;
  const subs = roster.subs.map((id) => catalog.cardsById.get(id));
  const wildcards = roster.wildcards.map((id) => catalog.cardsById.get(id));
  const mechs = roster.mechs.map((id) => catalog.cardsById.get(id));

  const dmByHost = {};
  for (const dm of roster.darkMatter) {
    if (!dm.hostId || !dm.cardId) continue;
    dmByHost[dm.hostId] = catalog.cardsById.get(dm.cardId);
  }

  function cardCell(card, caption) {
    const dmCard = dmByHost[card.id];
    const dmBadge = dmCard
      ? `<p class="roster-print-dm-badge"><i data-lucide="radiation"></i> ${dmCard.name}</p>`
      : "";
    return `
      <div class="roster-print-cell">
        ${renderCardFace(card, setById)}
        ${caption ? `<p class="roster-print-caption">${caption}</p>` : ""}
        ${dmBadge}
      </div>
    `;
  }

  const mechCells = mechs.map((mech) => {
    const pairing = roster.pairings[mech.id] || {};
    const base = pairing.base ? catalog.cardsById.get(pairing.base) : null;
    const co = pairing.co ? catalog.cardsById.get(pairing.co) : null;
    const caption = [base ? `Base: ${base.name}` : null, co ? `Co-Pilot: ${co.name}` : null].filter(Boolean).join(" / ");
    return cardCell(mech, caption);
  });

  const section = (title, cellsHtml) => `
    <section class="roster-print-section">
      <h2 class="roster-print-section-title">${title}</h2>
      <div class="roster-print-grid">${cellsHtml}</div>
    </section>
  `;

  return [
    section("Main Character", main ? cardCell(main) : "<p>-</p>"),
    section("Sub Characters", subs.map((c) => cardCell(c)).join("") || "<p>-</p>"),
    section("Mechs &amp; Pilots", mechCells.join("") || "<p>-</p>"),
    section("Wildcards", wildcards.map((c) => cardCell(c)).join("") || "<p>-</p>"),
  ].join("");
}

function exportRoster() {
  const { complete } = validateRoster(roster);
  if (!complete) return;
  el.printRoot.innerHTML = `<h1 class="roster-print-title">HueShift Roster</h1>${buildVisualRosterHtml()}`;
  if (typeof lucide !== "undefined") lucide.createIcons();
  window.print();
}

// ---------------------------------------------------------------------------
// Accessibility: live-region announcements for add/remove actions
// ---------------------------------------------------------------------------
let announceTimeout = null;
function announce(message) {
  el.liveStatus.textContent = "";
  clearTimeout(announceTimeout);
  announceTimeout = setTimeout(() => {
    el.liveStatus.textContent = message;
  }, 50);
}
