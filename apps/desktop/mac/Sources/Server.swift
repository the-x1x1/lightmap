import Foundation

/// The LightMap server (Next.js standalone output) run by the bundled `node`, on loopback only.
///
/// macOS has no job objects, so the server is started with runtime/parent-watch.cjs, which ends
/// it within two seconds of this process going away, a crash or a Force Quit included: a desktop
/// app must never leave a headless node behind.
final class Server {
    /// Fixed on purpose: saved places live in the page's storage, which belongs to the origin
    /// (scheme, host and port). The fallbacks are for a Mac where something else holds it.
    static let preferredPort = 47615
    private static let portAttempts = 10
    /// Set by LightMap itself; lightmap.env cannot override these.
    private static let reserved: Set<String> = ["PORT", "HOSTNAME", "NEXT_PUBLIC_APP_URL", "LIGHTMAP_PARENT_PID", "LIGHTMAP_DATA_DIR"]

    private var process: Process?
    private var stopping = false
    private(set) var baseURL = ""

    /// Called on the main queue when the server stops without being asked to.
    var onUnexpectedExit: ((Int32) -> Void)?

    /// Starts the server and waits until it answers. Throws with a readable message.
    func start(status: (String) -> Void) throws -> String {
        let fm = FileManager.default
        guard fm.isExecutableFile(atPath: Paths.nodeExe.path) else {
            throw AppError("The Node runtime was not found at \(Paths.nodeExe.path).\n\nThis copy of LightMap looks incomplete; downloading it again fixes it.")
        }
        guard fm.fileExists(atPath: Paths.serverScript.path) else {
            throw AppError("The LightMap server was not found at \(Paths.serverScript.path).\n\nThis copy of LightMap looks incomplete; downloading it again fixes it.")
        }

        let port = try Server.freePort()
        baseURL = "http://127.0.0.1:\(port)"
        if port != Server.preferredPort {
            Log.write("port \(Server.preferredPort) is in use; serving on \(port) for this run (saved places live with port \(Server.preferredPort)).")
        }
        status("Starting LightMap…")

        let p = Process()
        p.executableURL = Paths.nodeExe
        p.arguments = ["--require", Paths.parentWatch.path, Paths.serverScript.path]
        p.currentDirectoryURL = Paths.serverDir

        // An app opened from the Finder gets a bare environment; give the server what it needs.
        var env: [String: String] = [:]
        let inherited = ProcessInfo.processInfo.environment
        for key in ["HOME", "USER", "TMPDIR", "LANG", "LC_ALL"] {
            if let v = inherited[key] { env[key] = v }
        }
        env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        // The defaults that make a production server run on one machine for its owner:
        // no database, no accounts, map and planning only (docs/RELEASE_PROCESS.md §5a).
        env["NODE_ENV"] = "production"
        env["LIGHTMAP_STANDALONE"] = "true"
        env["LIGHTMAP_DESKTOP"] = "1"
        env["NEXT_TELEMETRY_DISABLED"] = "1"
        // Accounts live on the hosted LightMap (docs/SECURITY_MODEL.md "Desktop sign-in"); a
        // lightmap.env line can point elsewhere. Empty until the hosted service is deployed.
        if !Paths.accountOrigin.isEmpty { env["LIGHTMAP_ACCOUNT_ORIGIN"] = Paths.accountOrigin }
        for (key, value) in Server.readEnvFile() where !Server.reserved.contains(key.uppercased()) {
            env[key] = value
        }
        env["PORT"] = String(port)
        env["HOSTNAME"] = "127.0.0.1"
        env["NEXT_PUBLIC_APP_URL"] = baseURL
        env["LIGHTMAP_PARENT_PID"] = String(getpid())
        // Where the server keeps this device's sign-in (account.json).
        env["LIGHTMAP_DATA_DIR"] = Paths.dataHome.path
        p.environment = env

        let out = Pipe()
        let err = Pipe()
        p.standardOutput = out
        p.standardError = err
        Server.forward(out, prefix: "server: ")
        Server.forward(err, prefix: "server! ")
        p.terminationHandler = { [weak self] proc in
            Log.write("server exited (code \(proc.terminationStatus))")
            guard let self = self, !self.stopping else { return }
            DispatchQueue.main.async { self.onUnexpectedExit?(proc.terminationStatus) }
        }
        try p.run()
        process = p
        Log.write("started \(Paths.nodeExe.path) (pid \(p.processIdentifier)) for \(baseURL)")

        let deadline = Date().addingTimeInterval(90)
        while Date() < deadline {
            if Server.isLightMapServing(baseURL) { return baseURL }
            if !p.isRunning {
                throw AppError("The LightMap server stopped while starting (code \(p.terminationStatus)).\n\n\(Log.tail())")
            }
            Thread.sleep(forTimeInterval: 0.2)
        }
        throw AppError("LightMap did not answer on \(baseURL) within 90 seconds.\n\n\(Log.tail())")
    }

