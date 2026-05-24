import { isV86BundleFile } from "./bundle/detect.js";
import { loadV86Bundle } from "./bundle/load.js";
import { createMenuButton } from "./menu/index.js";
import { openHost9pFileBrowser } from "./host9pFileBrowser/index.js";
import { createVmTerminal } from "./terminal/index.js";
import { checkBiosAssets, createVmEmulator } from "./vm/index.js";
import { attachHvc1Bridge, detachHvc1Bridge } from "./vmHVC1Bridge/index.js";
import { resetPageTitle, setPageTitleFromImage } from "./util/pageTitle.js";

const statusEl = document.getElementById("status");
const pickOverlay = document.getElementById("pick-overlay");
const pickError = document.getElementById("pick-error");
const diskInput = document.getElementById("disk-input");
const stateInput = document.getElementById("state-input");
const menuRoot = document.getElementById("menu-root");
const loadOverlay = document.getElementById("load-overlay");
const loadMessage = document.getElementById("load-message");
const loadProgress = document.getElementById("load-progress");
const terminalWrap = document.getElementById("terminal-wrap");
const terminalHost = document.getElementById("terminal");

/** @type {ReturnType<typeof createVmTerminal> | null} */
let term = null;
/** @type {ReturnType<typeof createVmEmulator> | null} */
let vm = null;
let diskBuffer = null;
let diskLabel = "";
let terminalViewActive = false;

function isVmRunning() {
  return !!vm;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setLoadMessage(text) {
  loadMessage.textContent = text;
}

function showPickError(message) {
  pickError.hidden = !message;
  pickError.textContent = message || "";
}

function showPickScreen() {
  pickOverlay.hidden = false;
  loadOverlay.hidden = true;
  terminalWrap.hidden = true;
  terminalViewActive = false;
  menu.setHidden(true);
  resetPageTitle();
  setStatus("Choose a disk image");
}

function showLoadScreen() {
  pickOverlay.hidden = true;
  loadOverlay.hidden = false;
  menu.setHidden(true);
}

function syncGuestSize() {
  term?.fit();
  if (term && vm?.emulator) {
    const { cols, rows } = term.getSize();
    vm.sendConsoleResize(cols, rows);
  }
}

function showTerminalView() {
  pickOverlay.hidden = true;
  loadOverlay.hidden = true;
  terminalWrap.hidden = false;
  terminalViewActive = true;
  menu.setHidden(false);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      syncGuestSize();
      term?.focus();
    });
  });
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function sanitizeFilename(name) {
  return name.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "") || "vm";
}

function readFileAsBuffer(file, onProgress) {
  return readFileSlice(file, 0, file.size, onProgress);
}

function readFileSlice(file, start, length, onProgress) {
  return new Promise((resolve, reject) => {
    const slice = file.slice(start, start + length);
    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.round((100 * ev.loaded) / ev.total));
      }
    };
    reader.onload = () => resolve(/** @type {ArrayBuffer} */ (reader.result));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsArrayBuffer(slice);
  });
}

function disposeTerminal() {
  term?.stopResizeRetry();
  term?.dispose();
  term = null;
}

function wireConsole(terminal, emulator) {
  emulator.onConsoleOutput((data) => {
    terminal.write(data);
  });
  terminal.onData((data) => {
    emulator.sendConsoleInput(data);
  });
  terminal.onResize(() => {
    const { cols, rows } = terminal.getSize();
    emulator.sendConsoleResize(cols, rows);
  });
}

function syncWindowDebug() {
  window.emulator = vm?.emulator ?? null;
  const h9 = vm?.host9p;
  window.host9p = h9
    ? {
        vfs: h9.vfs,
        Host9pError: h9.Host9pError,
        stats: () => h9.getStats(),
        reset: () => h9.vfs.reset(),
        resetStats: () => h9.resetStats(),
        enableDebug: () => {
          localStorage.setItem("host9pDebug", "1");
          console.log(
            "[host9p] debug on — reload page, then cat in guest; logs use console.log",
          );
        },
        disableDebug: () => localStorage.removeItem("host9pDebug"),
      }
    : null;
}

async function destroyVm() {
  term?.stopResizeRetry();
  detachHvc1Bridge();
  if (vm) {
    await vm.destroy();
    vm = null;
  }
  syncWindowDebug();
}

function resetVm() {
  if (!vm || !term) return;
  setStatus("Resetting…");
  vm.restart();
  syncGuestSize();
  term.startResizeRetry();
  setStatus(`Running — ${diskLabel}`);
  term.focus();
}

