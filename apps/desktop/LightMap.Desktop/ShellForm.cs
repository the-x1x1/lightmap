using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LightMap.Desktop;

/// <summary>
/// The window. It opens at once on a starting screen, starts the server, and becomes LightMap
/// when the server answers; a failure is shown in the window, in the server's own words.
/// Colours are packages/config/src/brand.ts (chrome, panelRaised, text, textMuted, sun).
/// </summary>
internal sealed class ShellForm : Form
{
    private static readonly Color Chrome = Color.FromArgb(0x0B, 0x0B, 0x0D);
    private static readonly Color PanelRaised = Color.FromArgb(0x1F, 0x1F, 0x25);
    private static readonly Color TextColor = Color.FromArgb(0xF4, 0xF4, 0xF5);
    private static readonly Color Muted = Color.FromArgb(0xA1, 0xA1, 0xAA);
    private static readonly Color Sun = Color.FromArgb(0xF5, 0xB3, 0x42);
    private static readonly Color Danger = Color.FromArgb(0xF2, 0x6D, 0x6D);

    private const int MaxAutoRestarts = 3;

    private ServerProcess _server = new();
    private WebView2? _web;
    private string _baseUrl = "";
    private int _restarts;
    private bool _closing;
    private bool _restartToInstall;
    private FormWindowState _stateBeforeFullScreen = FormWindowState.Normal;

    private readonly Panel _loading = new() { Dock = DockStyle.Fill, BackColor = Chrome };
    private readonly PictureBox _logo = new() { SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(112, 112), BackColor = Chrome };
    private readonly Label _title = new()
    {
        AutoSize = true,
        Font = new Font("Segoe UI Semibold", 20f),
        ForeColor = TextColor,
        BackColor = Chrome,
        Text = App.Name,
    };
    private readonly Label _status = new()
    {
        AutoSize = true,
        Font = new Font("Segoe UI", 10.5f),
        ForeColor = Muted,
        BackColor = Chrome,
        Text = "Starting LightMap…",
    };
    private readonly ProgressBar _activity = new() { Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 26, Size = new Size(200, 3) };
    private readonly Label _version = new()
    {
        AutoSize = true,
        Font = new Font("Segoe UI", 8.5f),
        ForeColor = Muted,
        BackColor = Chrome,
        Text = "version " + App.Version,
    };
    private TextBox? _failure;
    private Button? _retry;

    private readonly Panel _updateBar = new() { Dock = DockStyle.Top, Height = 38, BackColor = PanelRaised, Visible = false };
    private readonly Label _updateText = new()
    {
        AutoSize = true,
        Font = new Font("Segoe UI", 9.5f),
        ForeColor = TextColor,
        BackColor = PanelRaised,
    };
    private readonly Button _updateNow = new()
    {
        Text = "Restart now",
        AutoSize = true,
        FlatStyle = FlatStyle.Flat,
        ForeColor = Chrome,
        BackColor = Sun,
        Font = new Font("Segoe UI Semibold", 9f),
        Cursor = Cursors.Hand,
    };
    private readonly Button _updateLater = new()
    {
        Text = "Later",
        AutoSize = true,
        FlatStyle = FlatStyle.Flat,
        ForeColor = TextColor,
        BackColor = PanelRaised,
        Font = new Font("Segoe UI", 9f),
        Cursor = Cursors.Hand,
    };

