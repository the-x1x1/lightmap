namespace LightMap.Desktop;

/// <summary>
/// What happened, written down. A WinExe has no console, so the server's output and the shell's
/// own events go to %LOCALAPPDATA%\LightMap\logs\desktop.log, and the failure screen quotes its
/// tail. The previous run's log is kept as desktop.previous.log.
/// </summary>
internal static class DesktopLog
{
    private static readonly object Lock = new();
    private static string? _path;

    public static string PathHint => _path ?? "(log unavailable)";

    public static void Attach(string name = "desktop")
    {
        try
        {
            Directory.CreateDirectory(App.LogDir);
            _path = Path.Combine(App.LogDir, name + ".log");
            var previous = Path.Combine(App.LogDir, name + ".previous.log");
            if (File.Exists(_path)) File.Copy(_path, previous, overwrite: true);
            File.WriteAllText(_path, $"{App.Name} {App.Version} start {DateTime.Now:O}{Environment.NewLine}");
        }
        catch
        {
            _path = null;
        }
    }

    public static void Write(string line)
    {
        if (_path is null) return;
        lock (Lock)
        {
            try { File.AppendAllText(_path, $"{DateTime.Now:HH:mm:ss.fff} {line}{Environment.NewLine}"); }
            catch { /* a log that cannot be written must never stop the app */ }
        }
    }

    public static string Tail(int lines = 16)
    {
        if (_path is null) return string.Empty;
        try
        {
            lock (Lock)
            {
                var all = File.ReadAllLines(_path);
                return string.Join(Environment.NewLine, all.Skip(Math.Max(0, all.Length - lines)));
            }
        }
        catch
        {
            return string.Empty;
        }
    }
}
