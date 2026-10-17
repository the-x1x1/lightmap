import Foundation

/// `LightMap --selftest`: start the packaged server with no window, prove the things a person
/// would notice first, stop it, and exit 0 (all good) or 1. CI runs it on the built app and on
/// the copy installed from the disk image. Lines go to stdout and ~/Library/Logs/LightMap/selftest.log.
enum SelfTest {
    static func run() -> Int32 {
        Log.attach("selftest")
        var failures = 0
        func check(_ what: String, _ ok: Bool, _ detail: String = "") {
            Log.write("\(ok ? "PASS" : "FAIL") \(what)\(detail.isEmpty ? "" : " - " + detail)")
            if !ok { failures += 1 }
        }

        let server = Server()
        defer { server.stop() }
        do {
            let started = Date()
            let base = try server.start { Log.write("status: " + $0) }
            check("server answers /api/ready", true, String(format: "%@ in %.1f s", base, Date().timeIntervalSince(started)))

            func get(_ path: String) -> (Int, String) {
                guard let url = URL(string: base + path), let answer = Server.httpGet(url, timeout: 45) else {
                    return (0, "no answer")
                }
                return (answer.0, String(decoding: answer.1, as: UTF8.self))
            }
            func json(_ body: String) -> [String: Any]? {
                (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any]
            }

            let health = get("/api/health")
            let version = json(health.1)?["version"] as? String
            check("health reports a version", version != nil, version ?? health.1)
            if Paths.version != "0.0.0" {
                check("server and shell are the same release", version == Paths.version, "server \(version ?? "?"), shell \(Paths.version)")
            }

            let page = get("/")
            check("the app page renders", page.0 == 200 && page.1.contains("LightMap"), "HTTP \(page.0)")

            if let range = page.1.range(of: #"<script[^>]+src="(/_next/static/[^"]+\.js)""#, options: .regularExpression) {
                let tag = String(page.1[range])
                if let src = tag.range(of: #"/_next/static/[^"]+\.js"#, options: .regularExpression) {
                    let js = get(String(tag[src]))
                    check("a client script is served", js.0 == 200 && !js.1.isEmpty, "\(tag[src]): HTTP \(js.0)")
                }
            } else {
                check("the page names its client scripts", false)
            }

            for path in ["/cesium/VERSION", "/data/place-labels.json", "/data/geoid/0_0.bin", "/sw.js", "/manifest.webmanifest"] {
                let r = get(path)
                check("serves " + path, r.0 == 200, "HTTP \(r.0)")
            }

            // geo-tz reads its boundary data from disk at run time; a package that lost it answers UTC.
            let reverse = get("/api/location/reverse?lat=21.3069&lng=-157.8583")
            let zone = json(reverse.1)?["timeZone"] as? String
            check("time zone lookup works", zone == "Pacific/Honolulu", "HTTP \(reverse.0), \(zone ?? reverse.1)")
        } catch {
            check("server starts", false, error.localizedDescription)
        }

        Log.write(failures == 0 ? "SELFTEST OK" : "SELFTEST FAILED (\(failures))")
        return failures == 0 ? 0 : 1
    }
}