    public ShellForm()
    {
        Text = App.Name;
        Width = 1440;
        Height = 900;
        MinimumSize = new Size(900, 600);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Chrome;
        KeyPreview = true;

        try
        {
            using var iconStream = typeof(ShellForm).Assembly.GetManifestResourceStream("LightMap.Desktop.lightmap.ico");
            if (iconStream is not null) Icon = new Icon(iconStream);
            using var logoStream = typeof(ShellForm).Assembly.GetManifestResourceStream("LightMap.Desktop.lightmap-logo.png");
            if (logoStream is not null) _logo.Image = Image.FromStream(logoStream);
        }
        catch
        {
            // unbranded but alive
        }

        _loading.Controls.AddRange([_logo, _title, _status, _activity, _version]);
        _loading.Resize += (_, _) => LayoutLoading();
        Controls.Add(_loading);

        _updateNow.FlatAppearance.BorderSize = 0;
        _updateLater.FlatAppearance.BorderColor = Muted;
        _updateNow.Click += (_, _) => RestartToInstall();
        _updateLater.Click += (_, _) => _updateBar.Visible = false;
        _updateBar.Controls.AddRange([_updateText, _updateNow, _updateLater]);
        _updateBar.Resize += (_, _) => LayoutUpdateBar();
        Controls.Add(_updateBar);
        _updateBar.SendToBack();

        RestoreWindowState();
        LayoutLoading();

        Load += (_, _) =>
        {
            BeginBoot();
            UpdateService.StartBackgroundChecks(version => BeginInvokeSafe(() => ShowUpdateReady(version)));
        };
        FormClosing += OnClosing;
        KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.F11)
            {
                SetFullScreen(FormBorderStyle != FormBorderStyle.None);
                e.Handled = true;
            }
        };
    }

    // ---- the starting screen ---------------------------------------------------------------------

    private void LayoutLoading()
    {
        var cx = _loading.ClientSize.Width / 2;
        var total = _logo.Height + 18 + _title.Height + 10 + _status.Height + 18 + _activity.Height;
        var y = Math.Max(24, (_loading.ClientSize.Height - total) / 2 - 20);
        _logo.Location = new Point(cx - _logo.Width / 2, y);
        y += _logo.Height + 18;
        _title.Location = new Point(cx - _title.Width / 2, y);
        y += _title.Height + 10;
        _status.Location = new Point(cx - _status.Width / 2, y);
        y += _status.Height + 18;
        _activity.Location = new Point(cx - _activity.Width / 2, y);
        _version.Location = new Point(16, _loading.ClientSize.Height - _version.Height - 12);
        if (_retry is not null) _retry.Location = new Point(cx - _retry.Width / 2, y + 16);
    }

    private void SetStatus(string text)
    {
        _status.Text = text;
        LayoutLoading();
    }

    private void BeginBoot()
    {
        _failure?.Dispose();
        _failure = null;
        _retry?.Dispose();
        _retry = null;
        _status.ForeColor = Muted;
        _activity.Visible = true;
        var server = _server;
        new Thread(() =>
        {
            try
            {
                var url = server.Start(s => BeginInvokeSafe(() => SetStatus(s)));
                server.Exited += code => BeginInvokeSafe(() => OnServerExited(code));
                BeginInvokeSafe(() => ShowApp(url));
            }
            catch (Exception error)
            {
                DesktopLog.Write("start: " + error.Message);
                BeginInvokeSafe(() => ShowFailure(error.Message));
            }
        })
        { IsBackground = true, Name = "lightmap-boot" }.Start();
    }

    private void OnServerExited(int code)
    {
        if (_closing) return;
        _server.Dispose();
        _server = new ServerProcess();
        if (_restarts++ < MaxAutoRestarts)
        {
            DesktopLog.Write($"the server stopped (code {code}); restarting it ({_restarts}/{MaxAutoRestarts}).");
            ShowLoading("Reconnecting…");
            BeginBoot();
            return;
        }
        ShowFailure($"The LightMap server stopped (code {code}) and kept stopping.\n\n{DesktopLog.Tail()}");
    }

    private void ShowLoading(string status)
    {
        _loading.Visible = true;
        _loading.BringToFront();
        SetStatus(status);
    }

    private void ShowFailure(string why)
    {
        ShowLoading("LightMap could not start.");
        _status.ForeColor = Danger;
        _activity.Visible = false;
        _failure = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Dock = DockStyle.Bottom,
            Height = 240,
            BorderStyle = BorderStyle.None,
            BackColor = PanelRaised,
            ForeColor = TextColor,
            Font = new Font("Consolas", 9f),
            Text = why.Replace("\r\n", "\n").Replace("\n", Environment.NewLine)
                 + Environment.NewLine + Environment.NewLine + "Log: " + DesktopLog.PathHint,
        };
        _loading.Controls.Add(_failure);
        _retry = new Button
        {
            Text = "Try again",
            AutoSize = true,
            FlatStyle = FlatStyle.Flat,
            ForeColor = Chrome,
            BackColor = Sun,
            Font = new Font("Segoe UI Semibold", 9.5f),
        };
        _retry.FlatAppearance.BorderSize = 0;
        _retry.Click += (_, _) =>
        {
            _restarts = 0;
            _server.Dispose();
            _server = new ServerProcess();
            ShowLoading("Starting LightMap…");
            BeginBoot();
        };
        _loading.Controls.Add(_retry);
        LayoutLoading();
    }

    // ---- the app -----------------------------------------------------------------------------

    private async void ShowApp(string url)
    {
        _baseUrl = url;
        _restarts = 0;
        try
        {
            if (_web is null)
            {
                SetStatus("Opening the map…");
                _web = new WebView2
                {
                    Dock = DockStyle.Fill,
                    DefaultBackgroundColor = Chrome,
                    CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = App.WebViewProfile },
                };
                Controls.Add(_web);
                await _web.EnsureCoreWebView2Async();
                ConfigureWebView(_web.CoreWebView2);
            }
            _web.CoreWebView2.Navigate(url);
            _web.BringToFront();
            _loading.Visible = false;
            DesktopLog.Write("showing " + url);
        }
        catch (Exception error)
        {
            DesktopLog.Write("webview: " + error);
            ShowFailure(
                "The Microsoft Edge WebView2 Runtime could not be started.\n\n" + error.Message
              + "\n\nInstall it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 (most Windows 10 and 11 PCs already have it), then open LightMap again."
              + "\n\nLightMap is running meanwhile and can be used in a browser at " + url);
        }
    }

    private void ConfigureWebView(CoreWebView2 core)
    {
        var settings = core.Settings;
        settings.IsStatusBarEnabled = false;
        settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("LIGHTMAP_DEVTOOLS") == "1";
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;

        core.DocumentTitleChanged += (_, _) =>
        {
            var title = core.DocumentTitle;
            Text = string.IsNullOrWhiteSpace(title) || title.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? App.Name : title;
        };

        // Links to anywhere but LightMap itself (attributions, data sources, docs) open in the
        // person's own browser, never in an unbranded popup or in place of the app.
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (IsOwn(e.Uri)) core.Navigate(e.Uri);
            else OpenExternally(e.Uri);
        };
        core.NavigationStarting += (_, e) =>
        {
            if (IsOwn(e.Uri) || e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase) || e.Uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                return;
            e.Cancel = true;
            OpenExternally(e.Uri);
        };

        // "Use my location" and the field view's camera, for LightMap's own pages only.
        core.PermissionRequested += (_, e) =>
        {
            if (!IsOwn(e.Uri)) return;
            if (e.PermissionKind is CoreWebView2PermissionKind.Geolocation or CoreWebView2PermissionKind.Camera)
                e.State = CoreWebView2PermissionState.Allow;
        };

        // Cesium's full-screen button, and the page's own requests, fill the screen like a browser does.
        core.ContainsFullScreenElementChanged += (_, _) => SetFullScreen(core.ContainsFullScreenElement);

        // A crashed or hung renderer gets the page back instead of a blank window.
        core.ProcessFailed += (_, e) =>
        {
            DesktopLog.Write($"webview: process failed ({e.ProcessFailedKind}).");
            if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                BeginInvokeSafe(() => { try { core.Reload(); } catch { } });
        };
    }

    private bool IsOwn(string uri) =>
        _baseUrl.Length > 0 && (uri.Equals(_baseUrl, StringComparison.OrdinalIgnoreCase) || uri.StartsWith(_baseUrl + "/", StringComparison.OrdinalIgnoreCase));

    private static void OpenExternally(string target)
    {
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri)) return;
        if (uri.Scheme is not ("http" or "https" or "mailto")) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
        catch (Exception error) { DesktopLog.Write("open: " + error.Message); }
    }

    private void SetFullScreen(bool on)
    {
        if (on == (FormBorderStyle == FormBorderStyle.None)) return;
        if (on)
        {
            _stateBeforeFullScreen = WindowState;
            FormBorderStyle = FormBorderStyle.None;
            if (WindowState == FormWindowState.Maximized) WindowState = FormWindowState.Normal;
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = _stateBeforeFullScreen;
        }
    }

    // ---- updates -----------------------------------------------------------------------------

    private void ShowUpdateReady(string version)
    {
        _updateText.Text = $"LightMap {version} is ready. It installs when you close LightMap.";
        _updateBar.Visible = true;
        LayoutUpdateBar();
    }

    private void LayoutUpdateBar()
    {
        var h = _updateBar.ClientSize.Height;
        _updateText.Location = new Point(16, (h - _updateText.Height) / 2);
        _updateLater.Location = new Point(_updateBar.ClientSize.Width - _updateLater.Width - 12, (h - _updateLater.Height) / 2);
        _updateNow.Location = new Point(_updateLater.Left - _updateNow.Width - 8, (h - _updateNow.Height) / 2);
    }

    private void RestartToInstall()
    {
        try
        {
            if (UpdateService.RestartToInstall())
            {
                _restartToInstall = true;
                Close();
                return;
            }
            _updateBar.Visible = false;
            MessageBox.Show(this, "There is no verified update waiting to install.", App.Name, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception error)
        {
            DesktopLog.Write("update: restart failed: " + error.Message);
            MessageBox.Show(this, "The update could not be started: " + error.Message, App.Name, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void CheckForUpdatesNow()
    {
        Cursor = Cursors.WaitCursor;
        new Thread(() =>
        {
            var message = UpdateService.CheckOnce(v => BeginInvokeSafe(() => ShowUpdateReady(v)), out _);
            BeginInvokeSafe(() =>
            {
                Cursor = Cursors.Default;
                MessageBox.Show(this, message, "LightMap updates", MessageBoxButtons.OK, MessageBoxIcon.Information);
            });
        })
        { IsBackground = true, Name = "lightmap-update-check" }.Start();
    }

    // ---- closing, a second launch, window placement -------------------------------------------

    private void OnClosing(object? sender, FormClosingEventArgs e)
    {
        _closing = true;
        SaveWindowState();
        try { _web?.Dispose(); } catch { }
        _server.Dispose();
        // A staged update installs now, silently, so the next launch is already the new version.
        // Not while Windows is shutting down: setup would be cut off half way.
        if (!_restartToInstall && e.CloseReason != CloseReason.WindowsShutDown)
            UpdateService.ApplyOnExit();
    }

    /// <summary>A second launch of LightMap brings this window forward instead of opening another.</summary>
    public void BringToFrontFromElsewhere()
    {
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show();
        Activate();
        TopMost = true;
        TopMost = false;
    }

    private sealed record WindowPlacement(int X, int Y, int Width, int Height, bool Maximized);

    private void RestoreWindowState()
    {
        try
        {
            if (!File.Exists(App.WindowStateFile)) return;
            var p = JsonSerializer.Deserialize<WindowPlacement>(File.ReadAllText(App.WindowStateFile));
            if (p is null || p.Width < MinimumSize.Width || p.Height < MinimumSize.Height) return;
            var bounds = new Rectangle(p.X, p.Y, p.Width, p.Height);
            if (!Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(bounds))) return;
            StartPosition = FormStartPosition.Manual;
            Bounds = bounds;
            if (p.Maximized) WindowState = FormWindowState.Maximized;
        }
        catch
        {
            // a remembered position is a convenience
        }
    }

    private void SaveWindowState()
    {
        try
        {
            var normal = WindowState == FormWindowState.Normal && FormBorderStyle != FormBorderStyle.None ? Bounds : RestoreBounds;
            var p = new WindowPlacement(normal.X, normal.Y, normal.Width, normal.Height, WindowState == FormWindowState.Maximized && FormBorderStyle != FormBorderStyle.None);
            Directory.CreateDirectory(App.DataHome);
            File.WriteAllText(App.WindowStateFile, JsonSerializer.Serialize(p));
        }
        catch
        {
        }
    }

    private void BeginInvokeSafe(Action action)
    {
        try
        {
            if (IsDisposed || Disposing || !IsHandleCreated) return;
            BeginInvoke(action);
        }
        catch (InvalidOperationException)
        {
            // the window is going away
        }
    }

    // ---- the window menu (Alt+Space / right-click on the title bar) ----------------------------

    private const int WM_SYSCOMMAND = 0x0112;
    private const uint MF_STRING = 0x0;
    private const uint MF_SEPARATOR = 0x800;
    private const int CmdCheckUpdates = 0x1A10;
    private const int CmdOpenInBrowser = 0x1A20;
    private const int CmdOpenDataFolder = 0x1A30;
    private const int CmdReload = 0x1A40;
    private const int CmdAbout = 0x1A50;

    [DllImport("user32.dll")]
    private static extern IntPtr GetSystemMenu(IntPtr hWnd, [MarshalAs(UnmanagedType.Bool)] bool revert);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AppendMenu(IntPtr menu, uint flags, UIntPtr id, string? text);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            // A dark title bar to match the app (20 = DWMWA_USE_IMMERSIVE_DARK_MODE; 35 = caption
            // colour on Windows 11, 0x00BBGGRR). Older Windows ignores what it does not know.
            var dark = 1;
            _ = DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
            var caption = 0x000D0B0B;
            _ = DwmSetWindowAttribute(Handle, 35, ref caption, sizeof(int));
        }
        catch { }
        try
        {
            var menu = GetSystemMenu(Handle, false);
            AppendMenu(menu, MF_SEPARATOR, UIntPtr.Zero, null);
            AppendMenu(menu, MF_STRING, (UIntPtr)CmdReload, "Reload");
            AppendMenu(menu, MF_STRING, (UIntPtr)CmdOpenInBrowser, "Open in browser");
            AppendMenu(menu, MF_STRING, (UIntPtr)CmdOpenDataFolder, "Open LightMap's data folder");
            AppendMenu(menu, MF_STRING, (UIntPtr)CmdCheckUpdates, "Check for updates…");
            AppendMenu(menu, MF_STRING, (UIntPtr)CmdAbout, "About LightMap");
        }
        catch { }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_SYSCOMMAND)
        {
            switch ((int)(m.WParam.ToInt64() & 0xFFF0))
            {
                case CmdReload:
                    try { _web?.CoreWebView2?.Reload(); } catch { }
                    return;
                case CmdOpenInBrowser:
                    if (_baseUrl.Length > 0) OpenExternally(_baseUrl);
                    return;
                case CmdOpenDataFolder:
                    try
                    {
                        Directory.CreateDirectory(App.DataHome);
                        Process.Start(new ProcessStartInfo(App.DataHome) { UseShellExecute = true });
                    }
                    catch { }
                    return;
                case CmdCheckUpdates:
                    CheckForUpdatesNow();
                    return;
                case CmdAbout:
                    MessageBox.Show(this,
                        $"LightMap {App.Version}\n\nA natural-light planner for photographers and filmmakers.\n\n"
                      + $"Program: {App.AppDir}\nData: {App.DataHome}\nServer: {(_baseUrl.Length > 0 ? _baseUrl : "not running")}\n\n"
                      + "Updates install by themselves when LightMap closes.",
                        "About LightMap", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
            }
        }
        base.WndProc(ref m);
    }
}
