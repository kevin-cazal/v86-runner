import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {string | undefined} flag CLI override
 * @param {string} name e.g. seabios.bin
 * @param {string} root v86-runner package root
 * @returns {string}
 */
export function resolveBiosPath(flag, name, root) {
  if (flag) {
    return flag;
  }
  const candidates = [
    join(root, "public/assets", name),
    join(root, "node_modules/v86/bios", name),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return p;
    }
  }
  const flagName = name.replace(".bin", "");
  console.error(
    `Missing ${name}; run npm run prepare or pass --${flagName}`,
  );
  process.exit(1);
}
