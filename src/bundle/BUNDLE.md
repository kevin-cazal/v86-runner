# V86B bundle format

Magic `V86B` (0x42363856), extension `.v86b`.

**Version 1:** 64-byte header, seabios, vgabios, raw disk, zstd(v86 save_state).

Pack: `npm run pack-bundle` → `scripts/pack-v86-bundle.mjs`
