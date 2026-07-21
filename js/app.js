import { loadCatalog, buildWeightedPool, drawPack, getCollection, recordPulls, getAllowance, consumeAllowance, resetAllowance, resetCollection, getPacksOpenedCount, recordPackOpened } from "./engine.js";
import { primeAudio, playTear, playFlip, playChime, playFanfare } from "./sound.js";
import { spring, SPRING_PRESETS } from "./spring.js";
import { renderCardFace as renderCardFaceShared, renderLockedFace as renderLockedFaceShared } from "./card-render.js";
import { initRosterUI, refreshRosterUI } from "./roster-ui.js";
import { confirmAction } from "./confirm-modal.js";
import { wireHoloTilt } from "./holo-tilt.js";

const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, legendary: 3 };
const RARITY_LABEL = { common: "Common", uncommon: "Uncommon", rare: "Rare", legendary: "Legendary" };
const HOLD_DURATION_MS = 600;
const RING_CIRCUMFERENCE = 289;

let catalog = null;
let weightedPool = null;
let setById = {};
let currentIsNew = {};
let revealedCount = 0;
let packSize = 0;

const el = {
  allowanceCount: document.getElementById("allowance-count"),
  openStage: document.getElementById("open-stage"),
  packBtn: document.getElementById("pack-btn"),
  packProgressRing: document.getElementById("pack-progress-ring"),
  packProgressRingFg: document.getElementById("pack-progress-ring-fg"),
  openHint: document.getElementById("open-hint"),
  revealRow: document.getElementById("reveal-row"),
  packSummary: document.getElementById("pack-summary"),
  revealActions: document.getElementById("reveal-actions"),
  revealAllBtn: document.getElementById("reveal-all-btn"),
  againBtn: document.getElementById("again-btn"),
  collectionRoot: document.getElementById("collection-root"),
  packsOpenedStat: document.getElementById("packs-opened-stat"),
  tabs: document.querySelectorAll(".tab-btn"),
  views: document.querySelectorAll(".view"),
  cardModal: document.getElementById("card-modal"),
  cardModalFlip: document.getElementById("card-modal-flip"),
  cardModalFront: document.getElementById("card-modal-front"),
  cardModalClose: document.getElementById("card-modal-close"),
  resetAllowanceBtn: document.getElementById("reset-allowance-btn"),
  resetCollectionBtn: document.getElementById("reset-collection-btn"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsPanel: document.getElementById("settings-panel"),
  legendarySpotlight: document.getElementById("legendary-spotlight"),
  newToast: document.getElementById("new-toast"),
  fxFlash: document.getElementById("fx-flash"),
  fxVignette: document.getElementById("fx-vignette"),
};

init();

async function init() {
  catalog = await loadCatalog();
  setById = Object.fromEntries(catalog.config.sets.map((s) => [s.id, s]));
  weightedPool = buildWeightedPool(catalog.allCards, catalog.config.rarities);

  wireTabs();
  wirePack();
  wireCardModal();
  wireSettingsMenu();
  el.resetAllowanceBtn.addEventListener("click", () => {
    resetAllowance();
    resetOpenStage();
    closeSettingsMenu();
  });
  el.resetCollectionBtn.addEventListener("click", async () => {
    closeSettingsMenu();
    const ok = await confirmAction({
      message: "Clear your entire collection? Every card you've pulled will be gone. This can't be undone.",
      confirmLabel: "Clear Collection",
    });
    if (!ok) return;
    resetCollection();
    renderCollection();
    refreshRosterUI();
  });
  initRosterUI({ catalog, goToPacksTab: () => switchToView("view-open") });
  updateAllowanceDisplay();
  renderCollection();
  renderFoilSamples();
}

// ---------------------------------------------------------------------------
// Foil inspection gallery (Open Packs tab) - one forced sample per data-foil
// variant so they can be compared side by side, independent of the rarity-
// gated odds that normally decide which foil a real pulled card gets.
// ---------------------------------------------------------------------------
const FOIL_SAMPLES = [
  { foil: null, label: "Normal" },
  { foil: "reverse", label: "Reverse" },
  { foil: "holo", label: "Holo" },
  { foil: "super-holo", label: "Super Holo" },
  { foil: "cosmos", label: "Cosmos" },
  { foil: "secret", label: "Secret" },
];

function renderFoilSamples() {
  const grid = document.getElementById("foil-samples-grid");
  if (!grid) return;
  grid.innerHTML = "";
  FOIL_SAMPLES.forEach((sample, i) => {
    const card = catalog.allCards[i % catalog.allCards.length];
    const wrap = document.createElement("div");
    wrap.className = "foil-sample";
    const holder = document.createElement("div");
    holder.innerHTML = renderCardFace(card);
    const cardEl = holder.firstElementChild;
    wireHoloTilt(cardEl);
    if (sample.foil) {
      cardEl.dataset.foil = sample.foil;
      // Force the shine permanently visible (bypassing the hover-only
      // opacity wireHoloTilt normally uses): at rest these samples look
      // identical - there's nothing to tell them apart until you hover, so
      // a glance at the gallery without moving the mouse over every single
      // card looks like "none of these do anything." Hovering still works
      // normally on top of this. "Normal" is deliberately excluded - it
      // should show zero effect (no shine, no glare) at rest, not even the
      // plain white highlight, since it's the flat baseline to compare
      // the others against.
      wrap.style.setProperty("--holo-opacity", "1");
      wrap.style.setProperty("--pointer-x", "35%");
      wrap.style.setProperty("--pointer-y", "30%");
      wrap.style.setProperty("--bg-x", "38%");
      wrap.style.setProperty("--bg-y", "35%");
    } else {
      delete cardEl.dataset.foil;
    }
    const label = document.createElement("span");
    label.className = "foil-sample-label";
    label.textContent = sample.label;
    wrap.appendChild(cardEl);
    wrap.appendChild(label);
    grid.appendChild(wrap);
  });
  refreshIcons();
}

function wireTabs() {
  el.tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      switchToView(btn.dataset.view);
      if (btn.dataset.view === "view-roster") refreshRosterUI();
    });
  });
}

