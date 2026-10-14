namespace LightMap.Desktop;

/// <summary>
/// LightMap for Windows: one window onto the same LightMap the web build serves.
///
///   LightMap.exe              the app
///   LightMap.exe --selftest   start the server headless, check it answers, exit 0 or 1 (CI uses this)
/// </summary>
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Any(a => string.Equals(a, "--selftest", StringComparison.OrdinalIgnoreCase)))
            return SelfTest.Run();

        // One LightMap per user session. A second launch brings the first window forward.
        using var mutex = new Mutex(initiallyOwned: true, App.ShellMutexName, out var firstInstance);
        if (!firstInstance)
        {
            try
            {
                using var show = EventWaitHandle.OpenExisting(App.ShowEventName);
                show.Set();
            }
            catch
            {
                // the first one is still starting; it will be in front anyway
            }
            return 0;
        }

        DesktopLog.Attach();
        DesktopLog.Write($"program {App.AppDir} (installed: {App.IsInstalled}); data {App.DataHome}");
        try
        {
            // A staged update that was never installed goes in before anything else uses the
            // program's files; setup starts LightMap again when it is done.
            if (UpdateService.ApplyStagedAtLaunch()) return 0;

            ApplicationConfiguration.Initialize();
            using var showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, App.ShowEventName);
            var form = new ShellForm();
            new Thread(() =>
            {
                try
                {
                    while (showSignal.WaitOne())
                        form.BeginInvoke(() => form.BringToFrontFromElsewhere());
                }
                catch
                {
                    // the window or the signal is gone: LightMap is closing
                }
            })
            { IsBackground = true, Name = "lightmap-second-launch" }.Start();

            Application.Run(form);
            return 0;
        }
        catch (Exception error)
        {
            DesktopLog.Write("FATAL: " + error);
            MessageBox.Show(error.Message + "\n\nDetails: " + DesktopLog.PathHint, "LightMap could not start",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            GC.KeepAlive(mutex);
        }
    }
}
