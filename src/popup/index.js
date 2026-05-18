/**
 * Modal popup host for plugins. Call showPopup() with a render callback that
 * fills (or returns) content; closePopup() or Escape dismisses.
 */

/** @type {HTMLElement | null} */
let root = null;
/** @type {HTMLElement | null} */
let titleEl = null;
/** @type {HTMLElement | null} */
let headerEl = null;
/** @type {HTMLElement | null} */
let bodyEl = null;
/** @type {HTMLElement | null} */
let dialogEl = null;
/** @type {HTMLButtonElement | null} */
let closeBtn = null;

let open = false;
/** @type {(() => void) | null} */
let cleanup = null;
/** @type {(() => void) | null} */
let onCloseCallback = null;
let dismissible = true;

function ensureHost() {
  if (root) return;

  root = document.createElement("div");
  root.id = "plugin-popup";
  root.className = "plugin-popup";
  root.hidden = true;

  const backdrop = document.createElement("div");
  backdrop.className = "plugin-popup-backdrop";

  dialogEl = document.createElement("div");
  dialogEl.className = "plugin-popup-dialog";
  dialogEl.setAttribute("role", "dialog");
  dialogEl.setAttribute("aria-modal", "true");

  headerEl = document.createElement("header");
  headerEl.className = "plugin-popup-header";

  titleEl = document.createElement("h2");
  titleEl.className = "plugin-popup-title";

  closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "plugin-popup-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";

  headerEl.append(titleEl, closeBtn);

  bodyEl = document.createElement("div");
  bodyEl.className = "plugin-popup-body";

  dialogEl.append(headerEl, bodyEl);
  root.append(backdrop, dialogEl);
  document.body.append(root);

  backdrop.addEventListener("click", () => {
    if (dismissible) closePopup();
  });

  closeBtn.addEventListener("click", () => closePopup());

  dialogEl.addEventListener("click", (ev) => ev.stopPropagation());

  // Scroll popup body with the wheel (xterm/v86 capture wheel on the page otherwise).
  dialogEl.addEventListener(
    "wheel",
    (ev) => {
      if (!open || !bodyEl) return;
      if (bodyEl.scrollHeight <= bodyEl.clientHeight) return;
      bodyEl.scrollTop += ev.deltaY;
      ev.preventDefault();
      ev.stopPropagation();
    },
    { passive: false },
  );

  root.addEventListener(
    "wheel",
    (ev) => {
      if (!open) return;
      ev.stopPropagation();
    },
    { capture: true },
  );

  document.addEventListener("keydown", onDocumentKeydown);
}

/**
 * @param {KeyboardEvent} ev
 */
function onDocumentKeydown(ev) {
  if (ev.key === "Escape" && open && dismissible) {
    ev.preventDefault();
    closePopup();
  }
}

/**
 * @typedef {object} ShowPopupOptions
 * @property {string} [title]
 * @property {(container: HTMLElement) => (void | HTMLElement | (() => void))} render
 * @property {() => void} [onClose]
 * @property {boolean} [dismissible]
 */

/** @returns {boolean} */
export function isPopupOpen() {
  return open;
}

export function closePopup() {
  if (!open) return;
  open = false;

  cleanup?.();
  cleanup = null;

  const cb = onCloseCallback;
  onCloseCallback = null;

  bodyEl?.replaceChildren();
  if (root?.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  root?.setAttribute("aria-hidden", "true");
  root && (root.hidden = true);
  document.body.classList.remove("plugin-popup-open");

  cb?.();
}

/**
 * @param {ShowPopupOptions} options
 */
export function showPopup({ title, render, onClose, dismissible: canDismiss = true }) {
  ensureHost();
  if (!root || !titleEl || !headerEl || !bodyEl || !closeBtn) return;

  if (open) closePopup();

  dismissible = canDismiss;
  onCloseCallback = onClose ?? null;
  open = true;

  if (title) {
    titleEl.textContent = title;
    titleEl.hidden = false;
    headerEl.hidden = false;
  } else {
    titleEl.textContent = "";
    titleEl.hidden = true;
    headerEl.hidden = false;
  }

  closeBtn.disabled = !canDismiss;
  closeBtn.hidden = !canDismiss;

  bodyEl.replaceChildren();
  const result = render(bodyEl);
  if (result instanceof HTMLElement) {
    bodyEl.append(result);
  } else if (typeof result === "function") {
    cleanup = result;
  }

  root.hidden = false;
  root.setAttribute("aria-hidden", "false");
  if (title) {
    root.setAttribute("aria-labelledby", "plugin-popup-title");
    titleEl.id = "plugin-popup-title";
  } else {
    root.removeAttribute("aria-labelledby");
    titleEl.removeAttribute("id");
  }
  document.body.classList.add("plugin-popup-open");
  bodyEl.tabIndex = -1;
  bodyEl.focus({ preventScroll: true });
}
