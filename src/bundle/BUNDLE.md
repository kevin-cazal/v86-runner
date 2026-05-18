# V86B bundle format

Magic `V86B` (0x42363856), extension `.v86b`.

**Version 1:** 64-byte header, seabios, vgabios, raw disk, zstd(v86 save_state).

Pack:

```sh
# memory_size in the header must match the VM RAM used when the snapshot was taken
VITE_VM_MEMORY_MB=256 npm run pack-bundle -- \
  --disk alpine-bios-256M.img \
  --state alpine-bios-256M.v86state \
  -o shell-rpg-256M.v86b
```

`pack-v86-bundle.mjs` defaults `--memory` from `VITE_VM_MEMORY_MB` (else 512 MiB).
