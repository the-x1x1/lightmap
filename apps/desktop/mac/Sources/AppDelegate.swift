import AppKit
import WebKit

/// The window: a loading message at once, the app (a WKWebView on the local server) when the
/// server answers, a bar when an update is ready, and the menus a Mac app is expected to have.
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var loading: NSTextField!
    private var updateBar: NSView!
    private var updateLabel: NSTextField!
    private let server = Server()
    private let updater = Updater()
    private var baseURL: URL?
    private var downloadTargets: [ObjectIdentifier: URL] = [:]

    // MARK: launch and quit

    func applicationDidFinishLaunching(_ notification: Notification) {
        Log.write("LightMap \(Paths.version) (\(Paths.archTag)) at \(Paths.appBundle.path)")
        if updater.installStagedAtLaunch() {
            NSApp.terminate(nil)
            return
        }
        buildMenu()
        buildWindow()
        NSApp.activate(ignoringOtherApps: true)
        startServer()
        updater.onReady = { [weak self] version in self?.showUpdateReady(version) }
        updater.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        server.stop()
        updater.applyOnQuit(relaunch: false)
        Log.write("quit")
    }

    private func startServer() {
        loading.stringValue = "Starting LightMap…"
        loading.isHidden = false
        server.onUnexpectedExit = { [weak self] code in self?.serverStopped(code) }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                let url = try self.server.start { status in
                    DispatchQueue.main.async { self.loading.stringValue = status }
                }
                DispatchQueue.main.async {
                    self.baseURL = URL(string: url)
                    // This launch's secret, for the server's account routes (Server.secret).
                    let cookie = HTTPCookie(properties: [
                        .name: "lm_desktop",
                        .value: self.server.secret,
                        .domain: "127.0.0.1",
                        .path: "/",
                        HTTPCookiePropertyKey("HttpOnly"): "TRUE",
                    ])
                    let load = { self.webView.load(URLRequest(url: URL(string: url)!)) }
                    if let cookie = cookie {
                        self.webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { load() }
                    } else {
                        load()
                    }
                }
            } catch {
                DispatchQueue.main.async { self.fatal(error.localizedDescription) }
            }
        }
    }

    private func serverStopped(_ code: Int32) {
        let alert = NSAlert()
        alert.messageText = "LightMap's server stopped"
        alert.informativeText = "It ended unexpectedly (code \(code)). Your saved places are safe.\n\n\(Log.tail(6))"
        alert.addButton(withTitle: "Restart LightMap")
        alert.addButton(withTitle: "Quit")
        if alert.runModal() == .alertFirstButtonReturn {
            webView.isHidden = true
            startServer()
        } else {
            NSApp.terminate(nil)
        }
    }

    private func fatal(_ message: String) {
        Log.write("fatal: " + message)
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "LightMap could not start"
        alert.informativeText = message
        alert.addButton(withTitle: "Quit")
        alert.addButton(withTitle: "Show Logs")
        if alert.runModal() == .alertSecondButtonReturn { NSWorkspace.shared.open(Paths.logs) }
        NSApp.terminate(nil)
    }

    // MARK: window

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1360, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.title = "LightMap"
        window.minSize = NSSize(width: 820, height: 560)
        window.backgroundColor = NSColor(calibratedRed: 0.043, green: 0.043, blue: 0.051, alpha: 1)
        window.titlebarAppearsTransparent = true
        window.appearance = NSAppearance(named: .darkAqua)
        window.delegate = self
        if !window.setFrameUsingName("LightMapMain") { window.center() }
        window.setFrameAutosaveName("LightMapMain")

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // persistent: saved places and settings survive
        // The browser sign-in opens its page after a request returns, past the click: allowed,
        // because every new window goes to the default browser (createWebViewWith returns nil).
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.applicationNameForUserAgent = "LightMap-mac/\(Paths.version)"
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.isHidden = true
        webView.setValue(false, forKey: "drawsBackground") // no white flash before the page paints

        loading = NSTextField(labelWithString: "Starting LightMap…")
        loading.textColor = NSColor(white: 0.85, alpha: 1)
        loading.font = NSFont.systemFont(ofSize: 15)
        loading.alignment = .center

        updateLabel = NSTextField(labelWithString: "")
        updateLabel.textColor = .white
        updateLabel.font = NSFont.systemFont(ofSize: 13)
        let restart = NSButton(title: "Restart now", target: self, action: #selector(restartToUpdate))
        restart.bezelStyle = .rounded
        let later = NSButton(title: "Later", target: self, action: #selector(hideUpdateBar))
        later.bezelStyle = .rounded
        let barStack = NSStackView(views: [updateLabel, restart, later])
        barStack.orientation = .horizontal
        barStack.spacing = 10
        barStack.edgeInsets = NSEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
        updateBar = NSView()
        updateBar.wantsLayer = true
        updateBar.layer?.backgroundColor = NSColor(calibratedRed: 0.16, green: 0.2, blue: 0.3, alpha: 1).cgColor
        updateBar.isHidden = true
        barStack.translatesAutoresizingMaskIntoConstraints = false
        updateBar.addSubview(barStack)

        let content = NSView()
        for v in [webView, loading, updateBar] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(v)
        }
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            webView.topAnchor.constraint(equalTo: content.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: updateBar.topAnchor),
            updateBar.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            updateBar.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            updateBar.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            barStack.leadingAnchor.constraint(equalTo: updateBar.leadingAnchor),
            barStack.topAnchor.constraint(equalTo: updateBar.topAnchor),
            barStack.bottomAnchor.constraint(equalTo: updateBar.bottomAnchor),
            loading.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            loading.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            loading.widthAnchor.constraint(lessThanOrEqualTo: content.widthAnchor, constant: -40),
        ])
        updateBarHeight = updateBar.heightAnchor.constraint(equalToConstant: 0)
        updateBarHeight?.isActive = true
        window.contentView = content
        window.makeKeyAndOrderFront(nil)
    }

    private var updateBarHeight: NSLayoutConstraint?

    private func showUpdateReady(_ version: String) {
        updateLabel.stringValue = "LightMap \(version) is ready. It installs when you quit."
        updateBarHeight?.isActive = false
        updateBar.isHidden = false
    }

    @objc private func hideUpdateBar() {
        updateBar.isHidden = true
        updateBarHeight?.isActive = true
    }

    @objc private func restartToUpdate() {
        // The swap script waits for this process to end, so it can start before the server stops;
        // if it cannot start, the app carries on as it was.
        if updater.applyOnQuit(relaunch: true) {
            server.stop()
            // The swap script reopens LightMap; this run must end without staging it twice.
            exit(0)
        }
        hideUpdateBar()
        let alert = NSAlert()
        alert.messageText = "The update could not be installed now"
        alert.informativeText = "LightMap keeps running as it is and tries again later.\n\n\(Log.tail(4))"
        alert.runModal()
    }

    // MARK: menus

    private func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            if let target = target { i.target = target }
            return i
        }
        func submenu(_ title: String, _ items: [NSMenuItem]) {
            let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let menu = NSMenu(title: title)
            items.forEach { menu.addItem($0) }
            holder.submenu = menu
            main.addItem(holder)
        }
        submenu("LightMap", [
            item("About LightMap", #selector(showAbout), target: self),
            item("Check for Updates…", #selector(checkForUpdates), target: self),
            .separator(),
            item("Hide LightMap", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("Quit LightMap", #selector(NSApplication.terminate(_:)), "q"),
        ])
        // Without an Edit menu, Cmd-C / Cmd-V / Cmd-A do nothing in the web view's text fields.
        submenu("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        submenu("View", [
            item("Reload", #selector(reload), "r", target: self),
            .separator(),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        submenu("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Zoom", #selector(NSWindow.performZoom(_:))),
        ])
        submenu("Help", [
            item("Open LightMap in Your Browser", #selector(openInBrowser), target: self),
            item("Show LightMap's Data Folder", #selector(showDataFolder), target: self),
            item("Show Logs", #selector(showLogs), target: self),
        ])
        NSApp.mainMenu = main
    }

    @objc private func reload() { webView.reload() }

    @objc private func openInBrowser() {
        if let url = baseURL { NSWorkspace.shared.open(url) }
    }

    @objc private func showDataFolder() {
        try? FileManager.default.createDirectory(at: Paths.dataHome, withIntermediateDirectories: true)
        NSWorkspace.shared.open(Paths.dataHome)
    }

    @objc private func showLogs() { NSWorkspace.shared.open(Paths.logs) }

    @objc private func showAbout() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "LightMap",
            .applicationVersion: Paths.version,
            .version: Paths.archTag,
        ])
    }

    @objc private func checkForUpdates() {
        updater.check(manual: true) { message in
            let alert = NSAlert()
            alert.messageText = "Software update"
            alert.informativeText = message
            alert.runModal()
        }
    }

    // MARK: navigation: the app stays in the window; everything else opens in the browser

    private func isApp(_ url: URL?) -> Bool {
        guard let url = url, let base = baseURL else { return false }
        if url.scheme == "blob" || url.scheme == "data" || url.scheme == "about" { return true }
        return url.host == base.host && url.port == base.port
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        let url = navigationAction.request.url
        if navigationAction.targetFrame?.isMainFrame != false, !isApp(url), let url = url,
           ["http", "https", "mailto"].contains(url.scheme ?? "") {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading.isHidden = true
        webView.isHidden = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Log.write("navigation failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Log.write("page failed to load: \(error.localizedDescription)")
        loading.stringValue = "LightMap could not load: \(error.localizedDescription)\nView → Reload tries again."
        loading.isHidden = false
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Log.write("web content process ended; reloading")
        webView.reload()
    }

    /// target=_blank links (the map credits, help pages) open in the browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isApp(url) { webView.load(navigationAction.request) } else { NSWorkspace.shared.open(url) }
        }
        return nil
    }

    // MARK: alert / confirm / prompt / file picker (WKWebView shows none of these by itself)

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }

    // MARK: downloads (the planning card, the shot list): straight to ~/Downloads

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Downloads")
        let name = suggestedFilename.isEmpty ? "LightMap download" : suggestedFilename
        let ext = (name as NSString).pathExtension
        let stem = (name as NSString).deletingPathExtension
        var target = folder.appendingPathComponent(name)
        var n = 2
        while FileManager.default.fileExists(atPath: target.path) {
            target = folder.appendingPathComponent(ext.isEmpty ? "\(stem) \(n)" : "\(stem) \(n).\(ext)")
            n += 1
        }
        downloadTargets[ObjectIdentifier(download)] = target
        completionHandler(target)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let target = downloadTargets.removeValue(forKey: ObjectIdentifier(download)) {
            Log.write("downloaded \(target.lastPathComponent)")
            NSWorkspace.shared.activateFileViewerSelecting([target])
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadTargets.removeValue(forKey: ObjectIdentifier(download))
        Log.write("download failed: \(error.localizedDescription)")
    }
}
