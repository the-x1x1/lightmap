# Local runner

Tests a stack of commits on your own machine before it is pushed: every commit against CI's
checks, and the newest one built and served so it can be opened and used on a real GPU.

```
Downloads\
  lightmap-stack.patch        git format-patch --stdout <base>..HEAD
  lightmap-stack.json         { "base": "<sha>", "commits": [{ "sha", "tree", "subject" }] }
  lightmap-runner\
    start-lightmap-runner.cmd double-click to start
    runner.mjs
```

Each time the patch changes, the runner:

1. applies it on its base in a scratch clone of your local repository
   (`%USERPROFILE%\lightmap-runner-work`, cloned from `%USERPROFILE%\lightmap-push`) and checks
   that every commit's tree is the one `lightmap-stack.json` describes. It never writes to the
   repository it clones from, and it never pushes;
2. builds the newest commit as the desktop app is built (`LIGHTMAP_DESKTOP=1`, staged by
   `apps/desktop/scripts/stage.mjs --target server`) and serves it at `http://127.0.0.1:47700`
   with the desktop app's own settings file (`%LOCALAPPDATA%\LightMap\lightmap.env`), and serves
   the renderer smoke page at `http://127.0.0.1:47701/index.html?drive=self` (it saves its own
   shots and result: see `tools/renderer-smoke`). Both listen on the loopback address only;
3. runs CI's checks on every commit, newest first - `format:check`, `lint`, `typecheck`,
   `test:unit` - and on the newest also the rest of CI's validate job (env, attribution,
   licences, secrets, migrations, `pnpm build`, the bundle gate). A tree checked once is not
   checked again. A step whose only fault is Node crashing on its way out (libuv's
   `UV_HANDLE_CLOSING` assertion on Windows) is run once more before it counts as failed.

It writes beside itself: `status.json` (what it is doing, what is served, which commits fail
which checks), `results.json` (every step of every commit), `logs/` (a failing step's log, and
its last 120 lines as `.tail.txt`), `harness/<tree>/` (the smoke page's shots) and `runner.log`.

A file dropped in `inbox\` asks for something: `rebuild.json` (build and serve again),
`recheck.json` (forget the results; `{"tree": "<sha>"}` for one commit), `integration.json`
(CI's integration job on the newest commit, below), `stop.json`. Replacing
`runner.mjs` makes the runner start again with the new one (the window you started keeps a
worker running and starts the new file when the old worker leaves).

It needs Node 22, git, and pnpm (or corepack, which Node ships). CI's `integration` job - the
migrations, the database's integration tests and the Playwright suite - runs only when asked
(`inbox\integration.json`) and needs Docker Desktop running: it pulls `postgres:16` (once,
about 150 MB), runs it as the container `lightmap-runner-pg` on a free port of 127.0.0.1 and removes it
afterwards (PostGIS, CI's image, is optional to the migrations), and runs the Playwright suite
in this machine's Microsoft Edge rather than downloading Chromium. Results in
`integration.json` and `logs/integration-*.log`; each failing test's page snapshot, and the
first one's trace, in `e2e-results\`. `{"grep": "Kailua", "project": "desktop-chromium"}` in the
request runs part of the suite.

Settings, as environment variables: `LM_PATCH`, `LM_META`, `LM_SOURCE`, `LM_WORK`,
`LM_APP_PORT`, `LM_HARNESS_PORT`, `LM_ENV_FILE`, `LM_PNPM`.
