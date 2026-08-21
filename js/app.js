import { loadCatalog, buildDrawPool, drawPack, getCollection, recordPulls, getAllowance, consumeAllowance, resetAllowance, resetCollection, getPacksOpenedCount, recordPackOpened, totalOwned, isOwned, rarityCount, rarityVariants } from "./engine.js";
import { primeAudio, playTear, playFlip, playChime, playFanfare } from "./sound.js";
import { spring, SPRING_PRESETS } from "./spring.js";
import { renderCardFace as renderCardFaceShared, renderLockedFace as renderLockedFaceShared } from "./card-render.js";
import { initRosterUI, refreshRosterUI } from "./roster-ui.js";
import { confirmAction } from "./confirm-modal.js";
import { wireHoloTilt } from "./holo-tilt.js";

const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, legendary: 3 };
const RARITY_LABEL = { common: "Common", uncommon: "Uncommon", rare: "Rare", legendary: "Legendary" };
const FOIL_LABEL = { none: "Normal", reverse: "Reverse", tin: "Tin", holo: "Holo", cosmos: "Cosmos", "super-holo": "Super Holo", secret: "Secret", frost: "Frost" };
const FOIL_ORDER = ["none", "reverse", "tin", "holo", "super-holo", "cosmos", "secret", "frost"];
const HOLD_DURATION_MS = 600;
const RING_CIRCUMFERENCE = 289;

// Below this width the reveal switches from an all-at-once grid to a swipeable one-card carousel
// (10 pulled cards collapse to a single scrolling column otherwise). Matches the breakpoint already
// used elsewhere for mobile-tuned layout (pack-button shrink, Collection grid reflow).
const MOBILE_REVEAL_QUERY = "(max-width: 640px)";
const SWIPE_ADVANCE_PX = 50;
const TAP_VS_DRAG_PX = 8;

// Sort options for the characters set in Collection. Class is read off the last word of `role`
// ("Brave Hero" -> Hero) rather than a dedicated field, since that's already guaranteed consistent
// across every character entry. Affinity sorts by `bond` directly.
const CHARACTER_CLASS_ORDER = ["Hero", "Leader", "Brute", "Sworder", "Gunner"];
const CHARACTER_BOND_ORDER = ["fast", "tank", "arsenal", "stable", "elemental"];

function characterClass(card) {
  return card.role ? card.role.split(" ").pop() : "";
}

let catalog = null;
let weightedPool = null;
let setById = {};
let currentIsNew = {};
let currentPulls = null;
let lastRevealIsMobile = null;
let revealedCount = 0;
let packSize = 0;
let collectionSort = "default";
const collapsedSets = new Set();

// Mobile reveal carousel state - all reset per pack open (resetOpenStage) / rebuilt per showRevealRow.
let carouselTrackEl = null;
let carouselIndex = 0;
let carouselSlotCount = 0;
let cancelCarouselSpring = null;
let carouselOffsetPx = 0;
let dragPointerId = null;
let dragStartX = 0;
let lastPointerX = 0;
let dragStartOffsetPx = 0;
let dragDistancePx = 0;

