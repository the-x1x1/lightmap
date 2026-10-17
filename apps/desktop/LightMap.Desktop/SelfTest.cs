using System.Text.Json;
using System.Text.RegularExpressions;

namespace LightMap.Desktop;

/// <summary>
/// LightMap.exe --selftest: start the packaged server with no window, prove the things a person
/// would notice first, stop it, and exit 0 (all good) or 1. The release workflow runs it on the
/// build output and again on the installed copy; it writes logs\selftest.log.
/// </summary>
internal static partial class SelfTest
{
    public static int Run()
    {
        DesktopLog.Attach("selftest");
        var failures = 0;
        void Check(string what, bool ok, string detail = "")
        {
            DesktopLog.Write($"{(ok ? "PASS" : "FAIL")} {what}{(detail.Length > 0 ? " - " + detail : "")}");
            if (!ok) failures++;
        }

        using var server = new ServerProcess();
        try
        {
            var started = DateTime.UtcNow;
            var url = server.Start(s => DesktopLog.Write("status: " + s));
            Check("server answers /api/ready", true, $"{url} in {(DateTime.UtcNow - started).TotalSeconds:0.0} s");

            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(45) };
            (int Status, string Body) Get(string path)
            {
                try
                {
                    using var response = http.GetAsync(url + path).GetAwaiter().GetResult();
                    return ((int)response.StatusCode, response.Content.ReadAsStringAsync().GetAwaiter().GetResult());
                }
                catch (Exception error)
                {
                    return (0, error.Message);
                }
            }

            var health = Get("/api/health");
            string? version = null;
            try
            {
                using var doc = JsonDocument.Parse(health.Body);
                version = doc.RootElement.GetProperty("version").GetString();
            }
            catch { }
            Check("health reports a version", version is not null, version ?? health.Body);
            if (App.Version != "0.0.0")
                Check("server and shell are the same release", version == App.Version, $"server {version}, shell {App.Version}");

            var page = Get("/");
            Check("the app page renders", page.Status == 200 && page.Body.Contains("LightMap", StringComparison.Ordinal), $"HTTP {page.Status}");

            var chunk = ScriptSrc().Match(page.Body);
            if (chunk.Success)
            {
                var js = Get(chunk.Groups[1].Value);
                Check("a client script is served", js.Status == 200 && js.Body.Length > 0, $"{chunk.Groups[1].Value}: HTTP {js.Status}");
            }
            else
            {
                Check("the page names its client scripts", false);
            }

            foreach (var path in new[] { "/cesium/VERSION", "/data/place-labels.json", "/data/geoid/0_0.bin", "/sw.js", "/manifest.webmanifest" })
            {
                var r = Get(path);
                Check("serves " + path, r.Status == 200, $"HTTP {r.Status}");
            }

            // geo-tz reads its boundary data from disk at run time; a package that lost it answers UTC.
            var reverse = Get("/api/location/reverse?lat=21.3069&lng=-157.8583");
            string? zone = null;
            try
            {
                using var doc = JsonDocument.Parse(reverse.Body);
                zone = doc.RootElement.GetProperty("timeZone").GetString();
            }
            catch { }
            Check("time zone lookup works", zone == "Pacific/Honolulu", $"HTTP {reverse.Status}, {zone ?? reverse.Body}");
        }
        catch (Exception error)
        {
            Check("server starts", false, error.Message);
        }

        DesktopLog.Write(failures == 0 ? "SELFTEST OK" : $"SELFTEST FAILED ({failures})");
        return failures == 0 ? 0 : 1;
    }

    [GeneratedRegex("<script[^>]+src=\"(/_next/static/[^\"]+\\.js)\"")]
    private static partial Regex ScriptSrc();
}
