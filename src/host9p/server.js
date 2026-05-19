/**
 * 9p2000.L server for v86 handle9p (adapted from copy/v86 lib/9p.js).
 */

import { Marshall, Unmarshall } from "./marshall.js";
import {
  ENOENT,
  EOPNOTSUPP,
  FID_INODE,
  FID_NONE,
  MAX_REPLYBUFFER_SIZE,
  P9_SETATTR_ATIME,
  P9_SETATTR_ATIME_SET,
  P9_SETATTR_CTIME,
  P9_SETATTR_GID,
  P9_SETATTR_MODE,
  P9_SETATTR_MTIME,
  P9_SETATTR_MTIME_SET,
  P9_SETATTR_SIZE,
  P9_SETATTR_UID,
  P9_STATS_SIZE,
  VERSION,
} from "./constants.js";
import { logHost9pError, logHost9pRequest } from "./debug.js";

export class Host9pServer {
  /**
   * @param {import("./vfs.js").Host9pVfs} fs
   */
  constructor(fs) {
    this.fs = fs;
    this.VERSION = VERSION;
    this.BLOCKSIZE = 8192;
    this.msize = 8192;
    this.replybuffer = new Uint8Array(this.msize * 2);
    this.replybuffersize = 0;
    /** @type {Array<{ inodeid: number, type: number, uid: number, dbg_name: string } | undefined>} */
    this.fids = [];
  }

  Createfid(inodeid, type, uid, dbg_name) {
    return { inodeid, type, uid, dbg_name };
  }

  BuildReply(id, tag, payloadsize) {
    Marshall(["w", "b", "h"], [payloadsize + 7, id + 1, tag], this.replybuffer, 0);
    this.replybuffersize = payloadsize + 7;
  }

  SendError(tag, errorcode) {
    const size = Marshall(["w"], [errorcode], this.replybuffer, 7);
    this.BuildReply(6, tag, size);
  }

  /** Copy so virtio can finish the reply before the next request reuses replybuffer. */
  copyReply() {
    return new Uint8Array(
      this.replybuffer.subarray(0, this.replybuffersize),
    );
  }

  /**
   * @param {Uint8Array} buffer
   * @returns {Uint8Array}
   */
  handle(buffer) {
    const state = { offset: 0 };
    const header = Unmarshall(["w", "b", "h"], buffer, state);
    const id = header[1];
    const tag = header[2];

    try {
      return this.dispatch(id, tag, buffer, state);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logHost9pError(id, tag, msg);
      this.SendError(tag, EOPNOTSUPP);
      return this.copyReply();
    }
  }

