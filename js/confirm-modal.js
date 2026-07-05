const el = {};
let resolvePromise = null;

function ensureWired() {
  if (el.overlay) return;
  el.overlay = document.getElementById("confirm-modal");
  el.message = document.getElementById("confirm-modal-message");
  el.input = document.getElementById("confirm-modal-input");
  el.cancelBtn = document.getElementById("confirm-modal-cancel");
  el.confirmBtn = document.getElementById("confirm-modal-confirm");

  el.overlay.addEventListener("click", (e) => {
    if (e.target === el.overlay) settle(false);
  });
  el.cancelBtn.addEventListener("click", () => settle(false));
  el.confirmBtn.addEventListener("click", () => settle(true));
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") settle(true);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.overlay.classList.contains("open")) settle(false);
  });
}

function settle(result) {
  el.overlay.classList.remove("open");
  if (resolvePromise) {
    const resolve = resolvePromise;
    resolvePromise = null;
    resolve(result);
  }
}

export function confirmAction({ message, confirmLabel = "Confirm", cancelLabel = "Cancel" }) {
  ensureWired();
  el.message.textContent = message;
  el.confirmBtn.textContent = confirmLabel;
  el.cancelBtn.textContent = cancelLabel;
  el.input.style.display = "none";
  el.overlay.classList.add("open");
  el.confirmBtn.focus({ preventScroll: true });
  return new Promise((resolve) => {
    resolvePromise = resolve;
  });
}

/** Same modal shell, but with a text input - a stand-in for native prompt(). */
export function promptAction({ message, confirmLabel = "Save", cancelLabel = "Cancel", defaultValue = "" }) {
  ensureWired();
  el.message.textContent = message;
  el.confirmBtn.textContent = confirmLabel;
  el.cancelBtn.textContent = cancelLabel;
  el.input.style.display = "block";
  el.input.value = defaultValue;
  el.overlay.classList.add("open");
  el.input.focus({ preventScroll: true });
  el.input.select();
  return new Promise((resolve) => {
    resolvePromise = (ok) => resolve(ok ? el.input.value.trim() : null);
  });
}
