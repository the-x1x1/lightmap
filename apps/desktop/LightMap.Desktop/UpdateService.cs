using System.Diagnostics;
using System.Text.Json;

namespace LightMap.Desktop;

/// <summary>
/// Silent updates, the Formicaria way.
///
/// 1. CHECK: shortly after launch and every six hours, ask GitHub for the repository's latest
///    release. A newer version that carries LightMap-Setup-&lt;version&gt;.exe and its .sha256
///    sidecar is downloaded in the background, hashed, and staged. Nothing is asked.
/// 2. APPLY: when LightMap closes, a staged update is installed silently (no window, no prompt,
///    no administrator rights: LightMap is installed per user). The next launch is the new
///    version. "Restart now" on the update bar does the same at once and reopens LightMap.
///    A launch that still finds one staged (the machine shut down first) applies it then.
///
/// Only an installed copy updates itself (the installer writes .lightmap-installed beside the
/// exe); a copy run from a build folder never replaces its own files. A download whose digest is
/// missing or wrong is never kept and never run.
/// </summary>
internal static class UpdateService
{
    private const string LatestUrl = "https://api.github.com/repos/" + App.ReleaseRepo + "/releases/latest";
    private static readonly TimeSpan FirstCheckDelay = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(6);
    private static int _busy;
    private static System.Threading.Timer? _timer;

    public static string AssetName(string version) => $"LightMap-Setup-{version}.exe";

    /// <summary>Called before any window exists. True when setup was started and this process must exit.</summary>
    public static bool ApplyStagedAtLaunch()
    {
        try
        {
            if (!App.IsInstalled) return false;
            var staged = UpdateStaging.Pending();
            if (staged is null)
            {
                UpdateStaging.Clear();
                return false;
            }
            // One try per version at launch. If setup could not finish (it starts LightMap again
            // when it does), a second launch must open the app rather than try again and vanish;
            // the update then waits for LightMap to close, which never blocks a launch.
            var attempt = Path.Combine(App.LogDir, $"launch-update-{staged.Version}.attempted");
            if (File.Exists(attempt))
            {
                DesktopLog.Write($"update: v{staged.Version} was already tried at a launch; it installs when LightMap closes instead.");
                return false;
            }
            Directory.CreateDirectory(App.LogDir);
            File.WriteAllText(attempt, DateTime.Now.ToString("O"));
            DesktopLog.Write($"update: v{staged.Version} was staged and not yet installed; installing it now.");
            RunInstaller(staged, relaunch: true);
            return true;
        }
        catch (Exception error)
        {
            DesktopLog.Write("update: apply at launch failed: " + error.Message);
            return false;
        }
    }

    /// <summary>Starts the quiet background checks. <paramref name="staged"/> is called with the version when one is ready.</summary>
    public static void StartBackgroundChecks(Action<string> staged)
    {
        if (!App.IsInstalled)
        {
            DesktopLog.Write("update: this copy is not an installed one (no " + App.InstalledMarker + "); it does not update itself.");
            return;
        }
        if (UpdateStaging.Pending() is { } already) staged(already.Version);
        _timer = new System.Threading.Timer(state => CheckOnce(staged, out var ignored), null, FirstCheckDelay, CheckInterval);
    }

    /// <summary>One check, on the calling thread. Returns a sentence for a person who asked.</summary>
    public static string CheckOnce(Action<string>? staged, out bool updateReady)
    {
        updateReady = false;
        if (!App.IsInstalled)
            return $"This copy of LightMap ({App.Version}) was not installed by the LightMap installer, so it does not update itself.";
        if (Interlocked.Exchange(ref _busy, 1) == 1) return "An update check is already running.";
        try
        {
            var (latest, asset, digestUrl) = QueryLatest();
            if (latest is null) return "The update server could not be reached. LightMap will try again later.";
            if (!App.IsNewer(latest)) return $"LightMap {App.Version} is up to date.";

            if (UpdateStaging.Pending() is { } pending && pending.Version == latest)
            {
                updateReady = true;
                staged?.Invoke(latest);
                return $"LightMap {latest} is downloaded and installs when you close LightMap.";
            }
            if (asset is null || digestUrl is null)
                return $"LightMap {latest} is out, but its release has no Windows installer with a checksum yet.";

            var result = Stage(latest, asset, digestUrl);
            if (result is null)
            {
                updateReady = true;
                staged?.Invoke(latest);
                return $"LightMap {latest} is downloaded and installs when you close LightMap.";
            }
            return result;
        }
        catch (Exception error)
        {
            DesktopLog.Write("update: check failed: " + error.Message);
            return "The update check failed: " + error.Message;
        }
        finally
        {
            Interlocked.Exchange(ref _busy, 0);
        }
    }

    /// <summary>When LightMap closes: install a staged update silently, without reopening LightMap.</summary>
    public static void ApplyOnExit()
    {
        try
        {
            if (!App.IsInstalled) return;
            var staged = UpdateStaging.Pending();
            if (staged is null) return;
            DesktopLog.Write($"update: installing v{staged.Version} silently as LightMap closes.");
            RunInstaller(staged, relaunch: false);
        }
        catch (Exception error)
        {
            DesktopLog.Write("update: apply on exit failed: " + error.Message);
        }
    }

