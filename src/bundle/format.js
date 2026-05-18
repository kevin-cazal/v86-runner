/** V86B — v86-runner single-file VM bundle (header + BIOS + disk + zstd state). */

export const V86B_MAGIC = 0x42363856; // "V86B" little-endian
/** @deprecated Pre-release magic; still accepted when reading. */
export const V86B_LEGACY_SRG1_MAGIC = 0x31475253;
/** Current on-disk format version (embedded seabios + vgabios + disk + zstd state). */
export const V86B_VERSION = 1;
/** @deprecated Bundles packed before v1 renumbering; same layout as {@link V86B_VERSION}. */
export const V86B_VERSION_LEGACY = 2;
export const V86B_HEADER_SIZE = 64;
export const V86B_DEFAULT_MEMORY = 512 * 1024 * 1024;
export const V86B_MAX_DISK_BYTES = 2 * 1024 * 1024 * 1024;
export const V86B_MAX_BIOS_BYTES = 4 * 1024 * 1024;

/**
 * @typedef {{
 *   version: number,
 *   flags: number,
 *   memorySize: number,
 *   seabiosSize: number,
 *   vgabiosSize: number,
 *   diskSize: number,
 *   stateZstdSize: number,
 *   seabiosOffset: number,
 *   vgabiosOffset: number,
 *   diskOffset: number,
 *   stateOffset: number,
 *   v86StateVersion: number,
 * }} V86BundleHeader
 */

function assertBundleMagic(magic) {
  if (magic !== V86B_MAGIC && magic !== V86B_LEGACY_SRG1_MAGIC) {
    throw new Error("Not a V86 bundle (bad magic)");
  }
}

function isSupportedBundleVersion(version) {
  return version === V86B_VERSION || version === V86B_VERSION_LEGACY;
}

/**
 * @param {ArrayBuffer} buf Must be at least 64 bytes.
 * @returns {V86BundleHeader}
 */
export function parseV86BundleHeader(buf) {
  const view = new DataView(buf);
  const magic = view.getUint32(0, true);
  assertBundleMagic(magic);
  const version = view.getUint16(4, true);
  const flags = view.getUint16(6, true);
  const memorySize = view.getUint32(8, true);

  if (!isSupportedBundleVersion(version)) {
    throw new Error(`Unsupported V86 bundle version ${version}`);
  }

  const seabiosSize = view.getUint32(12, true);
  const vgabiosSize = view.getUint32(16, true);
  const diskSize = view.getUint32(20, true);
  const stateZstdSize = view.getUint32(24, true);
  const seabiosOffset = view.getUint32(28, true);
  const vgabiosOffset = view.getUint32(32, true);
  const diskOffset = view.getUint32(36, true);
  const stateOffset = view.getUint32(40, true);
  const v86StateVersion = view.getUint32(44, true);

  if (seabiosOffset !== V86B_HEADER_SIZE) {
    throw new Error(`Unexpected seabios_offset ${seabiosOffset}`);
  }
  if (
    seabiosSize === 0 ||
    seabiosSize > V86B_MAX_BIOS_BYTES ||
    vgabiosSize === 0 ||
    vgabiosSize > V86B_MAX_BIOS_BYTES
  ) {
    throw new Error("Invalid BIOS section sizes");
  }
  if (vgabiosOffset !== seabiosOffset + seabiosSize) {
    throw new Error(`Unexpected vgabios_offset ${vgabiosOffset}`);
  }
  if (diskOffset !== vgabiosOffset + vgabiosSize) {
    throw new Error(`Unexpected disk_offset ${diskOffset}`);
  }
  if (diskSize === 0 || diskSize > V86B_MAX_DISK_BYTES) {
    throw new Error(`Invalid disk_size ${diskSize}`);
  }
  if (stateZstdSize === 0) {
    throw new Error("V86 bundle requires zstd state section");
  }
  if (stateOffset !== diskOffset + diskSize) {
    throw new Error(`Unexpected state_offset ${stateOffset}`);
  }
  if (memorySize < 16 * 1024 * 1024 || memorySize > 2048 * 1024 * 1024) {
    throw new Error(`Invalid memory_size ${memorySize}`);
  }

  return {
    version,
    flags,
    memorySize,
    seabiosSize,
    vgabiosSize,
    diskSize,
    stateZstdSize,
    seabiosOffset,
    vgabiosOffset,
    diskOffset,
    stateOffset,
    v86StateVersion,
  };
}

/**
 * @param {V86BundleHeader} header
 * @param {number} fileSize
 */
export function validateV86BundleLayout(header, fileSize) {
  const need = header.stateOffset + header.stateZstdSize;
  if (fileSize < need) {
    throw new Error(
      `Bundle truncated: need ${need} bytes, file is ${fileSize}`,
    );
  }
}

/** @param {V86BundleHeader} header */
export function v86BundlePayloadBytes(header) {
  return (
    header.seabiosSize +
    header.vgabiosSize +
    header.diskSize +
    header.stateZstdSize
  );
}

/**
 * @param {V86BundleHeader} header
 * @returns {ArrayBuffer}
 */
export function encodeV86BundleHeader(header) {
  const buf = new ArrayBuffer(V86B_HEADER_SIZE);
  const view = new DataView(buf);
  view.setUint32(0, V86B_MAGIC, true);
  view.setUint16(4, V86B_VERSION, true);
  view.setUint16(6, header.flags ?? 0, true);
  view.setUint32(8, header.memorySize, true);
  view.setUint32(12, header.seabiosSize, true);
  view.setUint32(16, header.vgabiosSize, true);
  view.setUint32(20, header.diskSize, true);
  view.setUint32(24, header.stateZstdSize, true);
  view.setUint32(28, header.seabiosOffset, true);
  view.setUint32(32, header.vgabiosOffset, true);
  view.setUint32(36, header.diskOffset, true);
  view.setUint32(40, header.stateOffset, true);
  view.setUint32(44, header.v86StateVersion ?? 0, true);
  return buf;
}

/**
 * @param {number} seabiosSize
 * @param {number} vgabiosSize
 * @param {number} diskSize
 * @param {number} stateZstdSize
 */
export function computeV86BundleOffsets(
  seabiosSize,
  vgabiosSize,
  diskSize,
  stateZstdSize,
) {
  const seabiosOffset = V86B_HEADER_SIZE;
  const vgabiosOffset = seabiosOffset + seabiosSize;
  const diskOffset = vgabiosOffset + vgabiosSize;
  const stateOffset = diskOffset + diskSize;
  return { seabiosOffset, vgabiosOffset, diskOffset, stateOffset };
}