const el = {
  allowanceCount: document.getElementById("allowance-count"),
  openStage: document.getElementById("open-stage"),
  packStack: document.getElementById("pack-stack"),
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
  cardModalPop: document.getElementById("card-modal-pop"),
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
  weightedPool = buildDrawPool(catalog.allCards);

  wireTabs();
  wirePack();
  wireCardModal();
  wireSettingsMenu();
  wireRevealResize();
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
// Foil inspection gallery: one forced sample per data-foil variant, independent of real pull odds.
// ---------------------------------------------------------------------------
// Each sample uses one of the real PNG art cards, paired with a foil that card can actually roll
// (see CARD_FOIL_OPTIONS in foil-config.js) so the gallery never shows an impossible combination.
const FOIL_SAMPLES = [
  { foil: null, label: "Normal", cardId: "char-zo", rarity: "common" },
  { foil: "reverse", label: "Reverse", cardId: "char-llewellyn", rarity: "rare" },
  { foil: "tin", label: "Tin", cardId: "char-starlot", rarity: "uncommon" },
  { foil: "holo", label: "Holo", cardId: "char-rufus", rarity: "rare" },
  { foil: "super-holo", label: "Super Holo", cardId: "char-sadie", rarity: "legendary" },
  { foil: "cosmos", label: "Cosmos", cardId: "mech-cidermayer", rarity: "rare" },
  { foil: "secret", label: "Secret", cardId: "char-blac", rarity: "legendary" },
  { foil: "frost", label: "Frost", cardId: "char-brb", rarity: "legendary" },
];

function renderFoilSamples() {
  const grid = document.getElementById("foil-samples-grid");
  if (!grid) return;
  grid.innerHTML = "";
  FOIL_SAMPLES.forEach((sample) => {
    const card = catalog.cardsById.get(sample.cardId);
    const wrap = document.createElement("div");
    wrap.className = "foil-sample";
    const holder = document.createElement("div");
    holder.innerHTML = renderCardFace(card, sample.rarity);
    const cardEl = holder.firstElementChild;
    wireHoloTilt(cardEl);
    if (sample.foil) {
      cardEl.dataset.foil = sample.foil;
      // Forces the shine visible at rest (normally hover-only) so samples aren't
      // indistinguishable until hovered; "Normal" stays excluded as the zero-effect baseline.
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
  el.tabs.forEach((b) => {
    const selected = b.dataset.view === viewId;
    b.classList.toggle("active", selected);
    b.setAttribute("aria-selected", String(selected));
  });
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
  // Only 2 decorative layers exist, so the stack tops out at "3" regardless of a higher allowance.
  el.packStack.className = `pack-stack count-${Math.min(state.remaining, 3)}`;
}

// ---------------------------------------------------------------------------
// Press-and-hold-to-open. Keyboard activation opens immediately (no hold) since a hold gesture isn't meaningful there.
// ---------------------------------------------------------------------------
let holdRafId = null;
let holdStartTime = null;
let holdTriggeredOpen = false;
let hadPointerInteraction = false;

// Spring-driven (not CSS-transitioned, see .pack in style.css) - scale + lift combined into one transform per tick.
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
    const unflipped = document.querySelectorAll(".reveal-slot:not(.flipped)");
    unflipped.forEach((slot, i) => {
      setTimeout(() => flipSlot(slot), i * 150);
    });
    if (carouselTrackEl) {
      setTimeout(() => goToCarouselIndex(carouselSlotCount - 1), unflipped.length * 150);
    }
  });
  el.againBtn.addEventListener("click", () => {
    resetOpenStage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.addEventListener("keydown", (e) => {
    if (!carouselTrackEl) return;
    if (e.key === "ArrowLeft") goToCarouselIndex(carouselIndex - 1);
    else if (e.key === "ArrowRight") goToCarouselIndex(carouselIndex + 1);
  });
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

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let popCancels = [];

// FLIP-technique entrance: grows from the clicked card's own position/size into the centered modal.
function animatePopFromSource(sourceEl) {
  popCancels.forEach((cancel) => cancel());
  popCancels = [];
  const pop = el.cardModalPop;
  pop.style.transform = "";
  if (!sourceEl || prefersReducedMotion) return;

  const from = sourceEl.getBoundingClientRect();
  const to = pop.getBoundingClientRect();
  if (!from.width || !from.height || !to.width || !to.height) return;

  const state = {
    x: from.left + from.width / 2 - (to.left + to.width / 2),
    y: from.top + from.height / 2 - (to.top + to.height / 2),
    sx: from.width / to.width,
    sy: from.height / to.height,
  };
  const target = { x: 0, y: 0, sx: 1, sy: 1 };
  const apply = () => {
    pop.style.transform = `translate(${state.x.toFixed(2)}px, ${state.y.toFixed(2)}px) scale(${state.sx.toFixed(3)}, ${state.sy.toFixed(3)})`;
  };
  apply();

  popCancels = Object.keys(target).map((key) =>
    spring({
      from: state[key],
      to: target[key],
      ...SPRING_PRESETS.ui,
      onUpdate: (v) => {
        state[key] = v;
        apply();
      },
    })
  );
}

// `overflow: hidden` on body alone doesn't stop background scroll/rubber-band on iOS Safari
// behind a `position: fixed` overlay - pinning the body in place with a negative top offset
// (restored on unlock) is the fix that actually holds on iOS.
let lockedScrollY = 0;

function lockScroll() {
  lockedScrollY = window.scrollY;
  document.body.style.position = "fixed";
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.width = "100%";
  document.body.style.overflow = "hidden";
}

function unlockScroll() {
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.width = "";
  document.body.style.overflow = "";
  window.scrollTo(0, lockedScrollY);
}

function openCardModal(card, sourceEl, variant, rarity) {
  el.cardModalFront.innerHTML = renderCardFace(card, rarity);
  wireHoloTilt(el.cardModalFront.querySelector(".card"), variant);
  refreshIcons();
  if (cancelModalSpring) cancelModalSpring();
  modalAngle = 180;
  el.cardModalFlip.style.transform = "rotateY(180deg)";
  el.cardModal.classList.add("open");
  lockScroll();
  animatePopFromSource(sourceEl);
}

function closeCardModal() {
  el.cardModal.classList.remove("open");
  unlockScroll();
}

// ---------------------------------------------------------------------------
// Pack opening + reveal
// ---------------------------------------------------------------------------
function openPack() {
  const state = consumeAllowance(catalog.config.dailyAllowance);
  if (!state) return;
  updateAllowanceDisplay();
  recordPackOpened();

  const pulled = drawPack(weightedPool, catalog.config.packSize);
  const { isNew, pulls } = recordPulls(pulled, catalog.config.rarities);
  pulls.sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity]);
  currentIsNew = isNew;
  renderCollection();
  refreshRosterUI();

  playTear();
  triggerHaptic(30);
  triggerFlash();
  triggerShake();

  el.packBtn.classList.add("opening");
  setTimeout(() => showRevealRow(pulls), 480);
}

// Crossing the carousel/grid breakpoint mid-reveal (device rotation) leaves the wrong DOM structure
// for the now-active CSS, collapsing every card - rebuild with the same pulls when that happens.
function wireRevealResize() {
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (currentPulls === null) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const isMobile = window.matchMedia(MOBILE_REVEAL_QUERY).matches;
      if (isMobile !== lastRevealIsMobile) showRevealRow(currentPulls);
    }, 150);
  });
}

