import { V86B_MAGIC } from "./format.js";

export const V86B_FILE_EXT = /\.v86b$/i;

/**
 * @param {File} file
 * @param {(start: number, length: number) => Promise<ArrayBuffer>} readSlice
 */
export async function isV86BundleFile(file, readSlice) {
  if (V86B_FILE_EXT.test(file.name)) {
    return true;
  }
  if (file.size < 4) {
    return false;
  }
  const head = await readSlice(0, 4);
  return new DataView(head).getUint32(0, true) === V86B_MAGIC;
}
