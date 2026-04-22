using System.Collections.Generic;
using MediaBrowser.Model.Plugins;
using Moonfin.Server.Models;

namespace Moonfin.Server;

/// <summary>
/// Admin-level plugin configuration for Moonfin.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Enable settings sync across Moonfin clients.
    /// </summary>
    public bool EnableSettingsSync { get; set; } = true;

    /// <summary>
    /// Enable Seerr integration for all users.
    /// </summary>
    public bool JellyseerrEnabled { get; set; } = false;

    /// <summary>
    /// Seerr server URL for server-to-server communication from Jellyfin.
    /// Example: http://seerr:5055 or http://192.168.50.20:5055
    /// </summary>
    public string? JellyseerrUrl { get; set; }

    /// <summary>
    /// Optional display name override (e.g., "Requests", "Media Requests").
    /// Leave empty to auto-detect based on server version.
    /// </summary>
    public string? JellyseerrDisplayName { get; set; }

    /// <summary>
    /// Server-wide MDBList API key shared with all users.
    /// Users who set their own key will use that instead.
    /// </summary>
    public string? MdblistApiKey { get; set; }

    /// <summary>
    /// Server-wide TMDB API key shared with all users.
    /// Users who set their own key will use that instead.
    /// </summary>
    public string? TmdbApiKey { get; set; }

    /// <summary>
    /// Admin-configured default settings for all users.
    /// Users who haven't customized a setting will inherit this value.
    /// Users can override any default in their own Moonfin settings.
    /// </summary>
    public MoonfinSettingsProfile? DefaultUserSettings { get; set; }

    /// <summary>
    /// Admin-hinterlegte Jellyseerr-Credentials pro Jellyfin-User.
    /// Wenn für einen User ein aktivierter Eintrag existiert, loggt das Plugin den User
    /// beim ersten Jellyseerr-Proxy-Request automatisch ein (ohne doppelte Anmeldung).
    /// Passwörter werden im Klartext in der Plugin-Config gespeichert — nur durch
    /// OS-Dateisystem-Rechte geschützt.
    /// </summary>
    public List<JellyseerrUserCredential> JellyseerrUserCredentials { get; set; } = new();

    /// <summary>
    /// Gets the effective Seerr URL for server-to-server communication.
    /// </summary>
    public string? GetEffectiveJellyseerrUrl()
    {
        return JellyseerrUrl?.TrimEnd('/');
    }
}

/// <summary>
/// Ein hinterlegtes Jellyseerr-Credential für einen bestimmten Jellyfin-User.
/// </summary>
public class JellyseerrUserCredential
{
    /// <summary>Die Jellyfin-User-ID.</summary>
    public Guid JellyfinUserId { get; set; }

    /// <summary>
    /// Der Username für die Jellyseerr-Anmeldung.
    /// Bei AuthType="jellyfin": Jellyfin-Username. Bei AuthType="local": Jellyseerr-Email.
    /// </summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>Das Passwort im Klartext.</summary>
    public string Password { get; set; } = string.Empty;

    /// <summary>Auth-Typ: "jellyfin" (default) oder "local".</summary>
    public string AuthType { get; set; } = "jellyfin";

    /// <summary>Nur aktivierte Credentials werden für Auto-Login verwendet.</summary>
    public bool Enabled { get; set; } = true;
}