    func stop() {
        stopping = true
        guard let p = process else { return }
        process = nil
        if p.isRunning {
            p.terminate() // SIGTERM: Next closes its listener and exits
            let deadline = Date().addingTimeInterval(3)
            while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
            if p.isRunning { kill(p.processIdentifier, SIGKILL) }
        }
    }

    /// Is LightMap answering there? /api/health names its version, so anything else is told apart.
    static func isLightMapServing(_ baseURL: String) -> Bool {
        guard let url = URL(string: baseURL + "/api/health") else { return false }
        guard let answer = httpGet(url, timeout: 3), answer.0 == 200 else { return false }
        guard let obj = (try? JSONSerialization.jsonObject(with: answer.1)) as? [String: Any] else { return false }
        return obj["version"] != nil && obj["fixtureMode"] != nil
    }

    /// A blocking GET (the server start and the self-test run off the main thread).
    static func httpGet(_ url: URL, timeout: TimeInterval) -> (Int, Data)? {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = "GET"
        let done = DispatchSemaphore(value: 0)
        let result = Box<(Int, Data)?>(nil)
        let task = URLSession.shared.dataTask(with: request) { data, response, _ in
            if let http = response as? HTTPURLResponse { result.value = (http.statusCode, data ?? Data()) }
            done.signal()
        }
        task.resume()
        if done.wait(timeout: .now() + timeout + 1) == .timedOut {
            task.cancel()
            return nil
        }
        return result.value
    }

    private static func forward(_ pipe: Pipe, prefix: String) {
        let pending = Box(Data())
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            if chunk.isEmpty {
                handle.readabilityHandler = nil
                return
            }
            pending.value.append(chunk)
            while let nl = pending.value.firstIndex(of: 0x0A) {
                let line = String(decoding: pending.value[pending.value.startIndex..<nl], as: UTF8.self)
                pending.value.removeSubrange(pending.value.startIndex...nl)
                Log.write(prefix + line)
            }
        }
    }

    private static func freePort() throws -> Int {
        for port in preferredPort..<(preferredPort + portAttempts) where isFree(port) {
            return port
        }
        throw AppError("No free port between \(preferredPort) and \(preferredPort + portAttempts - 1) on this Mac.")
    }

    private static func isFree(_ port: Int) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        if fd < 0 { return false }
        defer { close(fd) }
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(UInt16(port).bigEndian)
        addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let r = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return r == 0
    }

    /// ~/Library/Application Support/LightMap/lightmap.env: KEY=VALUE lines for the server, the
    /// keys .env.example documents. Optional; a commented template is written the first time.
    static func readEnvFile() -> [(String, String)] {
        let fm = FileManager.default
        let path = Paths.envFile
        if !fm.fileExists(atPath: path.path) {
            try? fm.createDirectory(at: Paths.dataHome, withIntermediateDirectories: true)
            try? envTemplate.write(to: path, atomically: true, encoding: .utf8)
            return []
        }
        guard let text = try? String(contentsOf: path, encoding: .utf8) else {
            Log.write("lightmap.env: could not be read")
            return []
        }
        var result: [(String, String)] = []
        for raw in text.components(separatedBy: .newlines) {
            var line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            if line.hasPrefix("export ") { line = String(line.dropFirst(7)).trimmingCharacters(in: .whitespaces) }
            guard let eq = line.firstIndex(of: "="), eq != line.startIndex else { continue }
            let key = line[..<eq].trimmingCharacters(in: .whitespaces)
            var value = line[line.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            if value.count >= 2, let f = value.first, (f == "\"" || f == "'"), value.last == f {
                value = String(value.dropFirst().dropLast())
            }
            result.append((key, value))
        }
        return result
    }

    private static let envTemplate = """
    # LightMap desktop settings for the built-in server. One KEY=VALUE per line; quit and reopen LightMap after editing.
    # The keys are the ones .env.example in the LightMap repository documents. Examples:
    #
    # CESIUM_ION_TOKEN=
    # IMAGERY_PROVIDER=cesium-ion
    # BUILDINGS_PROVIDER=cesium-osm
    # GEOCODER_USER_AGENT=LightMap-desktop (you@example.com)

    """
}
