# LightMap for Windows and Mac

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

# LightMap for Mac

The same app for macOS 12 or later on Apple Silicon (`mac/`): a disk image to drag into
Applications, its own window, and updates that install themselves.

- **LightMap.app** (`mac/Sources/*.swift`, AppKit + WebKit, no Xcode project) opens a window at
  once, starts the server, and shows the app when it answers. It has the Mac menus a person
  expects (Edit for copy and paste, View → Reload, Help → Show Logs), shows the page's dialogs,
  and saves downloads (the planning card, the shot list) to Downloads.
- **The server** is the same standalone build run by a bundled `node`
  (`Contents/Resources/runtime`), on `http://127.0.0.1:47615`. macOS has no job objects, so
  `runtime/parent-watch.cjs` ends the server within two seconds of the app going away, a crash or
  a Force Quit included.

| What                                     | Where                                                 |
| ---------------------------------------- | ----------------------------------------------------- |
| The program                              | `/Applications/LightMap.app`                          |
| Saved places and settings (WebKit store) | `~/Library/WebKit/us.lightmap.desktop`                |
| Logs (`desktop.log`, `update.log`)       | `~/Library/Logs/LightMap`                             |
| Staged updates                           | `~/Library/Application Support/LightMap/updates`      |
| Optional server settings                 | `~/Library/Application Support/LightMap/lightmap.env` |

**Updates.** Twenty seconds after launch, and every six hours, the app asks for the latest
release. If it is newer and carries `LightMap-<version>-mac-arm64.zip` and its `.sha256`, the zip
is downloaded and kept only if its SHA-256 matches; a bar says it is ready. When LightMap quits, a
small script waits for it to be gone, unpacks the zip and swaps the new bundle in (the old one is
kept until the new one is in place); **Restart now** does it at once. Only a copy in an
Applications folder this user can write updates itself: one run straight from the disk image or
from Downloads (which macOS runs from a randomised read-only path) does not.

**Signing.** The app is signed ad hoc, not with an Apple Developer ID, and it is not notarized.
The first time, macOS says it cannot check LightMap; **System Settings › Privacy & Security →
Open Anyway** opens it, once. Updates do not ask again (the app downloads them itself, so they
carry no quarantine flag). A Developer ID ($99 a year) and notarization would remove that step.

**Built by** the `mac` job of `.github/workflows/desktop.yml` on `macos-latest`: the hoisted
install and the standalone web build, then `mac/build-app.sh <version>` (stages the server with
`scripts/stage.mjs --target mac`, compiles the shell with `swiftc`, writes the icon and
Info.plist, signs, and makes the zip and the disk image), `--selftest` on the built app, an
install from the disk image with `--selftest` again, and a real self-update: a staged update to a
higher version is installed at launch and the app reopens as that version, then a Force Quit
proves the server ends with it. On a tag, a `publish` job puts the Windows and Mac files on the
release and only then marks it latest.

Intel Macs are not built yet (GitHub's Intel runners are being retired); `build-app.sh` builds
for whichever processor it runs on, so an Intel build is one more job when wanted.