function switchToView(viewId) {
  el.tabs.forEach((b) => b.classList.toggle("active", b.dataset.view === viewId));
  el.views.forEach((v) => v.classList.toggle("active", v.id === viewId));
}

function wireSettingsMenu() {
  el.settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = el.settingsPanel.classList.toggle("open");
    el.settingsBtn.setAttribute("aria-expanded", String(isOpen));
  });
  document.addEventListener("click", (e) => {
    if (!el.settingsPanel.classList.contains("open")) return;
    if (e.target === el.settingsBtn || el.settingsPanel.contains(e.target)) return;
    closeSettingsMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettingsMenu();
  });
}

function closeSettingsMenu() {
  el.settingsPanel.classList.remove("open");
  el.settingsBtn.setAttribute("aria-expanded", "false");
}

function updateAllowanceDisplay() {
  const state = getAllowance(catalog.config.dailyAllowance);
  el.allowanceCount.textContent = `${state.remaining} / ${catalog.config.dailyAllowance}`;
  el.packBtn.disabled = state.remaining <= 0;
  el.openHint.textContent = state.remaining > 0
    ? "Hold the pack to open it."
    : "No packs left today - come back tomorrow.";
}

// ---------------------------------------------------------------------------
// Press-and-hold-to-open. Pointer devices must hold for HOLD_DURATION_MS;
// keyboard activation (Enter/Space -> native click, no preceding pointerdown)
// opens immediately since a hold gesture isn't meaningful there.
// ---------------------------------------------------------------------------
let holdRafId = null;
let holdStartTime = null;
let holdTriggeredOpen = false;
let hadPointerInteraction = false;

// Pack hover/press/hold feedback is spring-driven rather than CSS-transitioned
// (see the .pack rule in style.css for why) - two independent springs for
// scale and lift, combined into one transform on every tick.
const PACK_TARGETS = {
  rest: { scale: 1, lift: 0 },
  hover: { scale: 1.02, lift: -4 },
  pressed: { scale: 0.96, lift: 0 },
};
let packScale = 1;
let packLift = 0;
let cancelPackScaleSpring = null;
let cancelPackLiftSpring = null;

