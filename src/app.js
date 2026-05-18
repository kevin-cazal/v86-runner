import { createMenuButton } from "./menu/index.js";
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
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.round((100 * ev.loaded) / ev.total));
      }
    };
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
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

async function destroyVm() {
  term?.stopResizeRetry();
  detachHvc1Bridge();
  if (vm) {
    await vm.destroy();
    vm = null;
  }
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
  ],
});

async function bootWithBuffer(buffer, label) {
  diskBuffer = buffer;
  diskLabel = label;
  setPageTitleFromImage(label);

  showLoadScreen();
  loadProgress.hidden = false;
  loadProgress.value = 0;
  setLoadMessage("Checking BIOS…");
  await checkBiosAssets();

  await destroyVm();
  disposeTerminal();

  term = createVmTerminal(terminalHost);
  vm = createVmEmulator({
    diskBuffer,
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
    term.writeln("\r\n[emulator ready — boot may take several minutes in v86]\r\n");
  });

  showTerminalView();
  term.clear();
  term.writeln(`\r\nBooting ${label} (${formatBytes(buffer.byteLength)})…\r\n`);
  syncGuestSize();

  setLoadMessage("Starting emulator…");
  const readyPromise = vm.start();
  attachHvc1Bridge(vm.emulator);
  await readyPromise;
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
    setLoadMessage(`Reading ${name} (${formatBytes(size)})…`);
    loadProgress.hidden = false;
    loadProgress.value = 0;

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
