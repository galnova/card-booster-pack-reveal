import { spring, SPRING_PRESETS } from "./spring.js";
import { pickDeterministicFoil } from "./foil-config.js";

const REST_NUM = { tiltX: 0, tiltY: 0, pointerX: 50, pointerY: 50, bgX: 50, bgY: 50, opacity: 0 };
const TILT_MAX = 16;
// Narrow pan band (not full 0-100) so the shine never drifts past the gradient's vivid color band.
const BG_PAN = 20;

function setVars(el, v) {
  el.style.setProperty("--tilt-x", `${v.tiltX.toFixed(2)}deg`);
  el.style.setProperty("--tilt-y", `${v.tiltY.toFixed(2)}deg`);
  el.style.setProperty("--pointer-x", `${v.pointerX.toFixed(2)}%`);
  el.style.setProperty("--pointer-y", `${v.pointerY.toFixed(2)}%`);
  el.style.setProperty("--bg-x", `${v.bgX.toFixed(2)}%`);
  el.style.setProperty("--bg-y", `${v.bgY.toFixed(2)}%`);
  el.style.setProperty("--holo-opacity", v.opacity.toFixed(3));
}

/** Wires the pointer-tracking 3D tilt + rainbow shine + glare onto a .card element (adapted from
 * simeydotme/pokemon-cards-css). CSS vars are written on the PARENT, not cardEl, so a rarity glow
 * ring sharing that parent tilts in sync instead of sitting flat under the tilting card.
 * Pass `variant` when the caller already knows the card's actual owned/pulled foil (skips the
 * deterministic id-hash guess used for locked previews and other ownership-less contexts). */
export function wireHoloTilt(cardEl, variant) {
  cardEl.classList.add("holo-card");
  const resolved = variant !== undefined ? variant : pickDeterministicFoil({ id: cardEl.dataset.id, rarity: cardEl.dataset.rarity });
  if (resolved && resolved !== "none") {
    cardEl.dataset.foil = resolved;
  } else {
    delete cardEl.dataset.foil;
  }
  let rafId = null;
  let pending = null;
  let current = { ...REST_NUM };
  let releaseCancels = [];

  // Resolved fresh each call, not captured once: some callers wire the card before it's moved into its final parent.
  const varsHost = () => cardEl.parentElement || cardEl;

  const setInteracting = (on) => {
    cardEl.classList.toggle("holo-interacting", on);
    varsHost().classList.toggle("holo-interacting", on);
  };

  const cancelRelease = () => {
    releaseCancels.forEach((cancel) => cancel());
    releaseCancels = [];
  };

  cardEl.addEventListener("pointermove", (e) => {
    cancelRelease();
    const rect = cardEl.getBoundingClientRect();
    // Clamped to 4-96, not 0-100: the literal edge values seamed the glare's gradient at corners.
    const px = Math.max(4, Math.min(96, ((e.clientX - rect.left) / rect.width) * 100));
    const py = Math.max(4, Math.min(96, ((e.clientY - rect.top) / rect.height) * 100));
    const bgX = 50 + ((px - 50) / 50) * BG_PAN;
    const bgY = 50 + ((py - 50) / 50) * BG_PAN;
    pending = {
      tiltY: ((px - 50) / 50) * TILT_MAX,
      tiltX: (-(py - 50) / 50) * TILT_MAX,
      pointerX: px,
      pointerY: py,
      bgX,
      bgY,
      opacity: 1,
    };
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        setInteracting(true);
        current = pending;
        setVars(varsHost(), current);
        pending = null;
        rafId = null;
      });
    }
  });

  const release = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pending = null;
    cancelRelease();

    // Springy settle (physical wobble) instead of a flat ease-out; stays "interacting" throughout so
    // the CSS transition doesn't also try to interpolate on top of the spring's own per-frame writes.
    let settled = 0;
    const total = Object.keys(REST_NUM).length;
    releaseCancels = Object.keys(REST_NUM).map((key) =>
      spring({
        from: current[key],
        to: REST_NUM[key],
        ...SPRING_PRESETS.holoRelease,
        onUpdate: (v) => {
          current[key] = v;
          setVars(varsHost(), current);
        },
        onComplete: () => {
          settled += 1;
          if (settled === total) setInteracting(false);
        },
      })
    );
  };

  cardEl.addEventListener("pointerleave", release);
  // Touch rarely fires pointerleave on release - without these the tilt would freeze at its last position.
  cardEl.addEventListener("pointerup", release);
  cardEl.addEventListener("pointercancel", release);
}