function setPackInteractionState(state) {
  const { scale, lift } = PACK_TARGETS[state];
  if (cancelPackScaleSpring) cancelPackScaleSpring();
  if (cancelPackLiftSpring) cancelPackLiftSpring();
  cancelPackScaleSpring = spring({
    from: packScale, to: scale, ...SPRING_PRESETS.ui,
    onUpdate: (v) => { packScale = v; applyPackTransform(); },
  });
  cancelPackLiftSpring = spring({
    from: packLift, to: lift, ...SPRING_PRESETS.ui,
    onUpdate: (v) => { packLift = v; applyPackTransform(); },
  });
}

function applyPackTransform() {
  el.packBtn.style.transform = `translateY(${packLift}px) scale(${packScale})`;
}

function wirePack() {
  el.packBtn.addEventListener("pointerenter", () => {
    if (el.packBtn.disabled || holdStartTime !== null) return;
    setPackInteractionState("hover");
  });
  el.packBtn.addEventListener("pointerleave", () => {
    if (holdStartTime === null) setPackInteractionState("rest");
  });
  el.packBtn.addEventListener("pointerdown", onPackPointerDown);
  el.packBtn.addEventListener("pointerup", onPackPointerUp);
  el.packBtn.addEventListener("pointerleave", onPackPointerUp);
  el.packBtn.addEventListener("pointercancel", onPackPointerUp);
  el.packBtn.addEventListener("click", onPackClick);

  el.revealAllBtn.addEventListener("click", () => {
    document.querySelectorAll(".reveal-slot:not(.flipped)").forEach((slot, i) => {
      setTimeout(() => flipSlot(slot), i * 150);
    });
  });
  el.againBtn.addEventListener("click", resetOpenStage);
}

function onPackPointerDown() {
  if (el.packBtn.disabled) return;
  hadPointerInteraction = true;
  primeAudio();
  holdStartTime = performance.now();
  setPackInteractionState("pressed");
  el.packProgressRing.classList.add("active");
  tickHold();
}

function tickHold() {
  if (holdStartTime === null) return;
  const elapsed = performance.now() - holdStartTime;
  const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
  el.packProgressRingFg.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
  if (progress >= 1) {
    holdTriggeredOpen = true;
    finishHoldVisuals();
    openPack();
    return;
  }
  holdRafId = requestAnimationFrame(tickHold);
}

function onPackPointerUp() {
  if (holdRafId) cancelAnimationFrame(holdRafId);
  holdRafId = null;
  holdStartTime = null;
  finishHoldVisuals();
}

function finishHoldVisuals() {
  setPackInteractionState(el.packBtn.matches(":hover") ? "hover" : "rest");
  el.packProgressRing.classList.remove("active");
  el.packProgressRingFg.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
}

function onPackClick() {
  if (holdTriggeredOpen) {
    holdTriggeredOpen = false;
    return;
  }
  if (hadPointerInteraction) {
    hadPointerInteraction = false;
    return;
  }
  if (!el.packBtn.disabled) openPack();
}

// ---------------------------------------------------------------------------
// Card zoom modal
// ---------------------------------------------------------------------------
let modalAngle = 0;
let cancelModalSpring = null;

function wireCardModal() {
  el.cardModalFlip.addEventListener("click", () => {
    const target = modalAngle < 90 ? 180 : 0;
    if (cancelModalSpring) cancelModalSpring();
    cancelModalSpring = spring({
      from: modalAngle,
      to: target,
      ...SPRING_PRESETS.ui,
      onUpdate: (deg) => {
        modalAngle = deg;
        el.cardModalFlip.style.transform = `rotateY(${deg}deg)`;
      },
    });
  });
  el.cardModalClose.addEventListener("click", closeCardModal);
  el.cardModal.addEventListener("click", (e) => {
    if (e.target === el.cardModal) closeCardModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCardModal();
  });
}

