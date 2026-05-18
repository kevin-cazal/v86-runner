import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

const RESIZE_RETRY_MS = 500;
const RESIZE_RETRY_COUNT = 30;
/** Extra px subtracted from host width/height so cols/rows stay inside the canvas at browser zoom. */
const FIT_WIDTH_SLACK_PX = 6;
const FIT_HEIGHT_SLACK_PX = 4;

const DEFAULT_OPTIONS = {
  cursorBlink: true,
  fontFamily: '"IBM Plex Mono", "Liberation Mono", "Noto Sans Mono", monospace',
  fontSize: 14,
  lineHeight: 1.15,
  letterSpacing: 0,
  customGlyphs: true,
  scrollback: 10000,
  theme: {
    background: "#000000",
    foreground: "#c7c7c7",
    cursor: "#50e3c2",
    selectionBackground: "#264f4a",
  },
};

/**
 * @param {HTMLElement} hostElement
 * @param {import("@xterm/xterm").ITerminalOptions} [options]
 */
export function createVmTerminal(hostElement, options = {}) {
  const resizeListeners = new Set();

  let terminal = null;
  let fitAddon = null;
  let resizeObserver = null;
  let resizeRetryTimer = null;
  let resizeRetryRemaining = 0;
  let scheduleFitRaf = 0;
  let disposed = false;

  const onWindowResize = () => scheduleFit();
  const onHostResize = () => scheduleFit();

  function notifyResize() {
    for (const fn of resizeListeners) {
      fn();
    }
  }

  function fit() {
    if (!terminal || !fitAddon || disposed) {
      return;
    }
    const proposed = fitAddon.proposeDimensions();
    if (!proposed) {
      return;
    }
    const core = terminal._core;
    const dims = core._renderService.dimensions;
    if (!dims?.css?.cell?.width || !dims?.css?.cell?.height) {
      fitAddon.fit();
      return;
    }
    const scrollbarWidth =
      terminal.options.scrollback === 0 ? 0 : core.viewport.scrollBarWidth;
    const parent = terminal.element.parentElement;
    const parentStyle = window.getComputedStyle(parent);
    const parentHeight = Number.parseInt(parentStyle.height, 10);
    const parentWidth = Math.max(0, Number.parseInt(parentStyle.width, 10));
    const elementStyle = window.getComputedStyle(terminal.element);
    const padTop = Number.parseInt(elementStyle.paddingTop, 10) || 0;
    const padBottom = Number.parseInt(elementStyle.paddingBottom, 10) || 0;
    const padLeft = Number.parseInt(elementStyle.paddingLeft, 10) || 0;
    const padRight = Number.parseInt(elementStyle.paddingRight, 10) || 0;
    const availableWidth =
      parentWidth -
      padLeft -
      padRight -
      scrollbarWidth -
      FIT_WIDTH_SLACK_PX;
    const availableHeight =
      parentHeight - padTop - padBottom - FIT_HEIGHT_SLACK_PX;
    const cellW = Math.ceil(dims.css.cell.width - 1e-6);
    const cellH = Math.ceil(dims.css.cell.height - 1e-6);
    let cols = Math.max(2, Math.floor(availableWidth / cellW));
    let rows = Math.max(1, Math.floor(availableHeight / cellH));
    const zoom = window.visualViewport?.scale ?? 1;
    if (zoom !== 1 && cols > 2) {
      cols -= 1;
    }
    if (terminal.cols !== cols || terminal.rows !== rows) {
      core._renderService.clear();
      terminal.resize(cols, rows);
    }
  }

  function scheduleFit() {
    if (disposed) {
      return;
    }
    if (scheduleFitRaf) {
      cancelAnimationFrame(scheduleFitRaf);
    }
    scheduleFitRaf = requestAnimationFrame(() => {
      scheduleFitRaf = requestAnimationFrame(() => {
        scheduleFitRaf = 0;
        fit();
      });
    });
  }

  function stopResizeRetry() {
    if (resizeRetryTimer !== null) {
      clearInterval(resizeRetryTimer);
      resizeRetryTimer = null;
    }
    resizeRetryRemaining = 0;
  }

  function startResizeRetry() {
    stopResizeRetry();
    resizeRetryRemaining = RESIZE_RETRY_COUNT;
    resizeRetryTimer = setInterval(() => {
      fit();
      notifyResize();
      resizeRetryRemaining -= 1;
      if (resizeRetryRemaining <= 0) {
        stopResizeRetry();
      }
    }, RESIZE_RETRY_MS);
  }

  function getSize() {
    return { cols: terminal?.cols ?? 0, rows: terminal?.rows ?? 0 };
  }

  fitAddon = new FitAddon();
  terminal = new Terminal({ ...DEFAULT_OPTIONS, ...options });
  terminal.loadAddon(fitAddon);
  terminal.open(hostElement);

  terminal.onResize(() => notifyResize());
  window.addEventListener("resize", onWindowResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onWindowResize);
  }
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(onHostResize);
    resizeObserver.observe(hostElement);
  }

  return {
    fit,
    scheduleFit,
    getSize,
    onResize(handler) {
      resizeListeners.add(handler);
      return () => resizeListeners.delete(handler);
    },
    onData(handler) {
      const disposable = terminal.onData(handler);
      return () => disposable.dispose();
    },
    write(data) {
      terminal.write(data);
    },
    writeln(text) {
      terminal.writeln(text);
    },
    clear() {
      terminal.clear();
    },
    focus() {
      terminal.focus();
    },
    startResizeRetry,
    stopResizeRetry,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stopResizeRetry();
      if (scheduleFitRaf) {
        cancelAnimationFrame(scheduleFitRaf);
        scheduleFitRaf = 0;
      }
      window.removeEventListener("resize", onWindowResize);
      window.visualViewport?.removeEventListener("resize", onWindowResize);
      resizeObserver?.disconnect();
      resizeObserver = null;
      resizeListeners.clear();
      terminal.dispose();
      terminal = null;
      fitAddon = null;
      hostElement.replaceChildren();
      window.dispatchEvent(new CustomEvent("vm-terminal-dispose"));
    },
  };
}
