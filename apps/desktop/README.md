# LightMap for Windows

LightMap as a Windows app: an installer, a Start-menu entry, its own window, and updates that
install themselves. It is the same LightMap the web build serves, run on the PC:

- **LightMap.exe** (`LightMap.Desktop/`, .NET 10 WinForms + WebView2) opens a window at once,
  starts the server, and shows the app when the server answers.
- **The server** is Next's standalone output of `apps/web`, run by a bundled `node.exe` on
  `http://127.0.0.1:47615`, loopback only, with `LIGHTMAP_STANDALONE=true` (no database, no
  accounts; the map and planning work). It runs in a Windows job object, so it never outlives the
  window.
- **The installer** (`installer/lightmap-setup.iss`, Inno Setup 6) installs for the current user
  under `%LOCALAPPDATA%\Programs\LightMap`, with no administrator prompt.

## Where things live

| What                                                | Where                                  |
| --------------------------------------------------- | -------------------------------------- |
| The program                                         | `%LOCALAPPDATA%\Programs\LightMap`     |
| Saved places and settings (the WebView2 profile)    | `%LOCALAPPDATA%\LightMap\WebView2`     |
| Logs (`desktop.log`, `selftest.log`, `setup-*.log`) | `%LOCALAPPDATA%\LightMap\logs`         |
| Staged updates                                      | `%LOCALAPPDATA%\LightMap\updates`      |
| Optional server settings                            | `%LOCALAPPDATA%\LightMap\lightmap.env` |

Installing, updating and uninstalling replace the program only; `%LOCALAPPDATA%\LightMap` stays.
`lightmap.env` takes the keys `.env.example` documents (`CESIUM_ION_TOKEN`, `IMAGERY_PROVIDER`,
`LANDCOVER_*`, ...), one `KEY=VALUE` per line; restart LightMap after editing it. The window menu
(Alt+Space, or right-click the title bar) has Reload, Open in browser, Open LightMap's data folder,
Check for updates and About.

The fixed port matters: the app keeps saved places in the page's storage, which belongs to the
origin. Places saved in a browser at `http://localhost:3000` are a different origin and do not
appear in the app.

## Updates

1. Twenty seconds after launch, and every six hours, the app asks GitHub for the latest release
   of `the-x1x1/lightmap`. If it is newer and carries `LightMap-Setup-<version>.exe` and
   `LightMap-Setup-<version>.exe.sha256`, the installer is downloaded in the background and kept
   only if its SHA-256 matches. A bar says it is ready.
2. When LightMap closes, the staged installer runs silently (`/VERYSILENT ... /nolaunch=1`); the
   next launch is the new version. **Restart now** on the bar does it at once and reopens the app.
   A launch that finds an update still staged (the PC shut down first) installs it then, once.
3. Setup waits for the app to be gone (it watches the `Local\LightMapDesktopShell` mutex) before
   replacing files, and replaces `server\` and `runtime\` whole.

Only an installed copy updates itself: the installer writes `.lightmap-installed` beside the exe.
The hash guards against a damaged or swapped download; it is not a code signature, and the
installer is not signed yet, so Windows SmartScreen may warn on the first manual install.

## How it is built

`.github/workflows/desktop.yml`, on `windows-latest`, for every push to `main` and every `v*` tag:

1. `pnpm install --config.node-linker=hoisted` (real files, no links, for the installer);
2. `LIGHTMAP_DESKTOP=1 pnpm --filter @lightmap/web build`, which turns on Next's standalone output;
3. `dotnet publish` of `LightMap.Desktop` (self-contained, single file, `-p:Version=<release>`);
4. `node apps/desktop/scripts/stage.mjs` assembles `apps/desktop/stage` (shell, `runtime\node.exe`,
   `server\`), including geo-tz's boundary data, which file tracing cannot see;
5. `LightMap.exe --selftest` on the staged app: the server starts, the page and a client script
   are served, Cesium's assets, place labels, a geoid tile, the service worker and the manifest
   answer, and a time-zone lookup for Honolulu says `Pacific/Honolulu`;
6. Inno Setup compiles `LightMap-Setup-<version>.exe` and its `.sha256`;
7. a silent install, then `--selftest` again on the installed copy;
8. the installer is kept as a workflow artifact; on a tag it is attached to the GitHub release,
   which then becomes "latest" (the moment installed copies can see it).

By hand on Windows (needs the .NET 10 SDK and Inno Setup 6; do it in a separate clone, since the
hoisted install changes `node_modules`):

```powershell
corepack pnpm@10.28.0 install --frozen-lockfile --config.node-linker=hoisted
$env:LIGHTMAP_DESKTOP = '1'; corepack pnpm@10.28.0 --filter @lightmap/web build; Remove-Item Env:LIGHTMAP_DESKTOP
dotnet publish apps/desktop/LightMap.Desktop/LightMap.Desktop.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=none -p:Version=0.3.0 -o apps/desktop/publish
$node = (Get-Command node).Source; node apps/desktop/scripts/stage.mjs --node $node --shell apps/desktop/publish
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" /DAppVersion=0.3.0 apps\desktop\installer\lightmap-setup.iss
```

`apps/desktop` has no `package.json` on purpose: it is not a pnpm workspace package, and pnpm,
turbo and the web build never touch it.
