/**
 * In-memory 9p filesystem (simplified from copy/v86 lib/filesystem.js).
 */

import { Marshall } from "./marshall.js";
import { S_IFDIR, S_IFREG } from "./constants.js";

const textEncoder = new TextEncoder();

function createInode(qidnumber) {
  const now = Math.round(Date.now() / 1000);
  return {
    direntries: new Map(),
    size: 0,
    uid: 0,
    gid: 0,
    ctime: now,
    atime: now,
    mtime: now,
    mode: 0x01ed,
    nlinks: 0,
    qid: { type: 0, version: 0, path: qidnumber },
  };
}

export class Host9pVfs {
  constructor() {
    /** @type {ReturnType<typeof createInode>[]} */
    this.inodes = [];
    /** @type {Map<number, Uint8Array>} */
    this.inodedata = new Map();
    this.qidcounter = { last_qidnumber: 0 };
    this.total_size = 256 * 1024 * 1024;
    this.used_size = 0;
    this.CreateDirectory("", -1);
  }

  reset() {
    this.inodes = [];
    this.inodedata = new Map();
    this.qidcounter = { last_qidnumber: 0 };
    this.used_size = 0;
    this.CreateDirectory("", -1);
  }

  CreateInode() {
    const inode = createInode(++this.qidcounter.last_qidnumber);
    return inode;
  }

  PushInode(inode, parentid, name) {
    if (parentid >= 0) {
      const parent = this.inodes[parentid];
      parent.direntries.set(name, this.inodes.length);
      if (!inode.direntries.has(".")) {
        inode.nlinks++;
      }
      inode.direntries.set(".", this.inodes.length);
      inode.direntries.set("..", parentid);
      parent.nlinks++;
    } else if (this.inodes.length === 0) {
      this.inodes.push(inode);
      inode.direntries.set(".", 0);
      inode.direntries.set("..", 0);
      inode.nlinks = 2;
      return;
    }
    this.inodes.push(inode);
  }

  CreateDirectory(name, parentid) {
    const x = this.CreateInode();
    x.mode = 0x01ff | S_IFDIR;
    if (parentid >= 0) {
      x.uid = this.inodes[parentid].uid;
      x.gid = this.inodes[parentid].gid;
      x.mode = (this.inodes[parentid].mode & 0x1ff) | S_IFDIR;
    }
    x.qid.type = S_IFDIR >> 8;
    this.PushInode(x, parentid, name);
    return this.inodes.length - 1;
  }

  CreateFile(filename, parentid) {
    const x = this.CreateInode();
    x.uid = this.inodes[parentid].uid;
    x.gid = this.inodes[parentid].gid;
    x.qid.type = S_IFREG >> 8;
    x.mode = (this.inodes[parentid].mode & 0x1b6) | S_IFREG;
    this.PushInode(x, parentid, filename);
    return this.inodes.length - 1;
  }

  GetInode(id) {
    return this.inodes[id];
  }

  Search(parentid, name) {
    const childid = this.inodes[parentid].direntries.get(name);
    return childid === undefined ? -1 : childid;
  }

  IsDirectory(idx) {
    return (this.inodes[idx].mode & S_IFDIR) === S_IFDIR;
  }

  GetTotalSize() {
    return this.used_size;
  }

  GetSpace() {
    return this.total_size;
  }

  CountUsedInodes() {
    return this.inodes.length;
  }

  CountFreeInodes() {
    return 1024 * 1024;
  }

  OpenInode(id) {
    if (this.IsDirectory(id)) {
      this.FillDirectory(id);
    }
  }

  CloseInode() {
    /* no-op for in-memory */
  }

  FillDirectory(dirid) {
    const inode = this.inodes[dirid];
    let size = 0;
    for (const name of inode.direntries.keys()) {
      size += 13 + 8 + 1 + 2 + textEncoder.encode(name).length;
    }
    const data = new Uint8Array(size);
    this.inodedata.set(dirid, data);
    inode.size = size;
    let offset = 0;
    for (const [name, id] of inode.direntries) {
      const child = this.GetInode(id);
      offset += Marshall(
        ["Q", "d", "b", "s"],
        [child.qid, offset + 13 + 8 + 1 + 2 + textEncoder.encode(name).length, child.mode >> 12, name],
        data,
        offset,
      );
    }
  }

