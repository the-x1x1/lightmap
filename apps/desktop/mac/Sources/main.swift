import AppKit

// LightMap for Mac. `LightMap --selftest` runs the packaged server's checks with no window.
if CommandLine.arguments.contains("--selftest") {
    exit(SelfTest.run())
}

Log.attach("desktop")
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
