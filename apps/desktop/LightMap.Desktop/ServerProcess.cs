using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace LightMap.Desktop;

/// <summary>
/// The LightMap server (Next.js standalone output) run by the bundled node.exe, on loopback only.
///
/// The child is put in a job object with KILL_ON_JOB_CLOSE, so the kernel kills it whenever this
/// process ends, crash included: a desktop app must never leave a headless node.exe behind.
/// </summary>
internal sealed class ServerProcess : IDisposable
{
    /// <summary>
    /// The port is fixed on purpose. The app keeps saved places and settings in the page's own
    /// storage, which belongs to an origin (scheme, host AND port); a different port every run
    /// would look like an empty app every run. The fallbacks are only for a machine where
    /// something else already holds it, and the log says so when one is used.
    /// </summary>
    public const int PreferredPort = 47615;
    private const int PortAttempts = 10;

    /// <summary>Set by LightMap itself; lightmap.env cannot override these.</summary>
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
    {
        "PORT", "HOSTNAME", "NEXT_PUBLIC_APP_URL",
    };

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(3) };

    private Process? _node;
    private SafeJobHandle? _job;
    private bool _stopping;

    public string BaseUrl { get; private set; } = "";

    /// <summary>Raised (on a worker thread) when the server stops without being asked to.</summary>
    public event Action<int>? Exited;

    /// <summary>Starts the server and waits until it answers. Throws with a readable message.</summary>
    public string Start(Action<string> status)
    {
        if (!File.Exists(App.NodeExe))
            throw new InvalidOperationException(
                $"The Node runtime was not found at {App.NodeExe}.\n\nThis install looks incomplete; reinstalling LightMap fixes it.");
        if (!File.Exists(App.ServerScript))
            throw new InvalidOperationException(
                $"The LightMap server was not found at {App.ServerScript}.\n\nThis install looks incomplete; reinstalling LightMap fixes it.");

        var port = FreePort();
        BaseUrl = $"http://127.0.0.1:{port}";
        if (port != PreferredPort)
            DesktopLog.Write($"port {PreferredPort} is in use; serving on {port} for this run (saved places live with port {PreferredPort}).");

        status("Starting LightMap…");
        var info = new ProcessStartInfo(App.NodeExe)
        {
            WorkingDirectory = App.ServerDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        info.ArgumentList.Add(App.ServerScript);

        // The defaults that make a production server run on one machine for its owner:
        // no database, no accounts, map and planning only (docs/RELEASE_PROCESS.md §5a).
        info.Environment["NODE_ENV"] = "production";
        info.Environment["LIGHTMAP_STANDALONE"] = "true";
        info.Environment["LIGHTMAP_DESKTOP"] = "1";
        info.Environment["NEXT_TELEMETRY_DISABLED"] = "1";
        foreach (var (key, value) in ReadEnvFile())
        {
            if (Reserved.Contains(key)) continue;
            info.Environment[key] = value;
        }
        info.Environment["PORT"] = port.ToString();
        info.Environment["HOSTNAME"] = "127.0.0.1";
        info.Environment["NEXT_PUBLIC_APP_URL"] = BaseUrl;

        _node = new Process { StartInfo = info, EnableRaisingEvents = true };
        _node.OutputDataReceived += (_, e) => { if (e.Data is not null) DesktopLog.Write("server: " + e.Data); };
        _node.ErrorDataReceived += (_, e) => { if (e.Data is not null) DesktopLog.Write("server! " + e.Data); };
        _node.Exited += (_, _) =>
        {
            var code = SafeExitCode(_node);
            DesktopLog.Write($"server exited (code {code})");
            if (!_stopping) Exited?.Invoke(code);
        };
        _node.Start();
        _node.BeginOutputReadLine();
        _node.BeginErrorReadLine();
        AdoptIntoJob(_node);
        DesktopLog.Write($"started {App.NodeExe} (pid {_node.Id}) for {BaseUrl}");

        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(90);
        while (DateTime.UtcNow < deadline)
        {
            if (IsLightMapServing(BaseUrl)) return BaseUrl;
            if (_node.HasExited)
                throw new InvalidOperationException(
                    $"The LightMap server stopped while starting (code {SafeExitCode(_node)}).\n\n{DesktopLog.Tail()}");
            Thread.Sleep(200);
        }
        throw new InvalidOperationException($"LightMap did not answer on {BaseUrl} within 90 seconds.\n\n{DesktopLog.Tail()}");
    }

    /// <summary>Is LightMap answering there? /api/health names its version, so anything else is told apart.</summary>
    public static bool IsLightMapServing(string baseUrl)
    {
        try
        {
            var body = Http.GetStringAsync(baseUrl + "/api/health").GetAwaiter().GetResult();
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.TryGetProperty("version", out _) && doc.RootElement.TryGetProperty("fixtureMode", out _);
        }
        catch
        {
            return false;
        }
    }

    private static int FreePort()
    {
        for (var port = PreferredPort; port < PreferredPort + PortAttempts; port++)
        {
            try
            {
                var probe = new TcpListener(IPAddress.Loopback, port);
                probe.Start();
                probe.Stop();
                return port;
            }
            catch (SocketException)
            {
                // taken; try the next one
            }
        }
        throw new InvalidOperationException(
            $"No free port between {PreferredPort} and {PreferredPort + PortAttempts - 1} on this computer.");
    }

    /// <summary>
    /// %LOCALAPPDATA%\LightMap\lightmap.env: KEY=VALUE lines for the server, the same keys
    /// .env.example documents (a Cesium ion token, a land-cover tile source, ...). Optional.
    /// A commented template is written the first time so there is something to edit.
    /// </summary>
    private static List<(string Key, string Value)> ReadEnvFile()
    {
        var result = new List<(string Key, string Value)>();
        var path = App.EnvFile;
        string[] lines;
        try
        {
            if (!File.Exists(path))
            {
                Directory.CreateDirectory(App.DataHome);
                File.WriteAllText(path, EnvTemplate);
                return result;
            }
            lines = File.ReadAllLines(path);
        }
        catch (Exception error)
        {
            DesktopLog.Write("lightmap.env: " + error.Message);
            return result;
        }
        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            if (line.StartsWith("export ", StringComparison.Ordinal)) line = line[7..].TrimStart();
            var eq = line.IndexOf('=');
            if (eq <= 0) continue;
            var key = line[..eq].Trim();
            var value = line[(eq + 1)..].Trim();
            if (value.Length >= 2 && (value[0] == '"' || value[0] == '\'') && value[^1] == value[0])
                value = value[1..^1];
            result.Add((key, value));
        }
        return result;
    }

    private const string EnvTemplate =
        "# LightMap desktop settings for the built-in server. One KEY=VALUE per line; restart LightMap after editing.\r\n"
      + "# The keys are the ones .env.example in the LightMap repository documents. Examples:\r\n"
      + "#\r\n"
      + "# CESIUM_ION_TOKEN=\r\n"
      + "# IMAGERY_PROVIDER=cesium-ion\r\n"
      + "# BUILDINGS_PROVIDER=cesium-osm\r\n"
      + "# GEOCODER_USER_AGENT=LightMap-desktop (you@example.com)\r\n";

    private static int SafeExitCode(Process? p)
    {
        try { return p?.ExitCode ?? -1; }
        catch { return -1; }
    }

    public void Dispose()
    {
        _stopping = true;
        try { if (_node is { HasExited: false }) _node.Kill(entireProcessTree: true); }
        catch { /* the job below is the guarantee */ }
        try { _node?.Dispose(); } catch { }
        try { _job?.Dispose(); } catch { }
        _node = null;
        _job = null;
    }

    // ---- the job object ------------------------------------------------------------------------

    private void AdoptIntoJob(Process child)
    {
        try
        {
            var job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return;
            _job = new SafeJobHandle(job);

            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
            {
                BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION { LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE },
            };
            var size = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
            var buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(limits, buffer, false);
                if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)size))
                    DesktopLog.Write("job: could not set kill-on-close; the server is stopped on exit instead");
                else if (!AssignProcessToJobObject(job, child.Handle))
                    DesktopLog.Write("job: could not adopt the server process");
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        catch (Exception error)
        {
            DesktopLog.Write("job: " + error.Message);
        }
    }

    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string? name);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    private sealed class SafeJobHandle(IntPtr handle) : IDisposable
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr h);

        public void Dispose()
        {
            if (handle != IntPtr.Zero) CloseHandle(handle);
        }
    }
}