  RoundToDirentry(dirid, offsetTarget) {
    const data = this.inodedata.get(dirid);
    if (!data || offsetTarget >= data.length) {
      return data?.length ?? 0;
    }
    let offset = 0;
    while (true) {
      const state = { offset };
      const nextOffset = unmarshallQd(data, state);
      if (nextOffset > offsetTarget) {
        break;
      }
      offset = nextOffset;
    }
    return offset;
  }

  getData(idx, offset, count) {
    const data = this.inodedata.get(idx);
    if (!data) {
      return new Uint8Array(0);
    }
    if (offset >= data.length) {
      return new Uint8Array(0);
    }
    if (offset + count > data.length) {
      count = data.length - offset;
    }
    return data.subarray(offset, offset + count);
  }

  setData(idx, buffer) {
    const prev = this.inodedata.get(idx);
    if (prev) {
      this.used_size -= prev.length;
    }
    this.inodedata.set(idx, buffer);
    const inode = this.inodes[idx];
    inode.size = buffer.length;
    inode.mtime = Math.round(Date.now() / 1000);
    inode.qid.version = (inode.qid.version + 1) & 0xffff;
    this.used_size += buffer.length;
  }

  Read(inodeid, offset, count) {
    const inode = this.inodes[inodeid];
    if (offset > inode.size) {
      return new Uint8Array(0);
    }
    if (inode.size < offset + count) {
      count = inode.size - offset;
    }
    return this.getData(inodeid, offset, count);
  }

  Write(id, offset, count, buffer) {
    const inode = this.inodes[id];
    let data = this.inodedata.get(id);
    if (!data) {
      data = new Uint8Array(Math.max(offset + count, 128));
    }
    if (data.length < offset + count) {
      const grown = new Uint8Array(Math.max(offset + count, Math.floor(data.length * 1.5) || 128));
      grown.set(data);
      data = grown;
    }
    data.set(buffer.subarray(0, count), offset);
    this.setData(id, data);
    return count;
  }

  ChangeSize(idx, newsize) {
    const inode = this.inodes[idx];
    let data = this.inodedata.get(idx) ?? new Uint8Array(0);
    if (data.length < newsize) {
      const grown = new Uint8Array(newsize);
      grown.set(data);
      data = grown;
    } else if (data.length > newsize) {
      data = data.subarray(0, newsize);
    }
    this.setData(idx, data);
    inode.mtime = Math.round(Date.now() / 1000);
  }

  /** Host-side helpers (not 9p wire). */
  put(path, data) {
    const normalized = normalizePath(path);
    const parts = normalized.split("/").filter(Boolean);
    let parent = 0;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = this.Search(parent, parts[i]);
      if (next === -1) {
        parent = this.CreateDirectory(parts[i], parent);
      } else {
        parent = next;
      }
    }
    const name = parts[parts.length - 1] ?? "";
    if (!name) {
      throw new Error("host9p: put() requires a file path");
    }
    let id = this.Search(parent, name);
    if (id === -1) {
      id = this.CreateFile(name, parent);
    }
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    this.setData(id, bytes.slice());
    return normalized;
  }

  get(path) {
    const id = this.resolvePath(path);
    if (id === -1) {
      return null;
    }
    const inode = this.GetInode(id);
    if (this.IsDirectory(id)) {
      return null;
    }
    return this.getData(id, 0, inode.size);
  }

  list(path = "/") {
    const id = this.resolvePath(path);
    if (id === -1 || !this.IsDirectory(id)) {
      return [];
    }
    const names = [];
    for (const name of this.inodes[id].direntries.keys()) {
      if (name !== "." && name !== "..") {
        names.push(name);
      }
    }
    return names;
  }

  resolvePath(path) {
    const parts = normalizePath(path).split("/").filter(Boolean);
    let idx = 0;
    for (const part of parts) {
      idx = this.Search(idx, part);
      if (idx === -1) {
        return -1;
      }
    }
    return idx;
  }
}

function normalizePath(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.replace(/\/+/g, "/");
}

/** Read dirent next-offset field (Q + d) at state.offset. */
function unmarshallQd(struct, state) {
  let offset = state.offset;
  offset += 13;
  let val = struct[offset++];
  val += struct[offset++] << 8;
  val += struct[offset++] << 16;
  val += (struct[offset++] << 24) >>> 0;
  return val;
}
