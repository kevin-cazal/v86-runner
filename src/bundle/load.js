import { decompress } from "fzstd";
import {
  parseV86BundleHeader,
  V86B_HEADER_SIZE,
  v86BundlePayloadBytes,
  validateV86BundleLayout,
} from "./format.js";

/**
 * @typedef {{
 *   diskBuffer: ArrayBuffer,
 *   label: string,
 *   initialStateBuffer: ArrayBuffer,
 *   memorySize: number,
 *   biosBuffer: ArrayBuffer,
 *   vgaBiosBuffer: ArrayBuffer,
 * }} V86BundleLoadResult
 */

/**
 * @typedef {{ phase: string, percent: number }} BundleLoadProgress
 */

/**
 * @param {File} file
 * @param {{
 *   readSlice: (start: number, length: number, onSliceProgress?: (pct: number) => void) => Promise<ArrayBuffer>,
 *   onProgress?: (info: BundleLoadProgress) => void,
 * }} io
 * @returns {Promise<V86BundleLoadResult>}
 */
export async function loadV86Bundle(file, { readSlice, onProgress }) {
  onProgress?.({ phase: "Reading bundle header…", percent: 0 });

  const headerBuf = await readSlice(0, V86B_HEADER_SIZE);
  const header = parseV86BundleHeader(headerBuf);
  validateV86BundleLayout(header, file.size);

  const payloadTotal = v86BundlePayloadBytes(header);
  let payloadDone = 0;

  const reportSlice = (phase, length, slicePct) => {
    const inSlice = Math.round((length * slicePct) / 100);
    const percent = Math.min(
      94,
      Math.round((100 * (payloadDone + inSlice)) / payloadTotal),
    );
    onProgress?.({ phase, percent });
  };

  const readSection = async (start, length, phase) => {
    onProgress?.({
      phase,
      percent: Math.min(94, Math.round((100 * payloadDone) / payloadTotal)),
    });
    const buf = await readSlice(start, length, (slicePct) =>
      reportSlice(phase, length, slicePct),
    );
    payloadDone += length;
    onProgress?.({
      phase,
      percent: Math.min(94, Math.round((100 * payloadDone) / payloadTotal)),
    });
    return buf;
  };

  const biosBuffer = await readSection(
    header.seabiosOffset,
    header.seabiosSize,
    "Loading SeaBIOS…",
  );
  const vgaBiosBuffer = await readSection(
    header.vgabiosOffset,
    header.vgabiosSize,
    "Loading VGA BIOS…",
  );

  const diskBuffer = await readSection(
    header.diskOffset,
    header.diskSize,
    "Loading disk image…",
  );

  const stateZstd = await readSection(
    header.stateOffset,
    header.stateZstdSize,
    "Loading saved state…",
  );

  onProgress?.({ phase: "Decompressing state…", percent: 96 });
  const stateBytes = decompress(new Uint8Array(stateZstd));
  onProgress?.({ phase: "Bundle ready", percent: 100 });

  const initialStateBuffer = stateBytes.slice().buffer;

  return {
    diskBuffer,
    initialStateBuffer,
    memorySize: header.memorySize,
    biosBuffer,
    vgaBiosBuffer,
    label: file.name,
  };
}
