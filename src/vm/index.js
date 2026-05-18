import { V86 } from "v86";

const DEFAULT_MEMORY = 512 * 1024 * 1024;
const textEncoder = new TextEncoder();

export async function checkBiosAssets() {
  const [bios, vga, wasm] = await Promise.all([
    fetch("/assets/seabios.bin", { method: "HEAD" }),
    fetch("/assets/vgabios.bin", { method: "HEAD" }),
    fetch("/v86.wasm", { method: "HEAD" }),
  ]);
  if (!bios.ok || !vga.ok || !wasm.ok) {
    throw new Error(
      "Missing BIOS or wasm — stage public/v86.wasm and public/assets/*.bin (see README)",
    );
  }
}

/**
 * @param {{
 *   diskBuffer: ArrayBuffer,
 *   initialStateBuffer?: ArrayBuffer,
 *   memorySize?: number,
 *   onDownloadProgress?: (info: { file_name: string, loaded: number, total: number, lengthComputable: boolean }) => void,
 * }} config
 */
export function createVmEmulator({
  diskBuffer,
  initialStateBuffer,
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
        wasm_path: "/v86.wasm",
        bios: { url: "/assets/seabios.bin" },
        vga_bios: { url: "/assets/vgabios.bin" },
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
