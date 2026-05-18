/** @typedef {'action' | 'checkbox' | 'submenu' | 'separator'} MenuItemType */

/**
 * @typedef {object} MenuAction
 * @property {'action'} type
 * @property {string} label
 * @property {() => void} onClick
 * @property {() => boolean} [disabled]
 */

/**
 * @typedef {object} MenuCheckbox
 * @property {'checkbox'} type
 * @property {string} label
 * @property {() => boolean} getChecked
 * @property {(checked: boolean) => void} onChange
 * @property {() => boolean} [disabled]
 */

/**
 * @typedef {object} MenuSubmenu
 * @property {'submenu'} type
 * @property {string} label
 * @property {MenuItem[] | (() => MenuItem[])} children
 * @property {() => boolean} [disabled]
 */

/**
 * @typedef {object} MenuSeparator
 * @property {'separator'} type
 */

/** @typedef {MenuAction | MenuCheckbox | MenuSubmenu | MenuSeparator} MenuItem */

/** @type {{ id: string, label: string, getItems: () => MenuItem[] }[]} */
const pluginMenus = [];

/**
 * @param {string} id
 * @param {string} label
 * @param {() => MenuItem[]} getItems
 */
export function registerPluginMenu(id, label, getItems) {
  if (pluginMenus.some((p) => p.id === id)) {
    throw new Error(`Plugin menu already registered: ${id}`);
  }
  pluginMenus.push({ id, label, getItems });
}

/** @returns {MenuItem[]} */
export function getPluginMenuItems() {
  if (pluginMenus.length === 0) return [];
  return [
    { type: "separator" },
    {
      type: "submenu",
      label: "Plugins",
      children: () =>
        pluginMenus.map((plugin) => ({
          type: "submenu",
          label: plugin.label,
          children: plugin.getItems,
        })),
    },
  ];
}

/**
 * @param {MenuItem[] | (() => MenuItem[])} items
 * @returns {MenuItem[]}
 */
function resolveItems(items) {
  return typeof items === "function" ? items() : items;
}

/**
 * Place flyout to the left or right of its parent row so it stays in the viewport.
 * @param {HTMLElement} wrap
 * @param {HTMLElement} flyout
 */
function positionFlyout(wrap, flyout) {
  flyout.classList.remove("menu-flyout-left", "menu-flyout-right");
  flyout.style.top = "";
  flyout.style.bottom = "";

  flyout.classList.add("menu-flyout-left");
  let rect = flyout.getBoundingClientRect();
  if (rect.left < 4) {
    flyout.classList.remove("menu-flyout-left");
    flyout.classList.add("menu-flyout-right");
    rect = flyout.getBoundingClientRect();
  }
  if (rect.right > window.innerWidth - 4) {
    flyout.classList.remove("menu-flyout-right");
    flyout.classList.add("menu-flyout-left");
    rect = flyout.getBoundingClientRect();
  }

  const wrapRect = wrap.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 4) {
    flyout.style.top = "auto";
    flyout.style.bottom = "0";
    rect = flyout.getBoundingClientRect();
    if (rect.top < 4) {
      flyout.style.bottom = "";
      flyout.style.top = `${Math.max(0, window.innerHeight - 4 - rect.height - wrapRect.top)}px`;
    }
  }

  wrap.classList.toggle(
    "menu-submenu-opens-right",
    flyout.classList.contains("menu-flyout-right"),
  );
}

/**
 * @param {HTMLElement} containerEl
 * @param {{ getItems: () => MenuItem[], label?: string }} options
 */