function showRevealRow(pulls) {
  el.packBtn.classList.remove("opening");
  el.packStack.style.display = "none";
  el.openHint.style.display = "none";
  el.packSummary.style.display = "none";
  el.revealRow.innerHTML = "";
  el.revealRow.classList.remove("carousel-mode");
  el.revealActions.style.display = "flex";
  el.revealAllBtn.disabled = false;
  revealedCount = 0;
  packSize = pulls.length;
  carouselTrackEl = null;
  carouselIndex = 0;
  carouselSlotCount = 0;

  const isMobile = window.matchMedia(MOBILE_REVEAL_QUERY).matches;
  currentPulls = pulls;
  lastRevealIsMobile = isMobile;
  const container = isMobile ? buildCarouselContainer() : el.revealRow;

  pulls.forEach(({ card, variant, rarity }, i) => {
    const slot = buildRevealSlot(card, variant, rarity);
    if (isMobile) {
      // Each page is a full-track-width flex cell that just centers its (normal-sized) card - this
      // keeps the paging math (one page = one track-width step) completely decoupled from the
      // card's own visual size, so the card can stay capped at its usual max-width instead of
      // stretching edge-to-edge, without reintroducing the flush-packed/bleed-through issue a
      // capped-width flex item had directly inside a non-wrapping overflowing track.
      const page = document.createElement("div");
      page.className = "reveal-carousel-page";
      page.appendChild(slot);
      container.appendChild(page);
      // Only one slot is ever visible through the clipped carousel track, so there's nothing for
      // the grid's staggered fly-in to show - just mark every slot ready immediately.
      slot.classList.add("visible");
    } else {
      container.appendChild(slot);
      setTimeout(() => slot.classList.add("visible"), 20 + i * 110);
    }
  });

  if (isMobile) {
    carouselSlotCount = pulls.length;
    goToCarouselIndex(0, { immediate: true });
  }

  refreshIcons();
}

