# V86B bundle format

Magic `V86B` (0x42363856), extension `.v86b`.

Version 2 layout: 64-byte header, seabios, vgabios, raw disk, zstd(v86 save_state).

Pack: `npm run pack-bundle` → `scripts/pack-v86-bundle.mjs`

Legacy `.srpg1` / `SRG1` magic from early Shell RPG experiments is still accepted when loading.
