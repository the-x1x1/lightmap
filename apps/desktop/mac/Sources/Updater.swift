import CryptoKit
import Foundation

/// Updates that install themselves (the Mac half of apps/desktop/README.md "Updates"):
///
/// 1. Twenty seconds after launch, and every six hours, ask GitHub for the latest release. If it
///    is newer and carries LightMap-<version>-mac-<arch>.zip and its .sha256, download the zip in
///    the background and keep it only if its SHA-256 matches. The window says it is ready.
/// 2. When LightMap quits, a small script waits for it to be gone, unpacks the zip and swaps the
///    new LightMap.app in place of this one. "Restart now" does it at once and reopens the app.
///    A launch that finds an update still staged installs it then, once.
///
/// Only a copy in an Applications folder that this user can write updates itself; one run from
/// the disk image or the Downloads folder (macOS runs those from a read-only, randomised path)
/// does not.
final class Updater {
    private struct Staged: Codable {
        let version: String
        let zip: String
    }

    private var timer: Timer?
    private var busy = false
    private(set) var readyVersion: String?

    /// Called on the main queue when an update has been downloaded and verified.
    var onReady: ((String) -> Void)?

    private var stagedFile: URL { Paths.updates.appendingPathComponent("staged.json") }
    private var assetName: (String) -> String { { "LightMap-\($0)-mac-\(Paths.archTag).zip" } }

    /// Whether this copy may replace itself.
    var isInstalledCopy: Bool {
        let path = Paths.appBundle.path
        if path.contains("/AppTranslocation/") || path.hasPrefix("/Volumes/") { return false }
        let home = NSHomeDirectory()
        guard path.hasPrefix("/Applications/") || path.hasPrefix(home + "/Applications/") else { return false }
        let parent = Paths.appBundle.deletingLastPathComponent().path
        return FileManager.default.isWritableFile(atPath: parent)
            && FileManager.default.isWritableFile(atPath: path)
    }

    func start() {
        guard isInstalledCopy else {
            Log.write("updates: off (not an installed copy: \(Paths.appBundle.path))")
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.check(manual: false, done: nil) }
        timer = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { [weak self] _ in
            self?.check(manual: false, done: nil)
        }
    }

    /// Looks for a newer release; `done` (main queue) gets a sentence for a manual check.
    func check(manual: Bool, done: ((String) -> Void)?) {
        if !isInstalledCopy {
            done?("This copy of LightMap is not in your Applications folder, so it does not update itself. Drag LightMap into Applications and open it from there.")
            return
        }
        if let v = readyVersion {
            done?("LightMap \(v) is downloaded and installs when you quit LightMap.")
            return
        }
        if busy {
            done?("LightMap is already checking for an update.")
            return
        }
        busy = true
        let finish: (String) -> Void = { message in
            DispatchQueue.main.async {
                self.busy = false
                Log.write("updates: " + message)
                done?(message)
            }
        }
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/\(Paths.releaseRepo)/releases/latest")!)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("LightMap-mac/\(Paths.version)", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 30
        URLSession.shared.dataTask(with: request) { data, response, error in
            guard let data = data, (response as? HTTPURLResponse)?.statusCode == 200,
                  let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = root["tag_name"] as? String
            else {
                finish("Could not reach GitHub to check for updates (\(error?.localizedDescription ?? "no answer")).")
                return
            }
            let latest = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
            guard Paths.isNewer(latest, than: Paths.version) else {
                finish("LightMap \(Paths.version) is up to date.")
                return
            }
            let wanted = self.assetName(latest)
            var zipURL: URL?
            var digestURL: URL?
            for asset in (root["assets"] as? [[String: Any]]) ?? [] {
                guard let name = asset["name"] as? String,
                      let link = asset["browser_download_url"] as? String, let url = URL(string: link) else { continue }
                if name == wanted { zipURL = url } else if name == wanted + ".sha256" { digestURL = url }
            }
            guard let zip = zipURL, let digest = digestURL else {
                finish("LightMap \(latest) is out, but not yet for this Mac (\(wanted) is missing).")
                return
            }
            self.download(version: latest, zip: zip, digest: digest, finish: finish)
        }.resume()
    }