function buildRevealSlot(card, variant, rarity) {
  const slot = document.createElement("div");
  slot.className = "reveal-slot";
  slot.dataset.cardId = card.id;
  slot.dataset.rarity = rarity;
  slot.innerHTML = `
    <div class="reveal-flip">
      <div class="slot-face slot-back"><img class="card-back-img" src="card-samples/HS-Card-Back.png" alt="Card back"></div>
      <div class="slot-face slot-front">${renderCardFace(card, rarity)}</div>
    </div>
  `;
  wireHoloTilt(slot.querySelector(".slot-front .card"), variant);
  slot.addEventListener("click", () => {
    if (slot.classList.contains("flipped")) {
      openCardModal(card, slot, variant, rarity);
    } else {
      flipSlot(slot);
    }
  });
  return slot;
}

// ---------------------------------------------------------------------------
// Mobile reveal carousel: one pulled card at a time, swipe/buttons/arrow keys to page.
// ---------------------------------------------------------------------------
function buildCarouselContainer() {
  el.revealRow.classList.add("carousel-mode");

  const track = document.createElement("div");
  track.className = "reveal-carousel-track";
  // A real drag (past the tap threshold) shouldn't also flip the card underneath the finger -
  // suppress the slot's own click handler for that pointer session only.
  track.addEventListener("click", (e) => {
    if (dragDistancePx > TAP_VS_DRAG_PX) e.stopImmediatePropagation();
  }, { capture: true });
  track.addEventListener("pointerdown", onCarouselPointerDown);
  track.addEventListener("pointermove", onCarouselPointerMove);
  track.addEventListener("pointerup", onCarouselPointerUp);
  track.addEventListener("pointercancel", onCarouselPointerUp);
  el.revealRow.appendChild(track);
  carouselTrackEl = track;

  const nav = document.createElement("div");
  nav.className = "reveal-carousel-nav";
  nav.innerHTML = `
    <button type="button" class="reveal-carousel-btn reveal-carousel-prev" aria-label="Previous card"><i data-lucide="chevron-left"></i></button>
    <span class="reveal-carousel-counter"></span>
    <button type="button" class="reveal-carousel-btn reveal-carousel-next" aria-label="Next card"><i data-lucide="chevron-right"></i></button>
  `;
  nav.querySelector(".reveal-carousel-prev").addEventListener("click", () => goToCarouselIndex(carouselIndex - 1));
  nav.querySelector(".reveal-carousel-next").addEventListener("click", () => goToCarouselIndex(carouselIndex + 1));
  el.revealRow.appendChild(nav);

  return track;
}

function goToCarouselIndex(index, { immediate = false } = {}) {
  if (!carouselTrackEl) return;
  carouselIndex = Math.max(0, Math.min(index, carouselSlotCount - 1));
  const slotWidth = carouselTrackEl.getBoundingClientRect().width || 1;
  const target = -carouselIndex * slotWidth;

  if (cancelCarouselSpring) cancelCarouselSpring();
  if (immediate) {
    carouselOffsetPx = target;
    carouselTrackEl.style.transform = `translateX(${target}px)`;
  } else {
    cancelCarouselSpring = spring({
      from: carouselOffsetPx,
      to: target,
      ...SPRING_PRESETS.ui,
      onUpdate: (v) => {
        carouselOffsetPx = v;
        carouselTrackEl.style.transform = `translateX(${v}px)`;
      },
    });
  }
  updateCarouselNav();
}

