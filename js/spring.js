const MAX_STEP_MS = 1000 / 30;
const REST_VELOCITY = 0.01;
const REST_DISTANCE = 0.01;

/**
 * Runs a damped-spring simulation from `from` to `to`, calling onUpdate every
 * frame with the current value. Returns a function that cancels the spring.
 *
 * stiffness/damping/mass follow the standard mass-spring-damper model, not a
 * fixed-duration easing curve - the timing and any overshoot fall out of the
 * physics rather than being hand-authored per case.
 */
export function spring({ from, to, stiffness = 210, damping = 24, mass = 1, onUpdate, onComplete }) {
  let value = from;
  let velocity = 0;
  let rafId = null;
  let lastTime = null;
  let cancelled = false;

  function step(now) {
    if (cancelled) return;
    if (lastTime === null) lastTime = now;
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    dt = Math.min(dt, MAX_STEP_MS / 1000);

    const springForce = -stiffness * (value - to);
    const dampingForce = -damping * velocity;
    const acceleration = (springForce + dampingForce) / mass;
    velocity += acceleration * dt;
    value += velocity * dt;

    const settled = Math.abs(to - value) < REST_DISTANCE && Math.abs(velocity) < REST_VELOCITY;
    if (settled) {
      value = to;
      onUpdate(value);
      onComplete && onComplete();
      return;
    }

    onUpdate(value);
    rafId = requestAnimationFrame(step);
  }

  rafId = requestAnimationFrame(step);

  return () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
  };
}

export const SPRING_PRESETS = {
  common: { stiffness: 220, damping: 24 },
  uncommon: { stiffness: 200, damping: 22 },
  rare: { stiffness: 170, damping: 19 },
  legendary: { stiffness: 140, damping: 15 },
  ui: { stiffness: 260, damping: 22 },
};
