#!/usr/bin/env node
/**
 * Headless v86 boot: serial0 live log, hvc1 vm-bridge handshake, save_state.
 *
 * Guest must send "splash-ready" on hvc1 when splash is shown, then run
 * sync/drop_caches + "state-ready" after host sends quiesce on serial0.
 *
 * Usage:
 *   node scripts/build-v86-state.mjs --disk alpine.img -o alpine.v86state
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { V86 } from "v86";
import { V86B_DEFAULT_MEMORY } from "../src/bundle/format.js";
import {
  attachHvc1Bridge,
  detachHvc1Bridge,
  onHvc1Line,
} from "../src/vmHVC1Bridge/index.js";
import { resolveBiosPath } from "./lib/resolve-bios.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const STATE_READY_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
/** Match typical browser xterm size so splash layout in save_state matches resume. */
const CONSOLE_COLS = Number(process.env.V86_STATE_CONSOLE_COLS || 80);
const CONSOLE_ROWS = Number(process.env.V86_STATE_CONSOLE_ROWS || 24);

const defaultMemoryBytes =
  Number(process.env.VITE_VM_MEMORY_MB || 0) > 0
    ? Number(process.env.VITE_VM_MEMORY_MB) * 1024 * 1024
    : V86B_DEFAULT_MEMORY;

const { values } = parseArgs({
  options: {
    disk: { type: "string" },
    output: { type: "string", short: "o" },
    memory: { type: "string", default: String(defaultMemoryBytes) },
    timeout: { type: "string", default: String(DEFAULT_TIMEOUT_MS) },
    seabios: { type: "string" },
    vgabios: { type: "string" },
  },
});

const diskPath = values.disk;
const outputPath = values.output;
const memorySize = Number(values.memory);
const timeoutMs = Number(values.timeout);

if (!diskPath || !outputPath) {
  console.error(
    "Usage: build-v86-state.mjs --disk DISK.img -o OUT.v86state [--memory BYTES] [--timeout MS]",
  );
  process.exit(1);
}

const wasmPath = join(ROOT, "node_modules/v86/build/v86.wasm");
const seabiosPath = resolveBiosPath(values.seabios, "seabios.bin", ROOT);
const vgabiosPath = resolveBiosPath(values.vgabios, "vgabios.bin", ROOT);

const disk = readFileSync(diskPath);
const seabios = readFileSync(seabiosPath);
const vgabios = readFileSync(vgabiosPath);

console.error(`Booting ${diskPath} (${disk.length} bytes), RAM ${memorySize}…`);
console.error("Serial console output follows:\n");

/** @type {import("v86").V86 | undefined} */
let emulator;
/** @type {"boot" | "quiesce" | "save" | "done"} */
let phase = "boot";
/** @type {ReturnType<typeof setTimeout> | null} */
let saveTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let timeoutTimer = null;
/** @type {(() => void) | undefined} */
let unsubLine;

function fail(msg) {
  console.error(`\n${msg}`);
  cleanup()
    .then(() => process.exit(1))
    .catch(() => process.exit(1));
}

async function cleanup() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
  unsubLine?.();
  unsubLine = undefined;
  detachHvc1Bridge();
  if (emulator) {
    try {
      await emulator.destroy();
    } catch {
      /* ignore */
    }
    emulator = undefined;
  }
}

async function saveAndExit() {
  if (phase === "done") {
    return;
  }
  phase = "done";
  console.error(`\nSaving state to ${outputPath}…`);
  try {
    const state = await emulator.save_state();
    writeFileSync(outputPath, new Uint8Array(state));
    console.error(`Saved ${outputPath} (${state.byteLength} bytes)`);
    await cleanup();
    process.exit(0);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

emulator = new V86({
  wasm_path: wasmPath,
  bios: { buffer: seabios.buffer },
  vga_bios: { buffer: vgabios.buffer },
  hda: { buffer: disk.buffer },
  memory_size: memorySize,
  virtio_console: true,
  autostart: true,
  disable_keyboard: true,
});

attachHvc1Bridge(emulator);

emulator.add_listener("emulator-ready", () => {
  emulator.bus.send("virtio-console0-resize", [CONSOLE_ROWS, CONSOLE_COLS]);
});

emulator.add_listener("serial0-output-byte", (byte) => {
  const c = String.fromCharCode(byte);
  process.stdout.write(c);
});

unsubLine = onHvc1Line((line) => {
  if (phase === "boot" && line === "splash-ready") {
    phase = "quiesce";
    console.error("\n[splash-ready] Quiescing guest via serial0…");
    emulator.serial0_send(
      "sync; echo 3 >/proc/sys/vm/drop_caches; /usr/local/bin/vm-bridge-send state-ready\n",
    );
  } else if (phase === "quiesce" && line === "state-ready") {
    phase = "save";
    console.error("[state-ready] Saving in 1s…");
    saveTimer = setTimeout(() => {
      void saveAndExit();
    }, STATE_READY_DELAY_MS);
  }
});

timeoutTimer = setTimeout(() => {
  fail(`Timed out after ${timeoutMs}ms (phase=${phase})`);
}, timeoutMs);

process.on("SIGINT", () => {
  fail("Interrupted");
});
