using System.Security.Cryptography;
using System.Text.Json;

namespace LightMap.Desktop;

/// <summary>
/// The one staged update, on disk under %LOCALAPPDATA%\LightMap\updates: the installer, and
/// pending.json naming its version and SHA-256. Staging writes files; nothing here runs anything.
/// Whatever runs a payload (UpdateService) asks <see cref="Pending"/> first, which hashes the
/// file again, so a payload altered after it was verified is refused, not run.
/// </summary>
internal static class UpdateStaging
{
    internal sealed record StagedUpdate(string Version, string Asset, string Sha256, string PayloadPath, DateTime StagedUtc);

    private static string ManifestPath => Path.Combine(App.UpdatesDir, "pending.json");

    /// <summary>
    /// The staged update, when there is one that is newer than this build and still matches its
    /// digest. Anything else found there (an update this build already is, a damaged download) is
    /// cleared, so a later launch does not trip over it again.
    /// </summary>
    public static StagedUpdate? Pending()
    {
        try
        {
            if (!File.Exists(ManifestPath)) return null;
            var staged = JsonSerializer.Deserialize<StagedUpdate>(File.ReadAllText(ManifestPath));
            if (staged is null || !App.IsNewer(staged.Version))
            {
                Clear();
                return null;
            }
            if (!File.Exists(staged.PayloadPath) || !string.Equals(Sha256File(staged.PayloadPath), staged.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                DesktopLog.Write($"update: the staged v{staged.Version} no longer matches its digest; discarded.");
                Clear();
                return null;
            }
            return staged;
        }
        catch (Exception error)
        {
            DesktopLog.Write("update: reading the staged update failed: " + error.Message);
            return null;
        }
    }

    public static void Record(StagedUpdate staged)
    {
        Directory.CreateDirectory(App.UpdatesDir);
        var temp = ManifestPath + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(staged));
        File.Move(temp, ManifestPath, overwrite: true);
    }

    /// <summary>Removes everything staged. Files in use (an installer still running) are left for next time.</summary>
    public static void Clear()
    {
        try
        {
            if (!Directory.Exists(App.UpdatesDir)) return;
            foreach (var file in Directory.EnumerateFiles(App.UpdatesDir))
            {
                try { File.Delete(file); }
                catch { /* in use; the next clear gets it */ }
            }
        }
        catch { }
    }

    /// <summary>"&lt;64 hex&gt;  &lt;name&gt;" (sha256sum's format) or a bare digest → lower-case hex; anything else → null.</summary>
    public static string? ParseDigest(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var first = text.Trim().Split((char[]?)null, 2, StringSplitOptions.RemoveEmptyEntries)[0];
        if (first.Length != 64 || !first.All(Uri.IsHexDigit)) return null;
        return first.ToLowerInvariant();
    }

    public static string Sha256File(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }
}