    private func download(version: String, zip: URL, digest: URL, finish: @escaping (String) -> Void) {
        URLSession.shared.dataTask(with: digest) { data, _, _ in
            guard let data = data, let text = String(data: data, encoding: .utf8),
                  let expected = text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).first?.lowercased(),
                  expected.count == 64
            else {
                finish("The update's checksum could not be read; LightMap will try again later.")
                return
            }
            URLSession.shared.downloadTask(with: zip) { tmp, _, error in
                guard let tmp = tmp else {
                    finish("The update could not be downloaded (\(error?.localizedDescription ?? "no data")).")
                    return
                }
                let fm = FileManager.default
                do {
                    try fm.createDirectory(at: Paths.updates, withIntermediateDirectories: true)
                    let target = Paths.updates.appendingPathComponent(self.assetName(version))
                    try? fm.removeItem(at: target)
                    try fm.moveItem(at: tmp, to: target)
                    guard let actual = Updater.sha256(of: target), actual == expected else {
                        try? fm.removeItem(at: target)
                        finish("The downloaded update did not match its checksum and was discarded.")
                        return
                    }
                    let staged = Staged(version: version, zip: target.path)
                    try JSONEncoder().encode(staged).write(to: self.stagedFile, options: .atomic)
                    DispatchQueue.main.async {
                        self.readyVersion = version
                        self.onReady?(version)
                    }
                    finish("LightMap \(version) is downloaded and installs when you quit LightMap.")
                } catch {
                    finish("The update could not be saved (\(error.localizedDescription)).")
                }
            }.resume()
        }.resume()
    }

    static func sha256(of url: URL) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let chunk = handle.readData(ofLength: 4 << 20)
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func readStaged() -> Staged? {
        guard let data = try? Data(contentsOf: stagedFile),
              let staged = try? JSONDecoder().decode(Staged.self, from: data) else { return nil }
        guard Paths.isNewer(staged.version, than: Paths.version),
              FileManager.default.fileExists(atPath: staged.zip)
        else {
            // Installed already, or its download is gone: nothing to do.
            try? FileManager.default.removeItem(at: stagedFile)
            return nil
        }
        return staged
    }

    /// At launch: an update staged by an earlier run that never got to quit cleanly.
    /// Returns true when the install has started and this run should end at once.
    func installStagedAtLaunch() -> Bool {
        guard isInstalledCopy, let staged = readStaged() else { return false }
        Log.write("updates: installing \(staged.version), staged by an earlier run")
        return apply(staged, relaunch: true)
    }

    /// On quit (or Restart now): hand the staged update to the swap script.
    @discardableResult
    func applyOnQuit(relaunch: Bool) -> Bool {
        guard isInstalledCopy, let staged = readStaged() else { return false }
        return apply(staged, relaunch: relaunch)
    }

    /// Set once the swap script has the update, so a quit right after cannot start a second one.
    private var handedOff = false

    private func apply(_ staged: Staged, relaunch: Bool) -> Bool {
        if handedOff { return false }
        let script = Paths.updates.appendingPathComponent("apply-update.sh")
        let log = Paths.logs.appendingPathComponent("update.log")
        do {
            try Updater.swapScript.write(to: script, atomically: true, encoding: .utf8)
            try? FileManager.default.createDirectory(at: Paths.logs, withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
            let out = try FileHandle(forWritingTo: log)
            out.seekToEndOfFile()
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/sh")
            p.arguments = [script.path, String(getpid()), staged.zip, Paths.appBundle.path, relaunch ? "1" : "0", stagedFile.path]
            p.standardOutput = out
            p.standardError = out
            try p.run()
            handedOff = true
            Log.write("updates: handed \(staged.version) to the swap script (pid \(p.processIdentifier))")
            return true
        } catch {
            Log.write("updates: could not start the swap script: \(error.localizedDescription)")
            return false
        }
    }

    /// Runs after LightMap has quit: wait for it, unpack, swap the bundle (keeping the old one
    /// until the new one is in place), clear the staged update, and reopen when asked.
    static let swapScript = """
    #!/bin/sh
    # LightMap for Mac: install a staged update. Arguments: pid zip app relaunch staged.json
    pid="$1"; zip="$2"; app="$3"; relaunch="$4"; staged="$5"
    echo "$(date '+%Y-%m-%dT%H:%M:%S') waiting for LightMap ($pid) to quit"
    n=0
    while kill -0 "$pid" 2>/dev/null; do
      sleep 0.25; n=$((n + 1))
      if [ "$n" -gt 240 ]; then echo "LightMap did not quit within a minute; update left staged"; exit 1; fi
    done
    work="$(mktemp -d "${TMPDIR:-/tmp}/lightmap-update.XXXXXX")"
    ok=0
    if /usr/bin/ditto -x -k "$zip" "$work" && [ -x "$work/LightMap.app/Contents/MacOS/LightMap" ]; then
      /usr/bin/xattr -dr com.apple.quarantine "$work/LightMap.app" 2>/dev/null
      rm -rf "$app.old"
      if mv "$app" "$app.old"; then
        if mv "$work/LightMap.app" "$app"; then
          rm -rf "$app.old"; ok=1
        else
          mv "$app.old" "$app"
        fi
      fi
    fi
    rm -rf "$work"
    if [ "$ok" = 1 ]; then
      echo "$(date '+%Y-%m-%dT%H:%M:%S') installed $(/usr/bin/defaults read "$app/Contents/Info" CFBundleShortVersionString 2>/dev/null)"
    else
      echo "$(date '+%Y-%m-%dT%H:%M:%S') update failed; the previous LightMap is unchanged"
    fi
    # Either way the staged update is spent: a broken download is fetched again by the next check.
    rm -f "$zip" "$staged"
    if [ "$relaunch" = 1 ]; then /usr/bin/open "$app"; fi
    exit 0
    """
}