  /**
   * @param {number} id
   * @param {number} tag
   * @param {Uint8Array} buffer
   * @param {{ offset: number }} state
   */
  dispatch(id, tag, buffer, state) {
    let size;
    let req;
    let fid;
    let inode;
    let idx;
    let count;
    let offset;
    let data;

    switch (id) {
      case 8: {
        logHost9pRequest(id, tag);
        const total = this.fs.GetTotalSize();
        const space = this.fs.GetSpace();
        const statReq = [0x01021997, this.BLOCKSIZE];
        statReq[2] = Math.floor(space / statReq[1]);
        statReq[3] = statReq[2] - Math.floor(total / statReq[1]);
        statReq[4] = statReq[3];
        statReq[5] = this.fs.CountUsedInodes();
        statReq[6] = this.fs.CountFreeInodes();
        statReq[7] = 0;
        statReq[8] = 256;
        size = Marshall(
          ["w", "w", "d", "d", "d", "d", "d", "d", "w"],
          statReq,
          this.replybuffer,
          7,
        );
        this.BuildReply(id, tag, size);
        break;
      }

      case 12:
      case 112: {
        req = Unmarshall(["w", "w"], buffer, state);
        fid = req[0];
        logHost9pRequest(id, tag, { path: this.fids[fid]?.dbg_name });
        idx = this.fids[fid].inodeid;
        inode = this.fs.GetInode(idx);
        this.fs.OpenInode(idx);
        Marshall(["Q", "w"], [inode.qid, this.msize - 24], this.replybuffer, 7);
        this.BuildReply(id, tag, 17);
        break;
      }

      case 14: {
        req = Unmarshall(["w", "s", "w", "w", "w"], buffer, state);
        fid = req[0];
        const name = req[1];
        const mode = req[3];
        const gid = req[4];
        logHost9pRequest(id, tag, { path: name });
        idx = this.fs.CreateFile(name, this.fids[fid].inodeid);
        this.fids[fid] = this.Createfid(idx, FID_INODE, this.fids[fid].uid, name);
        inode = this.fs.GetInode(idx);
        inode.gid = gid;
        inode.mode = mode | 0x8000;
        Marshall(["Q", "w"], [inode.qid, this.msize - 24], this.replybuffer, 7);
        this.BuildReply(id, tag, 17);
        break;
      }

      case 24: {
        req = Unmarshall(["w", "d"], buffer, state);
        fid = req[0];
        inode = this.fs.GetInode(this.fids[fid].inodeid);
        if (!inode) {
          logHost9pError(id, tag, "ENOENT");
          this.SendError(tag, ENOENT);
          break;
        }
        const responseValid = Number(req[1]) | P9_STATS_SIZE;
        logHost9pRequest(id, tag, {
          path: this.fids[fid]?.dbg_name,
          valid: responseValid,
          size: inode.size,
        });
        // Must match copy/v86 lib/9p.js Tgetattr field order exactly (20 fields).
        const attr = [
          responseValid,
          inode.qid,
          inode.mode,
          inode.uid,
          inode.gid,
          inode.nlinks,
          (inode.major << 8) | (inode.minor),
          inode.size,
          this.BLOCKSIZE,
          Math.floor(inode.size / 512 + 1),
          inode.atime,
          0,
          inode.mtime,
          0,
          inode.ctime,
          0,
          0, // btime
          0,
          0, // st_gen
          0, // data_version
        ];
        Marshall(
          [
            "d",
            "Q",
            "w",
            "w",
            "w",
            "d",
            "d",
            "d",
            "d",
            "d",
            "d",
            "d",
            "d",
            "d",
            "d",
            "d",
            "d",
            "d",
            "d",
            "d",
          ],
          attr,
          this.replybuffer,
          7,
        );
        this.BuildReply(id, tag, 153);
        break;
      }

      case 26: {
        req = Unmarshall("wwwwwddddd".split(""), buffer, state);
        fid = req[0];
        inode = this.fs.GetInode(this.fids[fid].inodeid);
        logHost9pRequest(id, tag, { path: this.fids[fid]?.dbg_name });
        if (req[1] & P9_SETATTR_MODE) {
          inode.mode = req[2];
        }
        if (req[1] & P9_SETATTR_UID) {
          inode.uid = req[3];
        }
        if (req[1] & P9_SETATTR_GID) {
          inode.gid = req[4];
        }
        if (req[1] & P9_SETATTR_ATIME) {
          inode.atime = Math.floor(Date.now() / 1000);
        }
        if (req[1] & P9_SETATTR_MTIME) {
          inode.mtime = Math.floor(Date.now() / 1000);
        }
        if (req[1] & P9_SETATTR_CTIME) {
          inode.ctime = Math.floor(Date.now() / 1000);
        }
        if (req[1] & P9_SETATTR_ATIME_SET) {
          inode.atime = req[6];
        }
        if (req[1] & P9_SETATTR_MTIME_SET) {
          inode.mtime = req[8];
        }
        if (req[1] & P9_SETATTR_SIZE) {
          this.fs.ChangeSize(this.fids[fid].inodeid, req[5]);
        }
        this.BuildReply(id, tag, 0);
        break;
      }

      case 40:
      case 116: {
        req = Unmarshall(["w", "d", "w"], buffer, state);
        fid = req[0];
        offset = req[1];
        count = req[2];
        idx = this.fids[fid].inodeid;
        inode = this.fs.GetInode(idx);
        if (!inode) {
          logHost9pError(id, tag, "ENOENT");
          this.SendError(tag, ENOENT);
          break;
        }
        this.fs.OpenInode(idx);
        count = Math.min(count, this.replybuffer.length - 11);
        if (offset >= inode.size) {
          count = 0;
        } else if (inode.size < offset + count) {
          count = inode.size - offset;
        }
        if (id === 40 && this.fs.IsDirectory(idx)) {
          count = this.fs.RoundToDirentry(idx, offset + count) - offset;
          count = Math.max(0, count);
        }
        data = this.fs.Read(idx, offset, count);
        if (count > 0 && data?.length) {
          this.replybuffer.set(data.subarray(0, count), 11);
        }
        logHost9pRequest(id, tag, {
          path: this.fids[fid]?.dbg_name,
          offset,
          count,
          size: inode.size,
        });
        Marshall(["w"], [count], this.replybuffer, 7);
        this.BuildReply(id, tag, 4 + count);
        break;
      }

      case 118: {
        req = Unmarshall(["w", "d", "w"], buffer, state);
        fid = req[0];
        offset = req[1];
        count = req[2];
        logHost9pRequest(id, tag, { path: this.fids[fid]?.dbg_name });
        this.fs.Write(
          this.fids[fid].inodeid,
          offset,
          count,
          buffer.subarray(state.offset),
        );
        Marshall(["w"], [count], this.replybuffer, 7);
        this.BuildReply(id, tag, 4);
        break;
      }

      case 72: {
        req = Unmarshall(["w", "s", "w", "w"], buffer, state);
        fid = req[0];
        const dirName = req[1];
        const mode = req[2];
        const gid = req[4];
        logHost9pRequest(id, tag, { path: dirName });
        idx = this.fs.CreateDirectory(dirName, this.fids[fid].inodeid);
        inode = this.fs.GetInode(idx);
        inode.mode = mode | 0x4000;
        inode.gid = gid;
        Marshall(["Q"], [inode.qid], this.replybuffer, 7);
        this.BuildReply(id, tag, 13);
        break;
      }

      case 76: {
        req = Unmarshall(["w", "s", "w"], buffer, state);
        logHost9pRequest(id, tag, { path: req[1] });
        this.BuildReply(id, tag, 0);
        break;
      }

      case 100: {
        const version = Unmarshall(["w", "s"], buffer, state);
        logHost9pRequest(id, tag);
        if (this.msize !== version[0]) {
          this.msize = version[0];
          this.replybuffer = new Uint8Array(
            Math.min(MAX_REPLYBUFFER_SIZE, this.msize * 2),
          );
        }
        size = Marshall(["w", "s"], [this.msize, this.VERSION], this.replybuffer, 7);
        this.BuildReply(id, tag, size);
        break;
      }

      case 104: {
        req = Unmarshall(["w", "w", "s", "s", "w"], buffer, state);
        fid = req[0];
        const uid = req[4];
        logHost9pRequest(id, tag, { path: "/" });
        this.fids[fid] = this.Createfid(0, FID_INODE, uid, "");
        inode = this.fs.GetInode(0);
        Marshall(["Q"], [inode.qid], this.replybuffer, 7);
        this.BuildReply(id, tag, 13);
        break;
      }

      case 108: {
        logHost9pRequest(id, tag);
        this.BuildReply(id, tag, 0);
        break;
      }

      case 110: {
        req = Unmarshall(["w", "w", "h"], buffer, state);
        fid = req[0];
        const nwfid = req[1];
        const nwname = req[2];
        if (nwname === 0) {
          logHost9pRequest(id, tag, { path: this.fids[fid]?.dbg_name });
          this.fids[nwfid] = this.Createfid(
            this.fids[fid].inodeid,
            FID_INODE,
            this.fids[fid].uid,
            this.fids[fid].dbg_name,
          );
          Marshall(["h"], [0], this.replybuffer, 7);
          this.BuildReply(id, tag, 2);
          break;
        }
        const wnames = [];
        for (let i = 0; i < nwname; i++) {
          wnames.push("s");
        }
        const walk = Unmarshall(wnames, buffer, state);
        logHost9pRequest(id, tag, { path: walk.join("/") });
        idx = this.fids[fid].inodeid;
        let replyOffset = 7 + 2;
        let nwidx = 0;
        for (let i = 0; i < nwname; i++) {
          idx = this.fs.Search(idx, walk[i]);
          if (idx === -1) {
            break;
          }
          replyOffset += Marshall(
            ["Q"],
            [this.fs.GetInode(idx).qid],
            this.replybuffer,
            replyOffset,
          );
          nwidx++;
          this.fids[nwfid] = this.Createfid(idx, FID_INODE, this.fids[fid].uid, walk[i]);
        }
        Marshall(["h"], [nwidx], this.replybuffer, 7);
        this.BuildReply(id, tag, replyOffset - 7);
        break;
      }

      case 120: {
        req = Unmarshall(["w"], buffer, state);
        fid = req[0];
        logHost9pRequest(id, tag, { path: this.fids[fid]?.dbg_name });
        if (this.fids[fid] && this.fids[fid].inodeid >= 0) {
          this.fs.CloseInode(this.fids[fid].inodeid);
          this.fids[fid].inodeid = -1;
          this.fids[fid].type = FID_NONE;
        }
        this.BuildReply(id, tag, 0);
        break;
      }

      case 50: {
        logHost9pRequest(id, tag);
        this.BuildReply(id, tag, 0);
        break;
      }

      default:
        logHost9pRequest(id, tag);
        logHost9pError(id, tag, `unknown message ${id}`);
        this.SendError(tag, EOPNOTSUPP);
        break;
    }

    return this.copyReply();
  }
}
