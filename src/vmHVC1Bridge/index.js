const textEncoder = new TextEncoder();
const lineDecoder = new TextDecoder();

/** @type {Set<(line: string) => void>} */
const lineListeners = new Set();

/** @type {Set<(data: Uint8Array) => void>} */
const rawListeners = new Set();

/** @type {{ sendRaw: (bytes: ArrayBuffer | Uint8Array) => void, destroy: () => void } | null} */
let session = null;

let lineBuffer = "";
let lineFramerHooked = false;

const DEFAULT_SEND_CHUNK = 4096;

/** @returns {boolean} VM_BRIDGE_DEBUG in localStorage; default on unless "0". */
function vmbDebugEnabled() {
  try {
    const v = localStorage.getItem("VM_BRIDGE_DEBUG");
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

/** @param {...unknown} args */
function vmbLog(...args) {
  if (!vmbDebugEnabled()) return;
  console.log("[vm-bridge][hvc1]", ...args);
}

function resetLineFramer() {
  lineBuffer = "";
  lineDecoder.decode();
}

/** @param {Uint8Array} chunk */
function lineFramerFromRaw(chunk) {
  lineBuffer += lineDecoder.decode(chunk, { stream: true });
  let nl;
  while ((nl = lineBuffer.indexOf("\n")) >= 0) {
    const line = lineBuffer.slice(0, nl).replace(/\r$/, "").trim();
    lineBuffer = lineBuffer.slice(nl + 1);
    if (line) {
      const preview =
        line.length > 80 ? `${line.slice(0, 80)}…` : line;
      vmbLog(
        `line len=${line.length} listeners=${lineListeners.size} preview=${preview}`,
      );
      for (const fn of lineListeners) {
        fn(line);
      }
    }
  }
}

function syncLineFramerHook() {
  if (lineListeners.size > 0 && !lineFramerHooked) {
    rawListeners.add(lineFramerFromRaw);
    lineFramerHooked = true;
  } else if (lineListeners.size === 0 && lineFramerHooked) {
    rawListeners.delete(lineFramerFromRaw);
    lineFramerHooked = false;
    resetLineFramer();
  }
}

/** @param {Uint8Array} data */
function dispatchRaw(data) {
  const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
  vmbLog(
    `raw chunk bytes=${chunk.length} rawListeners=${rawListeners.size} lineBuf=${lineBuffer.length}`,
  );
  if (rawListeners.size === 0) {
    return;
  }
  for (const fn of rawListeners) {
    fn(chunk);
  }
}

function requireSession() {
  if (!session) {
    throw new Error("hvc1 bridge is not attached (no emulator running)");
  }
  return session;
}

/**
 * Register a callback for guest→host raw chunks on hvc1 (as delivered by v86).
 * @param {(data: Uint8Array) => void} handler
 * @returns {() => void} unsubscribe
 */
export function onHvc1RawBytes(handler) {
  rawListeners.add(handler);
  return () => rawListeners.delete(handler);
}

/**
 * Register a callback for guest→host lines on hvc1 (newline-delimited UTF-8).
 * Implemented via the same raw dispatch path as {@link onHvc1RawBytes}.
 * @param {(line: string) => void} handler
 * @returns {() => void} unsubscribe
 */
export function onHvc1Line(handler) {
  lineListeners.add(handler);
  syncLineFramerHook();
  return () => {
    lineListeners.delete(handler);
    syncLineFramerHook();
  };
}

/**
 * Send raw bytes host→guest on hvc1 (sole virtio input path).
 * @param {ArrayBuffer | Uint8Array} bytes
 * @param {{ chunkSize?: number }} [options]
 */
export function sendHvc1RawBytes(bytes, options = {}) {
  const { sendRaw } = requireSession();
  const chunkSize = options.chunkSize ?? DEFAULT_SEND_CHUNK;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length <= chunkSize) {
    sendRaw(u8);
    return;
  }
  for (let i = 0; i < u8.length; i += chunkSize) {
    sendRaw(u8.subarray(i, Math.min(i + chunkSize, u8.length)));
  }
}

/**
 * Send one UTF-8 line host→guest (adds \\n if missing). Encodes via {@link sendHvc1RawBytes}.
 * @param {string} line
 */
export function sendHvc1Line(line) {
  const msg = line.endsWith("\n") ? line : `${line}\n`;
  sendHvc1RawBytes(textEncoder.encode(msg));
}

/**
 * @param {import("v86").V86} emulator
 * @param {{ port?: number }} [options]
 */
export function attachHvc1Bridge(emulator, { port = 1 } = {}) {
  detachHvc1Bridge();

  const outEvent = `virtio-console${port}-output-bytes`;
  const inEvent = `virtio-console${port}-input-bytes`;

  const onOutput = (data) => {
    dispatchRaw(data);
  };

  emulator.add_listener(outEvent, onOutput);

  const sendRaw = (bytes) => {
    const chunk =
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    emulator.bus.send(inEvent, chunk);
  };

  const destroy = () => {
    resetLineFramer();
    emulator.remove_listener(outEvent, onOutput);
    if (session?.destroy === destroy) {
      session = null;
    }
  };

  session = { sendRaw, destroy };
  return session;
}

/** Detach virtio-console listeners; handler registrations are kept. */
export function detachHvc1Bridge() {
  session?.destroy();
  session = null;
}

/** @returns {boolean} */
export function isHvc1BridgeAttached() {
  return session !== null;
}

/** @deprecated Use attachHvc1Bridge */
export function attachVmBridge(emulator, port = 1) {
  attachHvc1Bridge(emulator, { port });
  return {
    send: sendHvc1Line,
    sendRaw: sendHvc1RawBytes,
    onLine: onHvc1Line,
    onRawBytes: onHvc1RawBytes,
    destroy: () => {
      detachHvc1Bridge();
    },
  };
}