    /// <summary>"Restart now": install at once and reopen. True when setup started and the app must exit.</summary>
    public static bool RestartToInstall()
    {
        var staged = UpdateStaging.Pending();
        if (staged is null) return false;
        DesktopLog.Write($"update: restarting to install v{staged.Version}.");
        RunInstaller(staged, relaunch: true);
        return true;
    }

    /// <summary>
    /// Setup waits for this process to leave (it watches <see cref="App.ShellMutexName"/>), replaces
    /// the program folder, and, unless told /nolaunch=1, starts LightMap again.
    /// </summary>
    private static void RunInstaller(UpdateStaging.StagedUpdate staged, bool relaunch)
    {
        Directory.CreateDirectory(App.LogDir);
        var log = Path.Combine(App.LogDir, $"setup-{staged.Version}.log");
        var arguments = $"/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCANCEL /LOG=\"{log}\"";
        if (!relaunch) arguments += " /nolaunch=1";
        Process.Start(new ProcessStartInfo(staged.PayloadPath)
        {
            Arguments = arguments,
            UseShellExecute = true,
            WorkingDirectory = App.UpdatesDir,
        });
    }

    /// <summary>Downloads, verifies and records. Null on success, else why not.</summary>
    private static string? Stage(string version, string assetUrl, string digestUrl)
    {
        var name = AssetName(version);
        var payload = Path.Combine(App.UpdatesDir, name);
        try
        {
            UpdateStaging.Clear();
            Directory.CreateDirectory(App.UpdatesDir);
            using var http = NewHttp(TimeSpan.FromMinutes(15), api: false);

            // The digest first: a download with nothing to check it against is never kept.
            var expected = UpdateStaging.ParseDigest(TryGet(http, digestUrl));
            if (expected is null)
                return $"LightMap {version} publishes no usable checksum, so it was not downloaded.";

            var partial = payload + ".partial";
            using (var download = http.GetStreamAsync(assetUrl).GetAwaiter().GetResult())
            using (var file = File.Create(partial))
                download.CopyTo(file);

            var actual = UpdateStaging.Sha256File(partial);
            if (!string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
            {
                File.Delete(partial);
                DesktopLog.Write($"update: v{version} downloaded with SHA-256 {actual}, expected {expected}; discarded.");
                return $"The download of LightMap {version} did not match its checksum and was discarded.";
            }
            File.Move(partial, payload, overwrite: true);
            UpdateStaging.Record(new UpdateStaging.StagedUpdate(version, name, expected, payload, DateTime.UtcNow));
            DesktopLog.Write($"update: v{version} downloaded and verified ({expected}); installs when LightMap closes.");
            return null;
        }
        catch (Exception error)
        {
            DesktopLog.Write("update: download failed: " + error.Message);
            return $"LightMap {version} could not be downloaded ({error.Message}).";
        }
    }

    private static (string? Latest, string? AssetUrl, string? DigestUrl) QueryLatest()
    {
        try
        {
            using var http = NewHttp(TimeSpan.FromSeconds(15), api: true);
            var json = http.GetStringAsync(LatestUrl).GetAwaiter().GetResult();
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var latest = (root.GetProperty("tag_name").GetString() ?? "").Trim().TrimStart('v', 'V');
            if (App.ParseVersion(latest) is null) return (null, null, null);

            var wanted = AssetName(latest);
            string? assetUrl = null, digestUrl = null;
            if (root.TryGetProperty("assets", out var assets))
            {
                foreach (var asset in assets.EnumerateArray())
                {
                    var name = asset.GetProperty("name").GetString() ?? "";
                    var url = asset.GetProperty("browser_download_url").GetString();
                    if (string.Equals(name, wanted, StringComparison.OrdinalIgnoreCase)) assetUrl = url;
                    else if (string.Equals(name, wanted + ".sha256", StringComparison.OrdinalIgnoreCase)) digestUrl = url;
                }
            }
            DesktopLog.Write($"update: latest release is {latest}; this is {App.Version}.");
            return (latest, assetUrl, digestUrl);
        }
        catch (Exception error)
        {
            DesktopLog.Write("update: query failed: " + error.Message);
            return (null, null, null);
        }
    }

    private static string? TryGet(HttpClient http, string url)
    {
        try
        {
            using var response = http.GetAsync(url).GetAwaiter().GetResult();
            return response.IsSuccessStatusCode ? response.Content.ReadAsStringAsync().GetAwaiter().GetResult() : null;
        }
        catch
        {
            return null;
        }
    }

    private static HttpClient NewHttp(TimeSpan timeout, bool api)
    {
        var http = new HttpClient { Timeout = timeout };
        http.DefaultRequestHeaders.UserAgent.ParseAdd($"LightMap-Desktop/{App.Version}");
        if (api) http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return http;
    }
}
