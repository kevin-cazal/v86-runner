/** Shown before a disk is chosen and when the filename cannot be turned into a title. */
export const DEFAULT_PAGE_TITLE = "VM serial console";

/** @param {string} text */
function applyPageTitle(text) {
  document.title = text;
  const heading = document.getElementById("page-title");
  if (heading) {
    heading.textContent = text;
  }
}

/**
 * @param {string | undefined | null} filename
 * @returns {string}
 */
export function pageTitleFromImageFilename(filename) {
  if (typeof filename !== "string") {
    return DEFAULT_PAGE_TITLE;
  }
  const base = filename.trim();
  if (!base) {
    return DEFAULT_PAGE_TITLE;
  }
  const name = base.replace(/^.*[/\\]/, "");
  const stem = name.replace(/\.(img|raw|iso|bin|qcow2?)$/i, "").trim();
  if (!stem || stem === "." || stem === "..") {
    return DEFAULT_PAGE_TITLE;
  }
  return stem;
}

/**
 * @param {string | undefined | null} filename
 */
export function setPageTitleFromImage(filename) {
  applyPageTitle(pageTitleFromImageFilename(filename));
}

export function resetPageTitle() {
  applyPageTitle(DEFAULT_PAGE_TITLE);
}