function updateCarouselNav() {
  const nav = el.revealRow.querySelector(".reveal-carousel-nav");
  if (!nav) return;
  nav.querySelector(".reveal-carousel-counter").textContent = `${carouselIndex + 1} / ${carouselSlotCount}`;
  nav.querySelector(".reveal-carousel-prev").disabled = carouselIndex === 0;
  nav.querySelector(".reveal-carousel-next").disabled = carouselIndex === carouselSlotCount - 1;
}

function onCarouselPointerDown(e) {
  dragPointerId = e.pointerId;
  dragStartX = e.clientX;
  lastPointerX = e.clientX;
  dragStartOffsetPx = carouselOffsetPx;
  dragDistancePx = 0;
  if (cancelCarouselSpring) cancelCarouselSpring();
}

function onCarouselPointerMove(e) {
  if (dragPointerId === null || e.pointerId !== dragPointerId) return;
  lastPointerX = e.clientX;
  const delta = e.clientX - dragStartX;
  dragDistancePx = Math.abs(delta);
  // Claim pointer capture only once real horizontal intent is established, not on every tap -
  // otherwise a plain tap-to-flip would get its pointerup/click retargeted to the track instead
  // of the card underneath, breaking both the flip and holo-tilt's own pointer handling.
  if (dragDistancePx > TAP_VS_DRAG_PX && !carouselTrackEl.hasPointerCapture(e.pointerId)) {
    carouselTrackEl.setPointerCapture(e.pointerId);
  }
  carouselOffsetPx = dragStartOffsetPx + delta;
  carouselTrackEl.style.transform = `translateX(${carouselOffsetPx}px)`;
}

function onCarouselPointerUp(e) {
  if (dragPointerId === null || e.pointerId !== dragPointerId) return;
  if (carouselTrackEl.hasPointerCapture(e.pointerId)) {
    carouselTrackEl.releasePointerCapture(e.pointerId);
  }
  // Use the last tracked pointermove position rather than this event's own clientX - once pointer
  // capture is engaged, some browsers don't reliably populate clientX on the pointerup event itself.
  const delta = lastPointerX - dragStartX;
  let targetIndex = carouselIndex;
  if (delta <= -SWIPE_ADVANCE_PX) targetIndex = carouselIndex + 1;
  else if (delta >= SWIPE_ADVANCE_PX) targetIndex = carouselIndex - 1;
  dragPointerId = null;
  goToCarouselIndex(targetIndex);
}