export function createMenuButton(containerEl, { getItems, label = "Menu" }) {
  const root = document.createElement("div");
  root.className = "menu";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "menu-trigger";
  trigger.textContent = label;
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = "menu-panel";
  panel.hidden = true;
  panel.setAttribute("role", "menu");

  root.append(trigger, panel);
  containerEl.append(root);

  let open = false;

  function setOpen(next) {
    open = next;
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      renderPanel();
    } else {
      panel.replaceChildren();
    }
  }

  function close() {
    setOpen(false);
  }

  function isDisabled(item) {
    return item.disabled?.() ?? false;
  }

  /**
   * @param {HTMLElement} parentEl
   * @param {MenuItem[]} items
   */
  function renderItems(parentEl, items) {
    for (const item of items) {
      if (item.type === "separator") {
        const sep = document.createElement("div");
        sep.className = "menu-separator";
        sep.setAttribute("role", "separator");
        parentEl.append(sep);
        continue;
      }

      if (item.type === "action") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "menu-item";
        btn.setAttribute("role", "menuitem");
        btn.textContent = item.label;
        const disabled = isDisabled(item);
        btn.disabled = disabled;
        if (disabled) btn.classList.add("menu-item-disabled");
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          close();
          item.onClick();
        });
        parentEl.append(btn);
        continue;
      }

      if (item.type === "checkbox") {
        const labelEl = document.createElement("label");
        labelEl.className = "menu-item menu-item-checkbox";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = item.getChecked();
        const disabled = isDisabled(item);
        input.disabled = disabled;
        if (disabled) labelEl.classList.add("menu-item-disabled");
        const span = document.createElement("span");
        span.textContent = item.label;
        labelEl.append(input, span);
        input.addEventListener("change", () => {
          item.onChange(input.checked);
        });
        parentEl.append(labelEl);
        continue;
      }

      if (item.type === "submenu") {
        const wrap = document.createElement("div");
        wrap.className = "menu-submenu";

        const row = document.createElement("button");
        row.type = "button";
        row.className = "menu-item menu-item-has-submenu";
        row.setAttribute("role", "menuitem");
        row.setAttribute("aria-haspopup", "true");
        row.setAttribute("aria-expanded", "false");
        const arrow = document.createElement("span");
        arrow.className = "menu-submenu-arrow";
        arrow.setAttribute("aria-hidden", "true");
        const labelSpan = document.createElement("span");
        labelSpan.className = "menu-submenu-label";
        labelSpan.textContent = item.label;
        row.append(arrow, labelSpan);

        const disabled = isDisabled(item);
        row.disabled = disabled;
        if (disabled) row.classList.add("menu-item-disabled");

        const flyout = document.createElement("div");
        flyout.className = "menu-flyout";
        flyout.setAttribute("role", "menu");
        flyout.hidden = true;

        const closeSiblingFlyouts = () => {
          for (const sibling of parentEl.querySelectorAll(":scope > .menu-submenu")) {
            if (sibling === wrap) continue;
            const other = sibling.querySelector(":scope > .menu-flyout");
            if (!other || other.hidden) continue;
            other.hidden = true;
            other.replaceChildren();
            const otherRow = sibling.querySelector(":scope > .menu-item-has-submenu");
            otherRow?.setAttribute("aria-expanded", "false");
          }
        };

        const showFlyout = () => {
          if (row.disabled) return;
          closeSiblingFlyouts();
          flyout.hidden = false;
          row.setAttribute("aria-expanded", "true");
          renderItems(flyout, resolveItems(item.children));
          positionFlyout(wrap, flyout);
        };
        const hideFlyout = () => {
          flyout.hidden = true;
          flyout.replaceChildren();
          row.setAttribute("aria-expanded", "false");
        };

        row.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (row.disabled) return;
          if (flyout.hidden) showFlyout();
          else hideFlyout();
        });

        wrap.append(row, flyout);
        parentEl.append(wrap);
      }
    }
  }

  function renderPanel() {
    panel.replaceChildren();
    const items = [...resolveItems(getItems), ...getPluginMenuItems()];
    renderItems(panel, items);
  }

  trigger.addEventListener("click", (ev) => {
    ev.stopPropagation();
    setOpen(!open);
  });

  panel.addEventListener("click", (ev) => {
    ev.stopPropagation();
  });

  document.addEventListener("click", () => close());
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });

  return { close, setHidden: (hidden) => { root.hidden = hidden; } };
}
