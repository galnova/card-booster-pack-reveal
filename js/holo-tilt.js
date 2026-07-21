const REST = { tiltX: "0deg", tiltY: "0deg", pointerX: "50%", pointerY: "50%", bgX: "50%", bgY: "50%", opacity: "0" };
const TILT_MAX = 16;
// How far the shine's background-position is allowed to pan, as a percentage
// band centered on 50%. Kept narrow (raw pointer position is 4%-96%) so the
// shine's visible window never drifts past the gradient's vivid color band -
// a full-range pan there is what let the color wash out to near-nothing near
// the corners.
const BG_PAN = 20;

function setVars(el, v) {
  el.style.setProperty("--tilt-x", v.tiltX);
  el.style.setProperty("--tilt-y", v.tiltY);
  el.style.setProperty("--pointer-x", v.pointerX);
  el.style.setProperty("--pointer-y", v.pointerY);
  el.style.setProperty("--bg-x", v.bgX);
  el.style.setProperty("--bg-y", v.bgY);
  el.style.setProperty("--holo-opacity", v.opacity);
}

// Which foil variants (see the [data-foil] rules in style.css) a rarity can
// roll. Every card's variant is picked once, deterministically, from a hash
// of its own id - so it's the same every time you see that card, not a
// different random look on every render.
const FOIL_OPTIONS = {
  common: ["none", "none", "none", "reverse"],
  uncommon: ["none", "none", "reverse", "reverse"],
  rare: ["holo", "cosmos", "none"],
  legendary: ["secret", "secret", "super-holo", "none"],
};

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function assignFoil(cardEl) {
  const options = FOIL_OPTIONS[cardEl.dataset.rarity];
  if (!options) return;
  const variant = options[hashString(cardEl.dataset.id || "") % options.length];
  if (variant !== "none") {
    cardEl.dataset.foil = variant;
  }
}

/**
 * Wires the pointer-tracking 3D tilt + rainbow shine + glare effect (adapted
 * from simeydotme/pokemon-cards-css) onto a rendered .card element. Safe to
 * call on any .card - it's purely event-driven (no idle animation cost).
 *
 * The CSS vars are written on cardEl's PARENT, not cardEl itself, and read
 * back down via inheritance. That's so a rarity glow ring living on that
 * same parent (the "Magic Card glow" rules, card-modal-front) can read
 * --tilt-x/y too and tilt in sync with the card - otherwise the ring sat
 * flat while the card underneath it visibly tilted.
 */
export function wireHoloTilt(cardEl) {
  cardEl.classList.add("holo-card");
  assignFoil(cardEl);
  let rafId = null;
  let pending = null;

  // Resolved fresh on every call (not captured once at wire-time): some
  // callers wire the card before it's moved into its final parent (e.g. the
  // Collection view builds the card in a detached holder div, then appends
  // it to .card-slot afterward), so capturing parentElement up front would
  // silently point at the wrong - or a since-discarded - element.
  const varsHost = () => cardEl.parentElement || cardEl;

  const setInteracting = (on) => {
    cardEl.classList.toggle("holo-interacting", on);
    varsHost().classList.toggle("holo-interacting", on);
  };

  cardEl.addEventListener("pointermove", (e) => {
    const rect = cardEl.getBoundingClientRect();
    // Clamped to 4-96, not 0-100: the literal edge values triggered a
    // rendering seam in the glare's gradient at extreme corners.
    const px = Math.max(4, Math.min(96, ((e.clientX - rect.left) / rect.width) * 100));
    const py = Math.max(4, Math.min(96, ((e.clientY - rect.top) / rect.height) * 100));
    const bgX = 50 + ((px - 50) / 50) * BG_PAN;
    const bgY = 50 + ((py - 50) / 50) * BG_PAN;
    pending = {
      tiltY: `${(((px - 50) / 50) * TILT_MAX).toFixed(2)}deg`,
      tiltX: `${((-(py - 50) / 50) * TILT_MAX).toFixed(2)}deg`,
      pointerX: `${px.toFixed(2)}%`,
      pointerY: `${py.toFixed(2)}%`,
      bgX: `${bgX.toFixed(2)}%`,
      bgY: `${bgY.toFixed(2)}%`,
      opacity: "1",
    };
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        setInteracting(true);
        setVars(varsHost(), pending);
        pending = null;
        rafId = null;
      });
    }
  });

  cardEl.addEventListener("pointerleave", () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pending = null;
    setInteracting(false);
    setVars(varsHost(), REST);
  });
}
