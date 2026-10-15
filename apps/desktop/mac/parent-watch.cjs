// LightMap for Mac: loaded into the server with `node --require`. macOS has no job objects, so
// the server watches the app that started it and ends within two seconds of it going away
// (a crash or a Force Quit included). The app passes its pid in LIGHTMAP_PARENT_PID.
'use strict';
const parent = Number(process.env.LIGHTMAP_PARENT_PID);
if (parent > 0) {
  const timer = setInterval(() => {
    if (process.ppid === 1) process.exit(0); // re-parented to launchd: the app is gone
    try {
      process.kill(parent, 0);
    } catch (error) {
      if (error && error.code === 'ESRCH') process.exit(0);
    }
  }, 2000);
  timer.unref();
}
