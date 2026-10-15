using System.Reflection;

namespace LightMap.Desktop;

/// <summary>Names, places and the version: everything the other files agree on.</summary>
internal static class App
{
    public const string Name = "LightMap";

    /// <summary>Where releases are published. The updater reads its latest release.</summary>
    public const string ReleaseRepo = "the-x1x1/lightmap";

    /// <summary>
    /// Held for the shell's whole life. The installer (installer/lightmap-setup.iss) waits for it
    /// to go before replacing files, so the two names must stay identical.
    /// </summary>
    public const string ShellMutexName = @"Local\LightMapDesktopShell";

    /// <summary>A second launch signals this, and the first window comes to the front.</summary>
    public const string ShowEventName = @"Local\LightMapDesktopShow";

    /// <summary>Written by the installer beside the exe. Only an installed copy updates itself.</summary>
    public const string InstalledMarker = ".lightmap-installed";

    public static readonly string Version = ReadVersion();

    private static string ReadVersion()
    {
        var info = typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (string.IsNullOrWhiteSpace(info))
            info = typeof(App).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
        var plus = info.IndexOf('+');
        return plus >= 0 ? info[..plus] : info;
    }

    /// <summary>
    /// Everything LightMap keeps between runs: logs, the WebView2 profile (which holds the app's
    /// saved places and settings), staged updates and the optional lightmap.env. It is outside the
    /// program folder, so installing, updating and uninstalling never touch it.
    /// </summary>
    /// <summary>
    /// The hosted LightMap the app signs in to for accounts, projects and Pro (an https origin).
    /// Empty until that service is deployed: the app then runs without accounts, as before.
    /// </summary>
    public static readonly string AccountOrigin = "";

    public static string DataHome =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LightMap");

    public static string LogDir => Path.Combine(DataHome, "logs");
    public static string WebViewProfile => Path.Combine(DataHome, "WebView2");
    public static string UpdatesDir => Path.Combine(DataHome, "updates");
    public static string EnvFile => Path.Combine(DataHome, "lightmap.env");
    public static string WindowStateFile => Path.Combine(DataHome, "window.json");

    public static string AppDir => AppContext.BaseDirectory;
    public static string NodeExe => Path.Combine(AppDir, "runtime", "node.exe");
    public static string ServerDir => Path.Combine(AppDir, "server", "apps", "web");
    public static string ServerScript => Path.Combine(ServerDir, "server.js");

    public static bool IsInstalled => File.Exists(Path.Combine(AppDir, InstalledMarker));

    /// <summary>"v0.3.0", "0.3.0" → 0.3.0. Pre-releases ("0.3.0-beta.1") and junk → null.</summary>
    public static System.Version? ParseVersion(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var t = text.Trim().TrimStart('v', 'V');
        if (t.Contains('-')) return null;
        if (!System.Version.TryParse(t, out var v)) return null;
        return new System.Version(v.Major, v.Minor, Math.Max(0, v.Build));
    }

    public static bool IsNewer(string candidate) =>
        ParseVersion(candidate) is { } c && ParseVersion(Version) is { } mine && c > mine;
}
