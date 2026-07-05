import { getCollection } from "./engine.js";
import {
  getRoster,
  saveRoster,
  sanitizeRoster,
  validateRoster,
  rosterCharacterIds,
  seatedCharacterIds,
  ROSTER_RULES,
} from "./roster.js";
import { renderCardFace } from "./card-render.js";

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

  for (const key of Object.keys(CATEGORY_DEFS)) {
    el[`pool_${key}`] = document.getElementById(`pool-${key}`);
    el[`slot_${key}`] = document.getElementById(`slot-${key}`);
    el[`count_${key}`] = document.getElementById(`count-${key}`);
  }

  roster = sanitizeRoster(getRoster(), getCollection());
  saveRoster(roster);

  wireStepsNav();
  wireDragAndDrop();
  el.addDarkMatterBtn.addEventListener("click", () => {
    if (roster.darkMatter.length >= ROSTER_RULES.darkMatterMax) return;
    roster.darkMatter.push({ hostId: null, gainId: null, penaltyId: null });
    persistAndRender();
  });
  el.exportBtn.addEventListener("click", exportRoster);
  el.resetBtn.addEventListener("click", () => {
    if (!confirm("Clear the entire roster? This can't be undone.")) return;
    roster = { main: null, subs: [], mechs: [], wildcards: [], pairings: {}, darkMatter: [] };
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
  renderAll();
}

function renderAll() {
  for (const key of Object.keys(CATEGORY_DEFS)) renderCategory(key);
  renderPairing();
  renderDarkMatter();
  renderChecklist();
  renderReview();
}

// ---------------------------------------------------------------------------
// Steps sub-nav
// ---------------------------------------------------------------------------
function wireStepsNav() {
  el.stepsNav.querySelectorAll(".roster-step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      el.stepsNav.querySelectorAll(".roster-step-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".roster-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
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

function renderCategory(key) {
  const def = CATEGORY_DEFS[key];
  const collection = getCollection();
  const owned = cardsByCategory[key].filter((c) => collection[c.id]);
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
  const btnLabel = mode === "add" ? "+ Add" : "− Remove";
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
  for (const mech of mechs) {
    const pairing = roster.pairings[mech.id] || { base: null, co: null };
    const row = document.createElement("div");
    row.className = "roster-pairing-row";
    row.innerHTML = `
      <div class="roster-pairing-mech">
        <span class="roster-pairing-mech-icon"><i class="fas ${mech.classIcon}"></i></span>
        ${mech.name}
      </div>
      <div class="roster-pairing-fields">
        <div class="roster-pairing-field">
          <label for="base-${mech.id}">Base Pilot</label>
          ${buildPilotSelect(mech, characters, pairing, "base")}
        </div>
        <div class="roster-pairing-field">
          <label for="co-${mech.id}">Co-Pilot</label>
          ${buildPilotSelect(mech, characters, pairing, "co")}
        </div>
      </div>
    `;
    row.querySelector(`#base-${mech.id}`).addEventListener("change", (e) => setPairing(mech.id, "base", e.target.value || null));
    row.querySelector(`#co-${mech.id}`).addEventListener("change", (e) => setPairing(mech.id, "co", e.target.value || null));
    el.pairingList.appendChild(row);
  }
}

function buildPilotSelect(mech, characters, pairing, seat) {
  const seated = seatedCharacterIds(roster);
  const currentValue = pairing[seat];
  const otherSeatValue = seat === "base" ? pairing.co : pairing.base;
  const options = characters
    .filter((c) => c.id === currentValue || (c.id !== otherSeatValue && !seated.has(c.id)))
    .map((c) => `<option value="${c.id}" ${c.id === currentValue ? "selected" : ""}>${c.name}${c.bond === mech.class ? " ★ Match" : ""}</option>`)
    .join("");
  const isMatch = currentValue && catalog.cardsById.get(currentValue)?.bond === mech.class;
  return `<select id="${seat}-${mech.id}" class="roster-pairing-select${isMatch ? " bond-match" : ""}"><option value="">— None —</option>${options}</select>`;
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
function renderDarkMatter() {
  const hosts = [
    ...rosterCharacterIds(roster).map((id) => catalog.cardsById.get(id)),
    ...roster.mechs.map((id) => catalog.cardsById.get(id)),
  ];
  const collection = getCollection();
  const gains = catalog.bySet.darkMatter.filter((c) => c.kind === "gain" && collection[c.id]);
  const penalties = catalog.bySet.darkMatter.filter((c) => c.kind === "penalty" && collection[c.id]);

  el.addDarkMatterBtn.disabled = roster.darkMatter.length >= ROSTER_RULES.darkMatterMax || hosts.length === 0;

  if (roster.darkMatter.length === 0) {
    el.darkMatterList.innerHTML = `<div class="roster-empty-state">No corruptions added. Dark Matter is optional.</div>`;
    return;
  }

  el.darkMatterList.innerHTML = "";
  roster.darkMatter.forEach((dm, i) => {
    const usedHosts = new Set(roster.darkMatter.filter((_, j) => j !== i).map((d) => d.hostId));
    const hostOptions = hosts
      .filter((h) => h.id === dm.hostId || !usedHosts.has(h.id))
      .map((h) => `<option value="${h.id}" ${h.id === dm.hostId ? "selected" : ""}>${h.name}</option>`)
      .join("");
    const gainOptions = gains.map((g) => `<option value="${g.id}" ${g.id === dm.gainId ? "selected" : ""}>${g.name}</option>`).join("");
    const penaltyOptions = penalties.map((p) => `<option value="${p.id}" ${p.id === dm.penaltyId ? "selected" : ""}>${p.name}</option>`).join("");

    const row = document.createElement("div");
    row.className = "roster-darkmatter-row";
    row.innerHTML = `
      <div class="roster-pairing-field">
        <label for="dm-host-${i}">Host card</label>
        <select id="dm-host-${i}" class="roster-pairing-select"><option value="">— Choose —</option>${hostOptions}</select>
      </div>
      <div class="roster-pairing-field">
        <label for="dm-gain-${i}">Gain</label>
        <select id="dm-gain-${i}" class="roster-pairing-select"><option value="">— Choose —</option>${gainOptions}</select>
      </div>
      <div class="roster-pairing-field">
        <label for="dm-penalty-${i}">Penalty</label>
        <select id="dm-penalty-${i}" class="roster-pairing-select"><option value="">— Choose —</option>${penaltyOptions}</select>
      </div>
      <button type="button" class="roster-darkmatter-remove" aria-label="Remove this corruption">&times;</button>
    `;
    row.querySelector(`#dm-host-${i}`).addEventListener("change", (e) => { dm.hostId = e.target.value || null; persistAndRender(); });
    row.querySelector(`#dm-gain-${i}`).addEventListener("change", (e) => { dm.gainId = e.target.value || null; persistAndRender(); });
    row.querySelector(`#dm-penalty-${i}`).addEventListener("change", (e) => { dm.penaltyId = e.target.value || null; persistAndRender(); });
    row.querySelector(".roster-darkmatter-remove").addEventListener("click", () => {
      roster.darkMatter.splice(i, 1);
      persistAndRender();
    });
    el.darkMatterList.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Checklist strip + step-nav checkmarks + review
// ---------------------------------------------------------------------------
function renderChecklist() {
  const { checks } = validateRoster(roster);
  el.checklist.innerHTML = checks
    .map(
      (c) => `
      <li class="roster-checklist-item${c.ok ? " complete" : ""}">
        <span class="roster-checklist-icon">${c.ok ? '<i class="fas fa-check"></i>' : `${c.have}/${c.need}`}</span>
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
      btn.insertAdjacentHTML("beforeend", '<i class="fas fa-check roster-step-check"></i>');
    } else if (!done && existing) {
      existing.remove();
    }
  });
}

function renderReview() {
  const { checks, complete, unseated } = validateRoster(roster);
  el.exportBtn.disabled = !complete;

  const issues = [];
  for (const c of checks) {
    if (!c.ok && c.key !== "pairing") issues.push(`${c.label}: ${c.have} / ${c.need}`);
  }
  if (unseated.length) {
    issues.push(`Unassigned pilots: ${unseated.map((id) => catalog.cardsById.get(id)?.name).join(", ")}`);
  }

  let html = "";
  if (complete) {
    html += `<div class="roster-review-complete-banner"><i class="fas fa-check-circle"></i> Roster complete! Ready to export.</div>`;
  } else {
    html += `<div class="roster-review-summary">`;
    html += `<p class="roster-hint" style="margin-bottom:12px">Still needed:</p>`;
    for (const issue of issues) {
      html += `<div class="roster-review-issue"><i class="fas fa-circle-exclamation"></i> ${issue}</div>`;
    }
    html += `</div>`;
  }

  html += buildRosterSummaryHtml();
  el.review.innerHTML = html;
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
    return `<li><strong>${mech.name}</strong> — Base: ${base ? base.name : "—"}${co ? `, Co-Pilot: ${co.name}` : ""}</li>`;
  });
  const dmRows = roster.darkMatter
    .filter((d) => d.hostId && d.gainId && d.penaltyId)
    .map((d) => {
      const host = catalog.cardsById.get(d.hostId);
      const gain = catalog.cardsById.get(d.gainId);
      const penalty = catalog.cardsById.get(d.penaltyId);
      return `<li>${host.name}: ${gain.name} + ${penalty.name}</li>`;
    });

  return `
    <div class="roster-review-summary">
      <p><strong>Main:</strong> ${main ? main.name : "—"}</p>
      <p><strong>Subs:</strong> ${subs.length ? subs.map((c) => c.name).join(", ") : "—"}</p>
      <p><strong>Mechs &amp; Pilots:</strong></p>
      <ul>${mechRows.join("") || "<li>—</li>"}</ul>
      <p><strong>Wildcards:</strong> ${wildcards.length ? wildcards.map((c) => c.name).join(", ") : "—"}</p>
      <p><strong>Dark Matter:</strong></p>
      <ul>${dmRows.join("") || "<li>None</li>"}</ul>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Export / print
// ---------------------------------------------------------------------------
function exportRoster() {
  const { complete } = validateRoster(roster);
  if (!complete) return;
  el.printRoot.innerHTML = `<h1>HueShift Roster</h1>${buildRosterSummaryHtml()}`;
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
