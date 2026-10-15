import Foundation

/// ~/Library/Logs/LightMap/<name>.log, started fresh each run (the previous run's is kept as
/// <name>.previous.log). Lines also go to standard output, which is what CI reads for --selftest.
enum Log {
    private static let queue = DispatchQueue(label: "us.lightmap.log")
    private static var handle: FileHandle?
    private static var recent: [String] = []
    private static let stamp: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func attach(_ name: String) {
        queue.sync {
            let fm = FileManager.default
            try? fm.createDirectory(at: Paths.logs, withIntermediateDirectories: true)
            let url = Paths.logs.appendingPathComponent("\(name).log")
            let previous = Paths.logs.appendingPathComponent("\(name).previous.log")
            if fm.fileExists(atPath: url.path) {
                try? fm.removeItem(at: previous)
                try? fm.moveItem(at: url, to: previous)
            }
            fm.createFile(atPath: url.path, contents: nil)
            handle = try? FileHandle(forWritingTo: url)
        }
    }

    static func write(_ message: String) {
        let line = "\(stamp.string(from: Date())) \(message)\n"
        queue.sync {
            if let data = line.data(using: .utf8) {
                handle?.write(data)
                FileHandle.standardOutput.write(data)
            }
            recent.append(message)
            if recent.count > 40 { recent.removeFirst(recent.count - 40) }
        }
    }

    /// The last lines, for an error message the person can read.
    static func tail(_ lines: Int = 12) -> String {
        queue.sync { recent.suffix(lines).joined(separator: "\n") }
    }
}
