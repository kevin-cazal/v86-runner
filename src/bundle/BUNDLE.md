# V86B bundle format

Magic `V86B` (0x42363856), extension `.v86b`.

**Version 1:** 64-byte header, seabios, vgabios, raw disk, zstd(v86 save_state).

## Automated build (recommended)

After building the disk image (guest `.profile` must include `splash-ready` / `state-ready` bridge hooks):

```sh
# memory_size in the header must match the VM RAM used when the snapshot was taken
VITE_VM_MEMORY_MB=256 npm run build-bundle -- \
  --disk alpine-bios-256M.img \
  -o shell-rpg-256M.v86b
```

This runs `build-v86-state.mjs` (headless v86 boot on **serial0**, vm-bridge on **hvc1**) then `pack-v86-bundle.mjs`. Serial output is streamed live to the terminal. After `state-ready`, the host waits 1s before `save_state()`.

Requires `zstd`, staged BIOS (`npm run prepare` in shell-rpg), and `npm install` in v86-runner.

## Pack only (manual snapshot)

If you already have a `.v86state` from the browser menu (**Save memory…**):

```sh
VITE_VM_MEMORY_MB=256 npm run pack-bundle -- \
  --disk alpine-bios-256M.img \
  --state alpine-bios-256M.v86state \
  -o shell-rpg-256M.v86b
```

`pack-v86-bundle.mjs` defaults `--memory` from `VITE_VM_MEMORY_MB` (else 256 MiB).
