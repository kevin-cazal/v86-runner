# v86-runner

Browser UI to run a raw BIOS disk image with [v86](https://github.com/copy/v86) and an xterm serial console (virtio `hvc0`).

Does not ship BIOS, wasm, or disk images — stage them under `public/` yourself or use a product repo such as [shell-rpg](https://github.com/kevin-cazal/shell-rpg).

## Prerequisites

- Node.js 20+

## Develop

Stage assets under `public/` first (`v86.wasm`, `public/assets/seabios.bin`, `public/assets/vgabios.bin` — from `node_modules/v86` after `npm install`, or from [copy/v86](https://github.com/copy/v86)).

```sh
npm install
npm run dev
```

## Build static site

```sh
npm run build
npm run preview
```

## Plugin API

Import `./app.js` from a custom entry, or call `registerPluginMenu` from `src/menu/` (see source).