function refreshIcons() {
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function openCardModal(card) {
  el.cardModalFront.innerHTML = renderCardFace(card);
  wireHoloTilt(el.cardModalFront.querySelector(".card"));
  refreshIcons();
  if (cancelModalSpring) cancelModalSpring();
  modalAngle = 180;
  el.cardModalFlip.style.transform = "rotateY(180deg)";
  el.cardModal.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeCardModal() {
  el.cardModal.classList.remove("open");
  document.body.style.overflow = "";
}

// ---------------------------------------------------------------------------
// Pack opening + reveal
// ---------------------------------------------------------------------------
function openPack() {
  const state = consumeAllowance(catalog.config.dailyAllowance);
  if (!state) return;
  updateAllowanceDisplay();
  recordPackOpened();

  const pulled = drawPack(weightedPool, catalog.config.packSize)
    .slice()
    .sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity]);
  currentIsNew = recordPulls(pulled.map((c) => c.id));
  renderCollection();
  refreshRosterUI();

  playTear();
  triggerHaptic(30);
  triggerFlash();
  triggerShake();

  el.packBtn.classList.add("opening");
  setTimeout(() => showRevealRow(pulled), 480);
}

function showRevealRow(pulled) {
  el.packBtn.classList.remove("opening");
  el.packBtn.style.display = "none";
  el.openHint.style.display = "none";
  el.packSummary.style.display = "none";
  el.revealRow.innerHTML = "";
  el.revealActions.style.display = "flex";
  el.revealAllBtn.disabled = false;
  revealedCount = 0;
  packSize = pulled.length;

  pulled.forEach((card, i) => {
    const slot = document.createElement("div");
    slot.className = "reveal-slot flickering";
    slot.dataset.cardId = card.id;
    slot.dataset.rarity = card.rarity;
    slot.innerHTML = `
      <div class="reveal-flip">
        <div class="slot-face slot-back"><i data-lucide="circle-help"></i></div>
        <div class="slot-face slot-front">${renderCardFace(card)}</div>
      </div>
    `;
    slot.addEventListener("click", () => {
      if (slot.classList.contains("flipped")) {
        openCardModal(card);
      } else {
        flipSlot(slot);
      }
    });
    el.revealRow.appendChild(slot);
    setTimeout(() => slot.classList.add("visible"), 20 + i * 110);
  });
  refreshIcons();
}

function flipSlot(slot) {
  if (slot.classList.contains("flipped")) return;
  slot.classList.add("flipped");
  revealedCount += 1;

  const card = catalog.cardsById.get(slot.dataset.cardId);
  const flipEl = slot.querySelector(".reveal-flip");
  const preset = SPRING_PRESETS[card.rarity] || SPRING_PRESETS.common;
  spring({
    from: 0,
    to: 180,
    ...preset,
    onUpdate: (deg) => {
      flipEl.style.transform = `rotateY(${deg}deg)`;
    },
    onComplete: () => slot.classList.add("revealed"),
  });
  playFlip();

  const rect = slot.getBoundingClientRect();
  const origin = {
    x: (rect.left + rect.width / 2) / window.innerWidth,
    y: (rect.top + rect.height / 2) / window.innerHeight,
  };

  if (card.rarity === "rare") {
    triggerHaptic([20, 30, 40]);
    playChime();
    burstConfetti({ particleCount: 60, spread: 55, origin, colors: [getThemeColor("--rarity-rare"), "#ffffff"] });
  } else if (card.rarity === "legendary") {
    triggerHaptic([30, 40, 30, 40, 60]);
    playFanfare();
    triggerVignette();
    showLegendarySpotlight(card);
  }

  if (currentIsNew[card.id]) {
    showNewToast(card.name);
  }

  if (revealedCount >= packSize) {
    showPackSummary();
  }
}

