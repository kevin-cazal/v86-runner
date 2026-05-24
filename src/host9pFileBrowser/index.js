/**
 * Modal file browser for the in-memory host9p VFS (Menu → Host files…).
 */
import {
  defaultTarGzFilename,
  exportHost9pTarGz,
} from "../host9p/exportTarGz.js";
import { Host9pError } from "../host9p/errors.js";
import { showPopup } from "../popup/index.js";

/** @typedef {import("../host9p/index.js").Host9pEntry} Host9pEntry */
/** @typedef {import("../host9p/index.js").Host9pVfsApi} Host9pVfsApi */

/**
 * @param {string} dirPath
 * @param {string} name
 */
function joinPath(dirPath, name) {
  return dirPath === "/" ? `/${name}` : `${dirPath}/${name}`;
}

/**
 * @param {string} path
 */
function parentPath(path) {
  if (path === "/") {
    return "/";
  }
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

/**
 * @param {number} bytes
 */
function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * @param {number} unixSeconds
 */
function formatMtime(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString();
}

/**
 * @param {unknown} err
 */
function errorMessage(err) {
  if (err instanceof Host9pError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * @param {File} file
 * @returns {Promise<Uint8Array>}
 */
function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(new Uint8Array(/** @type {ArrayBuffer} */ (reader.result)));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * @param {Uint8Array} bytes
 * @param {string} filename
 */
function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * @param {() => Host9pVfsApi | null} getVfs
 */
export function openHost9pFileBrowser(getVfs) {
  if (!getVfs()) {
    return;
  }

  showPopup({
    title: "Host files",
    render(container) {
      return renderHost9pBrowser(container, getVfs);
    },
  });
}

/**
 * @param {HTMLElement} container
 * @param {() => Host9pVfsApi | null} getVfs
 * @returns {() => void}
 */
function renderHost9pBrowser(container, getVfs) {
  let currentPath = "/";
  /** @type {string | null} */
  let renamingPath = null;
  /** @type {string | null} */
  let removingPath = null;

  const root = document.createElement("div");
  root.className = "host9p-browser";

  const pathHint = document.createElement("p");
  pathHint.className = "host9p-browser-path-hint";

  const statusEl = document.createElement("p");
  statusEl.className = "host9p-browser-status";
  statusEl.hidden = true;

  const toolbar = document.createElement("div");
  toolbar.className = "host9p-browser-toolbar";

  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "host9p-browser-btn";
  upBtn.textContent = "Up";

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "host9p-browser-btn";
  refreshBtn.textContent = "Refresh";

  const uploadBtn = document.createElement("button");
  uploadBtn.type = "button";
  uploadBtn.className = "host9p-browser-btn";
  uploadBtn.textContent = "Upload…";

  const mkdirBtn = document.createElement("button");
  mkdirBtn.type = "button";
  mkdirBtn.className = "host9p-browser-btn";
  mkdirBtn.textContent = "New directory…";

  const downloadTarBtn = document.createElement("button");
  downloadTarBtn.type = "button";
  downloadTarBtn.className = "host9p-browser-btn";
  downloadTarBtn.textContent = "Download .tar.gz…";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.hidden = true;

  toolbar.append(upBtn, refreshBtn, uploadBtn, mkdirBtn, downloadTarBtn, fileInput);

  const mkdirPanel = document.createElement("div");
  mkdirPanel.className = "host9p-browser-mkdir-panel";
  mkdirPanel.hidden = true;

  const mkdirForm = document.createElement("form");
  mkdirForm.className = "host9p-browser-mkdir-form";

  const mkdirLabel = document.createElement("label");
  mkdirLabel.className = "host9p-browser-mkdir-label";
  mkdirLabel.textContent = "Directory name";

  const mkdirInput = document.createElement("input");
  mkdirInput.type = "text";
  mkdirInput.className = "host9p-browser-rename-input";
  mkdirInput.required = true;
  mkdirInput.autocomplete = "off";
  mkdirLabel.append(mkdirInput);

  const mkdirCreateBtn = document.createElement("button");
  mkdirCreateBtn.type = "submit";
  mkdirCreateBtn.className = "host9p-browser-btn host9p-browser-btn-small";
  mkdirCreateBtn.textContent = "Create";

  const mkdirCancelBtn = document.createElement("button");
  mkdirCancelBtn.type = "button";
  mkdirCancelBtn.className = "host9p-browser-btn host9p-browser-btn-small";
  mkdirCancelBtn.textContent = "Cancel";

  mkdirForm.append(mkdirLabel, mkdirCreateBtn, mkdirCancelBtn);
  mkdirPanel.append(mkdirForm);

  const listWrap = document.createElement("div");
  listWrap.className = "host9p-browser-list-wrap";

  const table = document.createElement("table");
  table.className = "host9p-browser-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const label of ["Name", "Size", "Modified", "Actions"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headerRow.append(th);
  }
  thead.append(headerRow);

  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  listWrap.append(table);

  root.append(pathHint, statusEl, toolbar, mkdirPanel, listWrap);
  container.append(root);

  function showMkdirPanel() {
    clearEditing();
    mkdirPanel.hidden = false;
    mkdirInput.value = "";
    queueMicrotask(() => mkdirInput.focus());
  }

  function hideMkdirPanel() {
    mkdirPanel.hidden = true;
    mkdirInput.value = "";
  }

  function clearRename() {
    renamingPath = null;
  }

  function clearRemove() {
    removingPath = null;
  }

  function clearEditing() {
    clearRename();
    clearRemove();
  }

  /** @param {string} message */
  function setStatus(message) {
    if (message) {
      statusEl.textContent = message;
      statusEl.hidden = false;
    } else {
      statusEl.textContent = "";
      statusEl.hidden = true;
    }
  }

  function updatePathHint() {
    const guestPath = currentPath === "/" ? "/mnt/host" : `/mnt/host${currentPath}`;
    pathHint.textContent = `Host: ${currentPath}  ·  Guest: ${guestPath}`;
    upBtn.disabled = currentPath === "/";
  }

  /** @param {() => void} [after] */
  function refresh(after) {
    const vfs = getVfs();
    if (!vfs) {
      setStatus("Host file share is not available.");
      tbody.replaceChildren();
      return;
    }

    updatePathHint();

    const entries = vfs.listEntries(currentPath);
    tbody.replaceChildren();

    if (!entries.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "host9p-browser-empty";
      cell.textContent = "(empty)";
      row.append(cell);
      tbody.append(row);
      after?.();
      return;
    }

    for (const entry of entries) {
      tbody.append(buildRow(entry, vfs));
    }
    after?.();
  }

  /**
   * @param {Host9pEntry} entry
   * @param {Host9pVfsApi} vfs
   */
  function buildRow(entry, vfs) {
    const row = document.createElement("tr");
    row.className =
      entry.type === "directory" ? "host9p-browser-row-dir" : "host9p-browser-row-file";

    const nameCell = document.createElement("td");
    nameCell.className = "host9p-browser-name-cell";

    if (renamingPath === entry.path) {
      const renameForm = document.createElement("form");
      renameForm.className = "host9p-browser-rename-form";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "host9p-browser-rename-input";
      input.value = entry.name;
      input.required = true;

      const saveBtn = document.createElement("button");
      saveBtn.type = "submit";
      saveBtn.className = "host9p-browser-btn host9p-browser-btn-small";
      saveBtn.textContent = "Save";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "host9p-browser-btn host9p-browser-btn-small";
      cancelBtn.textContent = "Cancel";

      renameForm.append(input, saveBtn, cancelBtn);
      nameCell.append(renameForm);

      renameForm.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const newName = input.value.trim();
        if (!newName || newName === entry.name) {
          clearRename();
          refresh();
          return;
        }
        try {
          const newPath = joinPath(parentPath(entry.path), newName);
          vfs.rename(entry.path, newPath);
          setStatus("");
          clearRename();
          refresh();
        } catch (err) {
          setStatus(errorMessage(err));
        }
      });

      cancelBtn.addEventListener("click", () => {
        clearRename();
        refresh();
      });

      queueMicrotask(() => input.focus());
    } else {
      const nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "host9p-browser-name-btn";
      nameBtn.textContent =
        entry.type === "directory" ? `${entry.name}/` : entry.name;
      nameBtn.title = entry.path;

      if (entry.type === "directory") {
        nameBtn.addEventListener("click", () => {
          currentPath = entry.path;
          setStatus("");
          hideMkdirPanel();
          clearEditing();
          refresh();
        });
      }

      nameCell.append(nameBtn);
    }

    const sizeCell = document.createElement("td");
    sizeCell.className = "host9p-browser-size-cell";
    sizeCell.textContent = entry.type === "directory" ? "—" : formatSize(entry.size);

    const mtimeCell = document.createElement("td");
    mtimeCell.className = "host9p-browser-mtime-cell";
    mtimeCell.textContent = formatMtime(entry.mtime);

    const actionsCell = document.createElement("td");
    actionsCell.className = "host9p-browser-actions-cell";

    if (removingPath === entry.path) {
      const confirmWrap = document.createElement("div");
      confirmWrap.className = "host9p-browser-remove-confirm";

      const msg = document.createElement("span");
      msg.className = "host9p-browser-remove-msg";
      const kind = entry.type === "directory" ? "directory" : "file";
      msg.textContent = `Remove ${kind} “${entry.name}”?`;

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className =
        "host9p-browser-btn host9p-browser-btn-small host9p-browser-btn-danger";
      confirmBtn.textContent = "Remove";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "host9p-browser-btn host9p-browser-btn-small";
      cancelBtn.textContent = "Cancel";

      confirmBtn.addEventListener("click", () => {
        try {
          if (entry.type === "directory") {
            vfs.rmdir(entry.path);
          } else {
            vfs.remove(entry.path);
          }
          setStatus("");
          clearRemove();
          refresh();
        } catch (err) {
          setStatus(errorMessage(err));
        }
      });

      cancelBtn.addEventListener("click", () => {
        clearRemove();
        refresh();
      });

      confirmWrap.append(msg, confirmBtn, cancelBtn);
      actionsCell.append(confirmWrap);
    } else if (renamingPath !== entry.path) {
      if (entry.type === "file") {
        const downloadBtn = document.createElement("button");
        downloadBtn.type = "button";
        downloadBtn.className = "host9p-browser-btn host9p-browser-btn-small";
        downloadBtn.textContent = "Download";
        downloadBtn.addEventListener("click", () => {
          try {
            const data = vfs.get(entry.path);
            if (!data) {
              setStatus(`File not found: ${entry.path}`);
              return;
            }
            downloadBytes(data, entry.name);
            setStatus("");
          } catch (err) {
            setStatus(errorMessage(err));
          }
        });
        actionsCell.append(downloadBtn);
      }

      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "host9p-browser-btn host9p-browser-btn-small";
      renameBtn.textContent = "Rename";
      renameBtn.addEventListener("click", () => {
        hideMkdirPanel();
        clearRemove();
        renamingPath = entry.path;
        setStatus("");
        refresh();
      });
      actionsCell.append(renameBtn);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className =
        "host9p-browser-btn host9p-browser-btn-small host9p-browser-btn-danger";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        hideMkdirPanel();
        clearRename();
        removingPath = entry.path;
        setStatus("");
        refresh();
      });
      actionsCell.append(removeBtn);
    }

    row.append(nameCell, sizeCell, mtimeCell, actionsCell);
    return row;
  }

  upBtn.addEventListener("click", () => {
    currentPath = parentPath(currentPath);
    setStatus("");
    hideMkdirPanel();
    clearEditing();
    refresh();
  });

  refreshBtn.addEventListener("click", () => {
    setStatus("");
    clearEditing();
    refresh();
  });

  uploadBtn.addEventListener("click", () => {
    fileInput.click();
  });

  downloadTarBtn.addEventListener("click", () => {
    const vfs = getVfs();
    if (!vfs) {
      setStatus("Host file share is not available.");
      return;
    }

    downloadTarBtn.disabled = true;
    setStatus("Building archive…");

    void (async () => {
      try {
        const archive = await exportHost9pTarGz(vfs, currentPath);
        downloadBytes(archive, defaultTarGzFilename(currentPath));
        setStatus("");
      } catch (err) {
        setStatus(errorMessage(err));
      } finally {
        downloadTarBtn.disabled = false;
      }
    })();
  });

  fileInput.addEventListener("change", () => {
    const files = fileInput.files;
    if (!files?.length) {
      return;
    }
    const vfs = getVfs();
    if (!vfs) {
      setStatus("Host file share is not available.");
      fileInput.value = "";
      return;
    }

    void (async () => {
      try {
        for (const file of files) {
          const bytes = await readFileBytes(file);
          vfs.put(joinPath(currentPath, file.name), bytes);
        }
        setStatus("");
        refresh();
      } catch (err) {
        setStatus(errorMessage(err));
      } finally {
        fileInput.value = "";
      }
    })();
  });

  mkdirBtn.addEventListener("click", () => {
    setStatus("");
    showMkdirPanel();
  });

  mkdirCancelBtn.addEventListener("click", () => {
    hideMkdirPanel();
  });

  mkdirForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const name = mkdirInput.value.trim();
    if (!name) {
      return;
    }
    const vfs = getVfs();
    if (!vfs) {
      setStatus("Host file share is not available.");
      return;
    }
    try {
      vfs.mkdir(joinPath(currentPath, name));
      setStatus("");
      hideMkdirPanel();
      refresh();
    } catch (err) {
      setStatus(errorMessage(err));
    }
  });

  refresh();

  return () => {
    fileInput.remove();
  };
}
