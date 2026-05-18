import { V86 } from "v86";
import { assetUrl } from "../util/assetUrl.js";

const DEFAULT_MEMORY =
  (Number(import.meta.env.VITE_VM_MEMORY_MB) || 512) * 1024 * 1024;
const textEncoder = new TextEncoder();

export async function checkBiosAssets({ bundledBios = false } = {}) {
  const checks = [fetch(assetUrl("v86.wasm"), { method: "HEAD" })];
  if (!bundledBios) {
    checks.push(
      fetch(assetUrl("assets/seabios.bin"), { method: "HEAD" }),
      fetch(assetUrl("assets/vgabios.bin"), { method: "HEAD" }),
    );
  }
  const results = await Promise.all(checks);
  if (!results.every((r) => r.ok)) {
    throw new Error(
      bundledBios
        ? "Missing v86.wasm — run npm install in v86-runner"
        : "Missing BIOS or wasm — stage public/v86.wasm and public/assets/*.bin (see README)",
    );
  }
}

/**
 * @param {{
 *   diskBuffer: ArrayBuffer,
 *   initialStateBuffer?: ArrayBuffer,
 *   biosBuffer?: ArrayBuffer,
 *   vgaBiosBuffer?: ArrayBuffer,
 *   memorySize?: number,
 *   onDownloadProgress?: (info: { file_name: string, loaded: number, total: number, lengthComputable: boolean }) => void,
 * }} config
 */
export function createVmEmulator({
  diskBuffer,
  initialStateBuffer,
  biosBuffer,
  vgaBiosBuffer,
  memorySize = DEFAULT_MEMORY,
  onDownloadProgress,
}) {
  /** @type {import("v86").V86 | null} */
  let emulator = null;

  const consoleOutputHandlers = new Set();
  const readyHandlers = new Set();

  const onConsoleOutput = (data) => {
    for (const fn of consoleOutputHandlers) {
      fn(data);
    }
  };

  const onDownloadProgressEvent = (info) => {
    onDownloadProgress?.(info);
  };

  const onEmulatorReady = () => {
    for (const fn of readyHandlers) {
      fn();
    }
  };

  return {
    get emulator() {
      return emulator;
    },

    onConsoleOutput(handler) {
      consoleOutputHandlers.add(handler);
      return () => consoleOutputHandlers.delete(handler);
    },

    onReady(handler) {
      readyHandlers.add(handler);
      return () => readyHandlers.delete(handler);
    },

    sendConsoleInput(data) {
      if (!emulator?.bus) {
        return;
      }
      const bytes =
        typeof data === "string" ? textEncoder.encode(data) : data;
      emulator.bus.send("virtio-console0-input-bytes", bytes);
    },

    sendConsoleResize(cols, rows) {
      if (!emulator?.bus) {
        return;
      }
      // Alpine linux-virt reads resize cols-first; v86 emits spec rows-first on the wire.
      emulator.bus.send("virtio-console0-resize", [rows, cols]);
    },

    start() {
      if (emulator) {
        throw new Error("VmEmulator already started");
      }

      emulator = new V86({
        wasm_path: assetUrl("v86.wasm"),
        bios: biosBuffer
          ? { buffer: biosBuffer }
          : { url: assetUrl("assets/seabios.bin") },
        vga_bios: vgaBiosBuffer
          ? { buffer: vgaBiosBuffer }
          : { url: assetUrl("assets/vgabios.bin") },
        hda: { buffer: diskBuffer },
        ...(initialStateBuffer
          ? { initial_state: { buffer: initialStateBuffer } }
          : {}),
        memory_size: memorySize,
        virtio_console: true,
        autostart: true,
      });

      emulator.add_listener("virtio-console0-output-bytes", onConsoleOutput);
      if (onDownloadProgress) {
        emulator.add_listener("download-progress", onDownloadProgressEvent);
      }
      emulator.add_listener("emulator-ready", onEmulatorReady);

      return new Promise((resolve) => {
        const unsub = this.onReady(() => {
          unsub();
          resolve();
        });
      });
    },

    restart() {
      emulator?.restart();
    },

    async saveState() {
      if (!emulator) {
        throw new Error("VM not running");
      }
      return emulator.save_state();
    },

    async restoreState(buffer) {
      if (!emulator) {
        throw new Error("VM not running");
      }
      await emulator.restore_state(buffer);
    },

    async destroy() {
      if (!emulator) {
        return;
      }
      emulator.remove_listener("virtio-console0-output-bytes", onConsoleOutput);
      emulator.remove_listener("download-progress", onDownloadProgressEvent);
      emulator.remove_listener("emulator-ready", onEmulatorReady);
      try {
        await emulator.destroy();
      } catch {
        /* ignore */
      }
      emulator = null;
      consoleOutputHandlers.clear();
      readyHandlers.clear();
    },
  };
}