function flipSlot(slot) {
  if (slot.classList.contains("flipped")) return;
  slot.classList.add("flipped");
  revealedCount += 1;

  const card = catalog.cardsById.get(slot.dataset.cardId);
  const rarity = slot.dataset.rarity;
  const flipEl = slot.querySelector(".reveal-flip");
  const preset = SPRING_PRESETS[rarity] || SPRING_PRESETS.common;
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

  if (rarity === "rare") {
    triggerHaptic([20, 30, 40]);
    playChime();
    burstConfetti({ particleCount: 60, spread: 55, origin, colors: [getThemeColor("--rarity-rare"), "#ffffff"] });
  } else if (rarity === "legendary") {
    triggerHaptic([30, 40, 30, 40, 60]);
    playFanfare();
    triggerVignette();
    showLegendarySpotlight(card, rarity);
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
  el.revealRow.classList.remove("carousel-mode");
  el.revealActions.style.display = "none";
  el.packSummary.style.display = "none";
  el.packStack.style.display = "";
  el.openHint.style.display = "";
  revealedCount = 0;
  if (cancelPackScaleSpring) cancelPackScaleSpring();
  if (cancelPackLiftSpring) cancelPackLiftSpring();
  packScale = 1;
  packLift = 0;
  applyPackTransform();
  updateAllowanceDisplay();

  if (cancelCarouselSpring) cancelCarouselSpring();
  cancelCarouselSpring = null;
  carouselTrackEl = null;
  carouselIndex = 0;
  carouselSlotCount = 0;
  carouselOffsetPx = 0;
  dragPointerId = null;
  lastPointerX = 0;
  dragDistancePx = 0;
  currentPulls = null;
  lastRevealIsMobile = null;
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

function showLegendarySpotlight(card, rarity) {
  el.legendarySpotlight.innerHTML = renderCardFace(card, rarity);
  refreshIcons();
  el.legendarySpotlight.classList.add("open");
  lockScroll();
  legendaryFireworks();
  setTimeout(() => {
    el.legendarySpotlight.classList.remove("open");
    el.legendarySpotlight.innerHTML = "";
    unlockScroll();
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
    const isCharacters = set.id === "characters";
    let cards = catalog.bySet[set.id];
    if (isCharacters && collectionSort !== "default") {
      const order = collectionSort === "class" ? CHARACTER_CLASS_ORDER : CHARACTER_BOND_ORDER;
      const key = collectionSort === "class" ? characterClass : (c) => c.bond;
      cards = [...cards].sort((a, b) => order.indexOf(key(a)) - order.indexOf(key(b)));
    }
    const ownedCount = cards.filter((c) => isOwned(collection[c.id])).length;

    const rarityBreakdownHtml = catalog.config.rarities
      .map((rarity) => {
        const owned = cards.filter((c) => rarityCount(collection[c.id], rarity.id) > 0).length;
        return `<span class="set-rarity-count" data-rarity="${rarity.id}">${rarity.label} ${owned}/${cards.length}</span>`;
      })
      .join("");

    const sortCtasHtml = isCharacters
      ? `
      <div class="set-sort-ctas">
        <button type="button" class="set-sort-cta${collectionSort === "default" ? " active" : ""}" data-sort="default">Default</button>
        <button type="button" class="set-sort-cta${collectionSort === "class" ? " active" : ""}" data-sort="class">Class</button>
        <button type="button" class="set-sort-cta${collectionSort === "affinity" ? " active" : ""}" data-sort="affinity">Affinity</button>
      </div>
    `
      : "";

    const section = document.createElement("details");
    section.className = "set-section";
    section.style.setProperty("--section-accent", `var(${set.accentVar})`);
    section.open = !collapsedSets.has(set.id);
    section.innerHTML = `
      <summary class="set-section-title">
        <span class="set-swatch" style="background:var(${set.accentVar})"></span>
        ${set.label}s
        <span class="set-section-count">${ownedCount} / ${cards.length} discovered</span>
        <span class="set-rarity-breakdown">${rarityBreakdownHtml}</span>
        ${sortCtasHtml}
      </summary>
      <div class="card-wrap"></div>
    `;
    section.addEventListener("toggle", () => {
      if (section.open) {
        collapsedSets.delete(set.id);
      } else {
        collapsedSets.add(set.id);
      }
    });

    if (isCharacters) {
      section.querySelectorAll(".set-sort-cta").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          if (btn.dataset.sort === collectionSort) return;
          collectionSort = btn.dataset.sort;
          renderCollection();
        });
      });
    }

    const wrap = section.querySelector(".card-wrap");
    for (const card of cards) {
      const entry = collection[card.id];
      const count = totalOwned(entry);
      const slot = document.createElement("div");
      slot.className = "card-slot";
      if (count > 0) {
        const rarityTiers = catalog.config.rarities.map((r) => r.id).filter((r) => rarityCount(entry, r) > 0);
        let activeRarity = rarityTiers[Math.floor(Math.random() * rarityTiers.length)];
        let variants = FOIL_ORDER.filter((v) => rarityVariants(entry, activeRarity).includes(v));
        let activeVariant = variants[Math.floor(Math.random() * variants.length)];

        const holder = document.createElement("div");
        holder.innerHTML = renderCardFace(card, activeRarity);
        const cardEl = holder.firstElementChild;
        cardEl.classList.add("clickable");
        cardEl.addEventListener("click", (e) => openCardModal(card, e.currentTarget, activeVariant, activeRarity));
        wireHoloTilt(cardEl, activeVariant);
        slot.appendChild(cardEl);

        const panel = document.createElement("div");
        panel.className = "card-owned-panel";
        slot.appendChild(panel);

        const caption = document.createElement("span");
        caption.className = "card-owned-count";
        caption.textContent = `Owned ×${count}`;
        panel.appendChild(caption);

        // One pill per owned rarity tier, mirrors the foil-pill row below - click to preview that
        // tier's badge/glow. Single-tier cards still get one (inert) pill for display consistency.
        const rarityCtas = document.createElement("div");
        rarityCtas.className = "card-rarity-ctas";
        const rarityButtons = rarityTiers.map((rarity) => {
          const cta = document.createElement("button");
          cta.type = "button";
          cta.className = "card-rarity-cta";
          cta.dataset.rarity = rarity;
          cta.textContent = `${RARITY_LABEL[rarity]} ×${rarityCount(entry, rarity)}`;
          cta.classList.toggle("active", rarity === activeRarity);
          cta.disabled = rarityTiers.length === 1;
          cta.addEventListener("click", (e) => {
            e.stopPropagation();
            if (rarity === activeRarity) return;
            activeRarity = rarity;
            cardEl.dataset.rarity = rarity;
            cardEl.querySelector(".rarity-badge").textContent = rarity;
            rarityButtons.forEach((btn) => btn.classList.toggle("active", btn === cta));

            // Owned foils depend on which rarity tier is active - rebuild that row to match.
            variants = FOIL_ORDER.filter((v) => rarityVariants(entry, activeRarity).includes(v));
            activeVariant = variants[0];
            if (activeVariant !== "none") {
              cardEl.dataset.foil = activeVariant;
            } else {
              delete cardEl.dataset.foil;
            }
            rebuildFoilCtas();
          });
          rarityCtas.appendChild(cta);
          return cta;
        });
        panel.appendChild(rarityCtas);

        // One pill per owned variant within the active rarity tier, in a fixed foil order -
        // none/single-variant cards still get a pill (just one, inert) so every card consistently
        // shows what it's currently displaying, not just the ones with something to switch between.
        const foilCtas = document.createElement("div");
        foilCtas.className = "card-foil-ctas";
        function rebuildFoilCtas() {
          foilCtas.innerHTML = "";
          variants.forEach((variant) => {
            const cta = document.createElement("button");
            cta.type = "button";
            cta.className = "card-foil-cta";
            cta.textContent = `${FOIL_LABEL[variant] || variant} ×${entry[activeRarity][variant]}`;
            cta.classList.toggle("active", variant === activeVariant);
            cta.disabled = variants.length === 1;
            cta.addEventListener("click", (e) => {
              e.stopPropagation();
              if (variant === activeVariant) return;
              activeVariant = variant;
              if (variant !== "none") {
                cardEl.dataset.foil = variant;
              } else {
                delete cardEl.dataset.foil;
              }
              [...foilCtas.children].forEach((btn) => btn.classList.toggle("active", btn === cta));
            });
            foilCtas.appendChild(cta);
          });
        }
        rebuildFoilCtas();
        panel.appendChild(foilCtas);
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

function renderCardFace(card, rarity) {
  return renderCardFaceShared(card, setById, rarity);
}

function renderLockedFace(card) {
  return renderLockedFaceShared(card, setById);
}
