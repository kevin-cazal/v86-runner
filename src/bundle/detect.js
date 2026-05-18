import { V86B_LEGACY_SRG1_MAGIC, V86B_MAGIC } from "./format.js";

export const V86B_FILE_EXT = /\.v86b$/i;
/** @deprecated Renamed to `.v86b`; still recognized. */
export const V86B_LEGACY_SRPG1_EXT = /\.srpg1$/i;

/**
 * @param {File} file
 * @param {(start: number, length: number) => Promise<ArrayBuffer>} readSlice
 */
export async function isV86BundleFile(file, readSlice) {
  if (V86B_FILE_EXT.test(file.name) || V86B_LEGACY_SRPG1_EXT.test(file.name)) {
    return true;
  }
  if (file.size < 4) {
    return false;
  }
  const head = await readSlice(0, 4);
  const magic = new DataView(head).getUint32(0, true);
  return magic === V86B_MAGIC || magic === V86B_LEGACY_SRG1_MAGIC;
}