function showPackSummary() {
  const rarityCounts = {};
  document.querySelectorAll("#reveal-row .reveal-slot").forEach((slot) => {
    const r = slot.dataset.rarity;
    rarityCounts[r] = (rarityCounts[r] || 0) + 1;
  });
  const order = ["legendary", "rare", "uncommon", "common"];
  const parts = order.filter((r) => rarityCounts[r]).map((r) => `${rarityCounts[r]} ${RARITY_LABEL[r]}`);
  el.packSummary.textContent = parts.join(" · ");
  el.packSummary.style.display = "";

  if (rarityCounts.legendary) {
    burstConfetti({
      particleCount: 120,
      spread: 120,
      startVelocity: 50,
      origin: { x: 0.5, y: 0.9 },
      colors: [getThemeColor("--rarity-legendary"), getThemeColor("--rarity-rare"), "#ffffff"],
      shapes: ["star", "circle"],
    });
  } else if (rarityCounts.rare) {
    burstConfetti({
      particleCount: 60,
      spread: 90,
      origin: { x: 0.5, y: 0.9 },
      colors: [getThemeColor("--rarity-rare"), "#ffffff"],
    });
  }
}

function resetOpenStage() {
  el.revealRow.innerHTML = "";
  el.revealActions.style.display = "none";
  el.packSummary.style.display = "none";
  el.packBtn.style.display = "";
  el.openHint.style.display = "";
  revealedCount = 0;
  if (cancelPackScaleSpring) cancelPackScaleSpring();
  if (cancelPackLiftSpring) cancelPackLiftSpring();
  packScale = 1;
  packLift = 0;
  applyPackTransform();
  updateAllowanceDisplay();
}

// ---------------------------------------------------------------------------
// Screen-level FX helpers
// ---------------------------------------------------------------------------
function triggerHaptic(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function triggerFlash() {
  el.fxFlash.classList.remove("play");
  void el.fxFlash.offsetWidth;
  el.fxFlash.classList.add("play");
}

function triggerShake() {
  el.openStage.classList.remove("shake");
  void el.openStage.offsetWidth;
  el.openStage.classList.add("shake");
}

function triggerVignette() {
  el.fxVignette.classList.remove("play");
  void el.fxVignette.offsetWidth;
  el.fxVignette.classList.add("play");
}

function burstConfetti(opts) {
  if (typeof window.confetti === "function") {
    window.confetti({ disableForReducedMotion: true, ...opts });
  }
}

function getThemeColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function showLegendarySpotlight(card) {
  el.legendarySpotlight.innerHTML = renderCardFace(card);
  refreshIcons();
  el.legendarySpotlight.classList.add("open");
  legendaryFireworks();
  setTimeout(() => {
    el.legendarySpotlight.classList.remove("open");
    el.legendarySpotlight.innerHTML = "";
  }, 1700);
}

function legendaryFireworks() {
  const gold = getThemeColor("--rarity-legendary");
  burstConfetti({
    particleCount: 90,
    spread: 100,
    startVelocity: 55,
    origin: { x: 0.5, y: 0.35 },
    colors: [gold, "#ffffff"],
    shapes: ["star", "circle"],
    scalar: 1.1,
  });
  setTimeout(() => {
    burstConfetti({ particleCount: 45, angle: 60, spread: 60, startVelocity: 45, origin: { x: 0, y: 0.7 }, colors: [gold, "#ffffff"], shapes: ["star"] });
    burstConfetti({ particleCount: 45, angle: 120, spread: 60, startVelocity: 45, origin: { x: 1, y: 0.7 }, colors: [gold, "#ffffff"], shapes: ["star"] });
  }, 300);
}

let toastTimeoutId = null;
function showNewToast(name) {
  el.newToast.textContent = `New: ${name}!`;
  el.newToast.classList.add("show");
  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    el.newToast.classList.remove("show");
  }, 1500);
}

// ---------------------------------------------------------------------------
// Collection view
// ---------------------------------------------------------------------------
function renderCollection() {
  const collection = getCollection();
  el.packsOpenedStat.textContent = `Packs opened: ${getPacksOpenedCount()}`;
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
        wireHoloTilt(cardEl);
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
  refreshIcons();
}

function renderCardFace(card) {
  return renderCardFaceShared(card, setById);
}

function renderLockedFace(card) {
  return renderLockedFaceShared(card, setById);
}
