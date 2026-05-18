#!/usr/bin/env node
/**
 * Build .v86state headlessly, then pack into .v86b.
 *
 * Usage:
 *   node scripts/build-v86-bundle.mjs --disk alpine.img -o game.v86b
 */
import { spawnSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    disk: { type: "string" },
    output: { type: "string", short: "o" },
    state: { type: "string" },
    memory: { type: "string" },
    timeout: { type: "string" },
    seabios: { type: "string" },
    vgabios: { type: "string" },
    "keep-state": { type: "boolean", default: true },
  },
});

const diskPath = values.disk;
const outPath = values.output;
const statePath =
  values.state ??
  (diskPath ? diskPath.replace(/\.img$/i, ".v86state") : undefined);

if (!diskPath || !outPath || !statePath) {
  console.error(
    "Usage: build-v86-bundle.mjs --disk DISK.img -o OUT.v86b [--state SNAP.v86state] [--no-keep-state]",
  );
  process.exit(1);
}

function runNode(script, args) {
  const r = spawnSync(process.execPath, [join(__dirname, script), ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

const stateArgs = ["--disk", diskPath, "-o", statePath, ...positionals];
if (values.memory) stateArgs.push("--memory", values.memory);
if (values.timeout) stateArgs.push("--timeout", values.timeout);
if (values.seabios) stateArgs.push("--seabios", values.seabios);
if (values.vgabios) stateArgs.push("--vgabios", values.vgabios);

runNode("build-v86-state.mjs", stateArgs);

const packArgs = ["--disk", diskPath, "--state", statePath, "-o", outPath];
if (values.memory) packArgs.push("--memory", values.memory);
if (values.seabios) packArgs.push("--seabios", values.seabios);
if (values.vgabios) packArgs.push("--vgabios", values.vgabios);

runNode("pack-v86-bundle.mjs", packArgs);

if (values["keep-state"] === false) {
  try {
    unlinkSync(statePath);
  } catch {
    /* ignore */
  }
}
