/** 9p2000.L constants (from copy/v86 lib/9p.js). */

export const ENOENT = 2;
export const EOPNOTSUPP = 95;

export const S_IFREG = 0x8000;
export const S_IFDIR = 0x4000;

export const FID_NONE = -1;
export const FID_INODE = 1;

export const P9_SETATTR_MODE = 0x00000001;
export const P9_SETATTR_UID = 0x00000002;
export const P9_SETATTR_GID = 0x00000004;
export const P9_SETATTR_SIZE = 0x00000008;
export const P9_SETATTR_ATIME = 0x00000010;
export const P9_SETATTR_MTIME = 0x00000020;
export const P9_SETATTR_CTIME = 0x00000040;
export const P9_SETATTR_ATIME_SET = 0x00000080;
export const P9_SETATTR_MTIME_SET = 0x00000100;

/** Fields we always marshal in Tgetattr (linux/fs/9p). */
export const P9_STATS_SIZE = 0x00000080;

export const P9_MSG_NAMES = {
  8: "Tstatfs",
  12: "Tlopen",
  14: "Tlcreate",
  24: "Tgetattr",
  26: "Tsetattr",
  40: "Treaddir",
  50: "Tfsync",
  72: "Tmkdir",
  76: "Tunlinkat",
  100: "Tversion",
  104: "Tattach",
  108: "Tflush",
  110: "Twalk",
  116: "Tread",
  118: "Twrite",
  120: "Tclunk",
};

export const VERSION = "9P2000.L";
export const MAX_REPLYBUFFER_SIZE = 16 * 1024 * 1024;
