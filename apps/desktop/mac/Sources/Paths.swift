import Foundation

/// Where LightMap for Mac keeps things. The program is the .app bundle; everything the person
/// owns (saved places live in WebKit's own store, settings, logs, staged updates) is outside it,
/// so replacing the bundle on an update never touches them.
enum Paths {
    /// The GitHub repository whose latest release the app updates from.
    static let releaseRepo = "the-x1x1/lightmap"

    static var appBundle: URL { Bundle.main.bundleURL }
    static var resources: URL { Bundle.main.resourceURL ?? appBundle.appendingPathComponent("Contents/Resources") }
    static var nodeExe: URL { resources.appendingPathComponent("runtime/node") }
    static var parentWatch: URL { resources.appendingPathComponent("runtime/parent-watch.cjs") }
    static var serverDir: URL { resources.appendingPathComponent("server/apps/web") }
    static var serverScript: URL { serverDir.appendingPathComponent("server.js") }

    /// ~/Library/Application Support/LightMap
    static var dataHome: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent("LightMap", isDirectory: true)
    }

    /// ~/Library/Logs/LightMap
    static var logs: URL {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Logs/LightMap", isDirectory: true)
    }

    static var updates: URL { dataHome.appendingPathComponent("updates", isDirectory: true) }
    static var envFile: URL { dataHome.appendingPathComponent("lightmap.env") }

    static var version: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0.0"
    }

    /// The release asset names for this Mac's processor.
    static var archTag: String {
        #if arch(arm64)
        return "arm64"
        #else
        return "x64"
        #endif
    }

    /// Compares dotted versions numerically ("0.3.10" > "0.3.9"). Non-numeric parts count as 0.
    static func isNewer(_ candidate: String, than current: String) -> Bool {
        let a = candidate.split(separator: ".").map { Int($0) ?? 0 }
        let b = current.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0
            let y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }
}

struct AppError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// A mutable cell a completion handler can fill (handlers are @Sendable and cannot mutate a
/// captured var). Each one here is written by one queue and read after it signals.
final class Box<T>: @unchecked Sendable {
    var value: T
    init(_ value: T) { self.value = value }
}
