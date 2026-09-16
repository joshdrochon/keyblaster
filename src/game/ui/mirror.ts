/**
 * The accessibility / test mirror.
 *
 * Phaser draws to a canvas, so a menu has no DOM: a screen reader sees nothing
 * and Playwright can assert nothing. Both problems have the same fix, and it is
 * not a test hook bolted on the side - it is an off-screen DOM shadow of what
 * the canvas is showing, published every time the UI changes.
 *
 * WHAT IT BUYS
 *  - AC-18.2: "no email field exists anywhere" is checkable as a DOM assertion,
 *    which is exactly how the PRD declares that test.
 *  - AC-18.1: "every screen reachable and returnable by keyboard alone, with a
 *    visible focus state" becomes an assertion about `data-focused` and
 *    `data-focus-ring` rather than a screenshot a human has to eyeball.
 *  - Real assistive-tech output for a keyboard-only game (D37).
 *
 * WHAT IT IS NOT: interactive. Every node is `tabindex="-1"` and nothing here
 * takes focus. Phaser owns the keyboard; a DOM focus ring competing with the
 * canvas one is worse than no DOM at all.
 */

export type MirrorRole =
  | "button"
  | "toggle"
  | "slider"
  | "option"
  | "listitem"
  | "field"
  | "text";

export interface MirrorItem {
  readonly id: string;
  readonly role: MirrorRole;
  readonly label: string;
  /** Current value for a toggle/slider/option control. */
  readonly value?: string;
  /** Secondary line: "furthest beacon: mars", "unlocks after 3 beacons". */
  readonly detail?: string;
  /** Visible but not choosable (a locked skin, a stop with no beacon). */
  readonly locked?: boolean;
  readonly focused?: boolean;
}

export interface MirrorState {
  /** SCENE_KEYS value, so a test can scope to one screen. */
  readonly scene: string;
  readonly heading: string;
  readonly items: readonly MirrorItem[];
  readonly focusId: string | null;
  /** True when a focus ring is currently DRAWN on the canvas (AC-18.1). */
  readonly focusRing: boolean;
  /** Text of the open in-game confirm, or null. Never a browser dialog. */
  readonly dialog?: string | null;
  /** One calm line, non-blocking (AC-18.4). */
  readonly notice?: string | null;
}

const ROOT_ID = "kb-ui";

/**
 * Off-screen, not `display:none`: a hidden subtree is removed from the
 * accessibility tree, which would defeat half the point of this file.
 */
const ROOT_STYLE =
  "position:absolute;width:1px;height:1px;margin:-1px;padding:0;" +
  "overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;";

function root(): HTMLElement {
  const existing = document.getElementById(ROOT_ID);
  if (existing) return existing;
  const el = document.createElement("div");
  el.id = ROOT_ID;
  el.setAttribute("data-testid", "ui-mirror");
  el.setAttribute("style", ROOT_STYLE);
  document.body.appendChild(el);
  return el;
}

function section(scene: string): HTMLElement {
  const parent = root();
  const found = parent.querySelector<HTMLElement>(
    `[data-testid="ui-screen"][data-scene="${scene}"]`,
  );
  if (found) return found;
  const el = document.createElement("section");
  el.setAttribute("data-testid", "ui-screen");
  el.setAttribute("data-scene", scene);
  el.setAttribute("tabindex", "-1");
  parent.appendChild(el);
  return el;
}

function attr(el: HTMLElement, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/** Replace this scene's region with the current state. Idempotent. */
export function publishMirror(state: MirrorState): void {
  if (typeof document === "undefined") return;
  const el = section(state.scene);
  attr(el, "data-focus", state.focusId);
  attr(el, "data-focus-ring", state.focusRing ? "true" : "false");
  attr(el, "data-item-count", String(state.items.length));
  el.setAttribute("aria-label", state.heading);
  el.textContent = "";

  const h = document.createElement("h2");
  h.setAttribute("data-testid", "ui-heading");
  h.textContent = state.heading;
  el.appendChild(h);

  for (const item of state.items) {
    const node = document.createElement("div");
    node.setAttribute("data-testid", "ui-item");
    node.setAttribute("data-id", item.id);
    node.setAttribute("data-role", item.role);
    node.setAttribute("data-focused", item.focused ? "true" : "false");
    node.setAttribute("data-locked", item.locked ? "true" : "false");
    node.setAttribute("tabindex", "-1");
    if (item.value !== undefined) node.setAttribute("data-value", item.value);
    if (item.role !== "text") node.setAttribute("role", ariaRole(item.role));
    if (item.role === "toggle") {
      node.setAttribute("aria-checked", item.value === "on" ? "true" : "false");
    }
    if (item.locked) node.setAttribute("aria-disabled", "true");
    node.textContent = [item.label, item.value, item.detail]
      .filter((s): s is string => s !== undefined && s !== "")
      .join(" — ");
    el.appendChild(node);
  }

  if (state.dialog) {
    const d = document.createElement("div");
    d.setAttribute("data-testid", "ui-dialog");
    d.setAttribute("role", "alertdialog");
    d.textContent = state.dialog;
    el.appendChild(d);
  }

  if (state.notice) {
    const n = document.createElement("p");
    n.setAttribute("data-testid", "ui-notice");
    n.setAttribute("role", "status");
    n.setAttribute("aria-live", "polite");
    n.textContent = state.notice;
    el.appendChild(n);
  }
}

function ariaRole(role: MirrorRole): string {
  switch (role) {
    case "toggle":
      return "switch";
    case "slider":
      return "slider";
    case "option":
      return "combobox";
    case "listitem":
      return "option";
    case "field":
      return "textbox";
    default:
      return "button";
  }
}

/** Drop a scene's region when it shuts down, so overlays do not linger. */
export function clearMirror(scene: string): void {
  if (typeof document === "undefined") return;
  root()
    .querySelector(`[data-testid="ui-screen"][data-scene="${scene}"]`)
    ?.remove();
}

/**
 * The toast region is global: a toast outlives the scene that raised it and may
 * sit over Flight or Results (design brief 13).
 */
export function publishToasts(messages: readonly string[]): void {
  if (typeof document === "undefined") return;
  const parent = root();
  let el = parent.querySelector<HTMLElement>('[data-testid="ui-toasts"]');
  if (!el) {
    el = document.createElement("div");
    el.setAttribute("data-testid", "ui-toasts");
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    parent.appendChild(el);
  }
  el.textContent = "";
  el.setAttribute("data-count", String(messages.length));
  for (const message of messages) {
    const t = document.createElement("div");
    t.setAttribute("data-testid", "ui-toast");
    t.textContent = message;
    el.appendChild(t);
  }
}
