#!/usr/bin/env node
/**
 * Pack BIOS + raw disk + v86 save_state into a V86B bundle (.v86b).
 *
 * Usage:
 *   node scripts/pack-v86-bundle.mjs --disk alpine.img --state game.v86state -o game.v86b
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  computeV86BundleOffsets,
  encodeV86BundleHeader,
  V86B_DEFAULT_MEMORY,
} from "../src/bundle/format.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const { values } = parseArgs({
  options: {
    disk: { type: "string" },
    state: { type: "string" },
    output: { type: "string", short: "o" },
    memory: { type: "string", default: String(V86B_DEFAULT_MEMORY) },
    seabios: { type: "string" },
    vgabios: { type: "string" },
  },
});

const diskPath = values.disk;
const statePath = values.state;
const outPath = values.output;
const memorySize = Number(values.memory);

if (!diskPath || !statePath || !outPath) {
  console.error(
    "Usage: pack-v86-bundle.mjs --disk DISK.img --state SNAP.v86state -o OUT.v86b [--seabios PATH] [--vgabios PATH]",
  );
  process.exit(1);
}

function resolveBiosPath(flag, name) {
  if (flag) {
    return flag;
  }
  const candidates = [
    join(ROOT, "public/assets", name),
    join(ROOT, "node_modules/v86/bios", name),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return p;
    }
  }
  console.error(`Missing ${name}; run npm run prepare or pass --${name.replace(".bin", "")}`);
  process.exit(1);
}

const seabiosPath = resolveBiosPath(values.seabios, "seabios.bin");
const vgabiosPath = resolveBiosPath(values.vgabios, "vgabios.bin");
const seabios = readFileSync(seabiosPath);
const vgabios = readFileSync(vgabiosPath);
const disk = readFileSync(diskPath);
let stateRaw = readFileSync(statePath);

if (statePath.endsWith(".zst")) {
  try {
    stateRaw = execFileSync("zstd", ["-d", "-c", statePath], {
      maxBuffer: 2 * 1024 * 1024 * 1024,
    });
  } catch (e) {
    console.error("zstd decompress failed; install zstd or pass raw .v86state", e);
    process.exit(1);
  }
} else {
  try {
    stateRaw = execFileSync("zstd", ["-19", "-c", "-"], {
      input: stateRaw,
      maxBuffer: 2 * 1024 * 1024 * 1024,
    });
  } catch (e) {
    console.error("zstd compress failed; install zstd", e);
    process.exit(1);
  }
}

const { seabiosOffset, vgabiosOffset, diskOffset, stateOffset } =
  computeV86BundleOffsets(seabios.length, vgabios.length, disk.length, stateRaw.length);

const header = encodeV86BundleHeader({
  memorySize,
  seabiosSize: seabios.length,
  vgabiosSize: vgabios.length,
  diskSize: disk.length,
  stateZstdSize: stateRaw.length,
  seabiosOffset,
  vgabiosOffset,
  diskOffset,
  stateOffset,
  v86StateVersion: 6,
  flags: 0,
});

const total = stateOffset + stateRaw.length;
const out = Buffer.alloc(total);
Buffer.from(header).copy(out, 0);
seabios.copy(out, seabiosOffset);
vgabios.copy(out, vgabiosOffset);
disk.copy(out, diskOffset);
stateRaw.copy(out, stateOffset);

writeFileSync(outPath, out);
console.log(
  `Wrote ${outPath} (V86B v2): seabios ${seabios.length}, vgabios ${vgabios.length}, disk ${disk.length}, state zstd ${stateRaw.length}, total ${total}`,
);
