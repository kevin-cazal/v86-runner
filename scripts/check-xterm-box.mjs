#!/usr/bin/env node
/**
 * Feed player box output into xterm (same options as app.js) and verify each
 * buffer row uses at most term.cols cells (catches wcwidth / emoji drift).
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/xterm");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECK_PY = path.resolve(__dirname, "../../scripts/check-player-box.py");

function lineCellWidth(term, rowIndex) {
  const line = term.buffer.active.getLine(rowIndex);
  if (!line) {
    return 0;
  }
  let w = 0;
  for (let i = 0; i < line.length; i++) {
    const cell = line.getCell(i);
    if (!cell) {
      continue;
    }
    const ch = cell.getChars();
    if (!ch) {
      continue;
    }
    w += cell.getWidth() || 1;
  }
  return w;
}

function checkCols(cols) {
  const dom = new JSDOM(
    `<!DOCTYPE html><motion><motion id="host" style="width:900px;height:600px"></motion></motion>`,
  );
  const host = dom.window.document.getElementById("host");
  const term = new Terminal({
    fontFamily: '"IBM Plex Mono", "Liberation Mono", "Noto Sans Mono", monospace',
    fontSize: 14,
    lineHeight: 1.15,
    letterSpacing: 0,
    customGlyphs: true,
  });
  term.open(host);
  term.resize(cols, 48);

  const gen = spawnSync("python3", [CHECK_PY, String(cols)], {
    encoding: "utf-8",
  });
  if (gen.status !== 0) {
    console.error(gen.stderr || gen.stdout);
    process.exit(1);
  }
  term.write(gen.stdout.replace(/\n/g, "\r\n"));

  const failures = [];
  const buf = term.buffer.active;
  for (let y = 0; y < buf.length; y++) {
    const w = lineCellWidth(term, y);
    if (w === 0) {
      continue;
    }
    if (w > cols) {
      const line = buf.getLine(y);
      let s = "";
      for (let i = 0; i < line.length; i++) {
        const c = line.getCell(i)?.getChars();
        if (c) {
          s += c;
        }
      }
      failures.push({ y, w, text: s });
    }
  }
  return failures;
}

function main() {
  let anyFail = false;
  for (const cols of [60, 70, 78, 80, 100, 120]) {
    const failures = checkCols(cols);
    if (failures.length) {
      anyFail = true;
      console.log(`FAIL cols=${cols}:`);
      for (const f of failures) {
        console.log(`  row ${f.y}: ${f.w} cells: ${JSON.stringify(f.text)}`);
      }
    }
  }
  if (!anyFail) {
    console.log("OK: xterm buffer rows fit within cols for tested sizes");
  } else {
    process.exit(1);
  }
}

main();
