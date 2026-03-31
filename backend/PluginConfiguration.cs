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
    /// Gets the effective Seerr URL for server-to-server communication.
    /// </summary>
    public string? GetEffectiveJellyseerrUrl()
    {
        return JellyseerrUrl?.TrimEnd('/');
    }
}
