const REST = { tiltX: "0deg", tiltY: "0deg", pointerX: "50%", pointerY: "50%", opacity: "0" };
const TILT_MAX = 16;

function setVars(el, v) {
  el.style.setProperty("--tilt-x", v.tiltX);
  el.style.setProperty("--tilt-y", v.tiltY);
  el.style.setProperty("--pointer-x", v.pointerX);
  el.style.setProperty("--pointer-y", v.pointerY);
  el.style.setProperty("--holo-opacity", v.opacity);
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
    const px = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const py = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    pending = {
      tiltY: `${(((px - 50) / 50) * TILT_MAX).toFixed(2)}deg`,
      tiltX: `${((-(py - 50) / 50) * TILT_MAX).toFixed(2)}deg`,
      pointerX: `${px.toFixed(2)}%`,
      pointerY: `${py.toFixed(2)}%`,
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