async function saveMemory() {
  if (!vm) return;
  try {
    setStatus("Saving memory…");
    const buffer = await vm.saveState();
    const base = sanitizeFilename(diskLabel.replace(/\.[^.]+$/, "") || diskLabel);
    const blob = new Blob([buffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.v86state`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Running — ${diskLabel}`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
    console.error(err);
  }
}

function loadMemory() {
  if (!vm) return;
  stateInput.click();
}

async function onStateSelected(file) {
  if (!file || !vm) return;
  try {
    setStatus("Loading memory…");
    const buffer = await readFileAsBuffer(file);
    await vm.restoreState(buffer);
    syncGuestSize();
    setStatus(`Running — ${diskLabel}`);
    term?.focus();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
    console.error(err);
  }
}

async function changeImage() {
  await destroyVm();
  disposeTerminal();
  diskBuffer = null;
  diskLabel = "";
  showPickScreen();
  diskInput.click();
}

const menu = createMenuButton(menuRoot, {
  getItems: () => [
    {
      type: "action",
      label: "Reset VM",
      disabled: () => !isVmRunning(),
      onClick: resetVm,
    },
    {
      type: "action",
      label: "Save memory…",
      disabled: () => !isVmRunning(),
      onClick: () => {
        void saveMemory();
      },
    },
    {
      type: "action",
      label: "Load memory…",
      disabled: () => !isVmRunning(),
      onClick: loadMemory,
    },
    {
      type: "action",
      label: "Change image…",
      disabled: () => !terminalViewActive,
      onClick: () => {
        void changeImage();
      },
    },
    {
      type: "action",
      label: "Host files…",
      disabled: () => !vm?.host9p?.vfs,
      onClick: () => openHost9pFileBrowser(() => vm?.host9p?.vfs ?? null),
    },
  ],
});

/**
 * @param {ArrayBuffer} buffer
 * @param {string} label
 * @param {{ initialStateBuffer?: ArrayBuffer, memorySize?: number, biosBuffer?: ArrayBuffer, vgaBiosBuffer?: ArrayBuffer }} [opts]
 */
async function bootWithBuffer(buffer, label, opts = {}) {
  const { initialStateBuffer, memorySize, biosBuffer, vgaBiosBuffer } = opts;
  const resuming = !!initialStateBuffer;
  const bundledBios = !!(biosBuffer && vgaBiosBuffer);

  diskBuffer = buffer;
  diskLabel = label;
  setPageTitleFromImage(label);

  showLoadScreen();
  loadProgress.hidden = false;
  loadProgress.value = 0;
  setLoadMessage(bundledBios ? "Checking emulator…" : "Checking BIOS…");
  await checkBiosAssets({ bundledBios });

  await destroyVm();
  disposeTerminal();

  term = createVmTerminal(terminalHost);
  vm = createVmEmulator({
    diskBuffer,
    initialStateBuffer,
    biosBuffer,
    vgaBiosBuffer,
    memorySize,
    onDownloadProgress(info) {
      if (!info.lengthComputable) {
        setLoadMessage(`Loading ${info.file_name}…`);
        return;
      }
      const pct = Math.min(100, Math.round((100 * info.loaded) / info.total));
      loadProgress.value = pct;
      setLoadMessage(`Loading ${info.file_name}: ${pct}%`);
    },
  });
  wireConsole(term, vm);

  vm.onReady(() => {
    showTerminalView();
    syncGuestSize();
    term.startResizeRetry();
    setStatus(`Running — ${diskLabel}`);
    if (resuming) {
      term.write("\x1b[?25l");
      setTimeout(() => syncGuestSize(), 50);
      setTimeout(() => syncGuestSize(), 1100);
    }
    term.writeln(
      resuming
        ? "\r\n[emulator ready — resumed from saved state]\r\n"
        : "\r\n[emulator ready — boot may take several minutes in v86]\r\n",
    );
  });

  showTerminalView();
  if (!resuming) {
    term.clear();
  }
  term.writeln(
    resuming
      ? `\r\nResuming ${label} (${formatBytes(buffer.byteLength)} disk)…\r\n`
      : `\r\nBooting ${label} (${formatBytes(buffer.byteLength)})…\r\n`,
  );
  syncGuestSize();

  setLoadMessage("Starting emulator…");
  const readyPromise = vm.start();
  attachHvc1Bridge(vm.emulator);
  await readyPromise;
  syncWindowDebug();
}

async function onDiskSelected(file) {
  if (!file) return;
  showPickError("");

  const name = file.name;
  const size = file.size;
  if (size <= 0) {
    showPickError("File is empty.");
    return;
  }

  try {
    showLoadScreen();
    loadProgress.hidden = false;
    loadProgress.value = 0;

    const readSlice = (start, length, onProgress) =>
      readFileSlice(file, start, length, onProgress);

    if (await isV86BundleFile(file, (s, l) => readSlice(s, l))) {
      const bundle = await loadV86Bundle(file, {
        readSlice,
        onProgress: ({ phase, percent }) => {
          loadProgress.value = percent;
          setLoadMessage(phase);
        },
      });
      await bootWithBuffer(bundle.diskBuffer, bundle.label, {
        initialStateBuffer: bundle.initialStateBuffer,
        memorySize: bundle.memorySize,
        biosBuffer: bundle.biosBuffer,
        vgaBiosBuffer: bundle.vgaBiosBuffer,
      });
      return;
    }

    setLoadMessage(`Reading ${name} (${formatBytes(size)})…`);
    const buffer = await readFileAsBuffer(file, (pct) => {
      loadProgress.value = pct;
      setLoadMessage(`Reading ${name}: ${pct}%`);
    });

    await bootWithBuffer(buffer, name);
  } catch (err) {
    showPickScreen();
    showPickError(err instanceof Error ? err.message : String(err));
    console.error(err);
  }
}

diskInput.addEventListener("change", () => {
  const file = diskInput.files?.[0];
  diskInput.value = "";
  onDiskSelected(file);
});

stateInput.addEventListener("change", () => {
  const file = stateInput.files?.[0];
  stateInput.value = "";
  void onStateSelected(file);
});

showPickScreen();
