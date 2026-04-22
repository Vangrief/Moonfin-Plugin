using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Moonfin.Server.Services;

/// <summary>
/// Manages per-user Seerr session cookies for SSO.
/// Sessions are stored server-side so any Moonfin client
/// can access Seerr through the Jellyfin plugin without re-authenticating.
/// </summary>
public class JellyseerrSessionService
{
    private readonly string _sessionsPath;
    private readonly JsonSerializerOptions _jsonOptions;
    private readonly ILogger<JellyseerrSessionService> _logger;
    private readonly IHttpClientFactory _httpClientFactory;
    private static readonly SemaphoreSlim _lock = new(1, 1);
    private static readonly string[] CsrfCookieNames = { "XSRF-TOKEN", "_csrf", "csrf", "csrfToken" };
    private static readonly string[] CsrfProbePaths = { "/", "/api/v1/settings/public" };

    public JellyseerrSessionService(
        ILogger<JellyseerrSessionService> logger,
        IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _httpClientFactory = httpClientFactory;

        var dataPath = MoonfinPlugin.Instance?.DataFolderPath
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Jellyfin", "plugins", "Moonfin");

        _sessionsPath = Path.Combine(dataPath, "jellyseerr-sessions");

        _jsonOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true
        };

        EnsureDirectory();
    }

    private void EnsureDirectory()
    {
        if (!Directory.Exists(_sessionsPath))
        {
            Directory.CreateDirectory(_sessionsPath);
        }
    }

    private string GetSessionPath(Guid userId) =>
        Path.Combine(_sessionsPath, $"{userId}.json");

    private async Task<string?> FetchCsrfTokenAsync(HttpClient client, string jellyseerrUrl, CookieContainer cookieContainer)
    {
        var baseUrl = jellyseerrUrl.TrimEnd('/');
        var baseUri = new Uri(baseUrl);

        foreach (var path in CsrfProbePaths)
        {
            try
            {
                using var response = await client.GetAsync(
                    baseUrl + path,
                    HttpCompletionOption.ResponseHeadersRead);

                var cookies = cookieContainer.GetCookies(baseUri);
                foreach (var name in CsrfCookieNames)
                {
                    var cookie = cookies[name];
                    if (cookie != null && !string.IsNullOrEmpty(cookie.Value))
                        return Uri.UnescapeDataString(cookie.Value);
                }

                if (!response.Headers.TryGetValues("Set-Cookie", out var setCookieHeaders))
                    continue;

                foreach (var header in setCookieHeaders)
                {
                    foreach (var name in CsrfCookieNames)
                    {
                        var prefix = name + "=";
                        if (!header.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                            continue;

                        var value = header[prefix.Length..];
                        var semi = value.IndexOf(';');
                        if (semi > 0) value = value[..semi];
                        return Uri.UnescapeDataString(value);
                    }
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogDebug(ex, "CSRF prefetch failed for {Url} (non-fatal)", baseUrl + path);
            }
        }

        return null;
    }

    /// <summary>
    /// Authenticates a Jellyfin user with Seerr and stores the session.
    /// </summary>
    /// <param name="userId">The Jellyfin user ID.</param>
    /// <param name="username">The username.</param>
    /// <param name="password">The password.</param>
    /// <param name="authType">Auth type: "jellyfin" (default) or "local" for a native Seerr account.</param>
    /// <returns>The authenticated Seerr user info, or null on failure.</returns>
    public async Task<JellyseerrAuthResult?> AuthenticateAsync(Guid userId, string username, string? password, string? authType = null)
    {
        var config = MoonfinPlugin.Instance?.Configuration;
        var jellyseerrUrl = config?.GetEffectiveJellyseerrUrl();

        if (string.IsNullOrEmpty(jellyseerrUrl))
        {
            _logger.LogError("Seerr URL not configured");
            return null;
        }

        try
        {
            var cookieContainer = new CookieContainer();
            using var handler = new HttpClientHandler
            {
                CookieContainer = cookieContainer,
                UseCookies = true
            };
            using var client = new HttpClient(handler);
            client.Timeout = TimeSpan.FromSeconds(15);

            var isLocal = string.Equals(authType, "local", StringComparison.OrdinalIgnoreCase);
            var authEndpoint = isLocal
                ? $"{jellyseerrUrl}/api/v1/auth/local"
                : $"{jellyseerrUrl}/api/v1/auth/jellyfin";

            var authPayload = isLocal
                ? (object)new { email = username, password = password }
                : new { username = username, password = password ?? string.Empty };

            var content = new StringContent(
                JsonSerializer.Serialize(authPayload),
                Encoding.UTF8,
                "application/json");

            var csrfToken = await FetchCsrfTokenAsync(client, jellyseerrUrl, cookieContainer);

            var request = new HttpRequestMessage(HttpMethod.Post, authEndpoint) { Content = content };
            if (!string.IsNullOrEmpty(csrfToken))
            {
                request.Headers.Add("X-CSRF-Token", csrfToken);
            }

            var response = await client.SendAsync(request);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("Seerr auth failed for user {Username}: {Status} - {Error}",
                    username, response.StatusCode, errorBody);
                return new JellyseerrAuthResult
                {
                    Success = false,
                    Error = response.StatusCode == HttpStatusCode.Forbidden
                        ? "Access denied. Make sure you have a Seerr account."
                        : $"Authentication failed: {response.StatusCode}"
                };
            }

            // Extract session cookie
            // CookieContainer.GetCookies() can fail with IP-based URLs, so
            // fall back to parsing the Set-Cookie header directly.
            var cookies = cookieContainer.GetCookies(new Uri(jellyseerrUrl));
            var sessionCookie = cookies["connect.sid"]?.Value;

            if (string.IsNullOrEmpty(sessionCookie) &&
                response.Headers.TryGetValues("Set-Cookie", out var setCookieHeaders))
            {
                foreach (var header in setCookieHeaders)
                {
                    if (header.StartsWith("connect.sid=", StringComparison.OrdinalIgnoreCase))
                    {
                        var value = header.Substring("connect.sid=".Length);
                        var semicolonIdx = value.IndexOf(';');
                        if (semicolonIdx > 0)
                        {
                            value = value.Substring(0, semicolonIdx);
                        }
                        sessionCookie = Uri.UnescapeDataString(value);
                        _logger.LogInformation("Extracted connect.sid from Set-Cookie header (CookieContainer fallback)");
                        break;
                    }
                }
            }

            if (string.IsNullOrEmpty(sessionCookie))
            {
                _logger.LogWarning("No session cookie received from Seerr for user {Username}", username);
                return new JellyseerrAuthResult
                {
                    Success = false,
                    Error = "No session cookie received from Seerr"
                };
            }

            // Parse the user response
            var responseBody = await response.Content.ReadAsStringAsync();
            var userInfo = JsonSerializer.Deserialize<JsonElement>(responseBody);

            // Store the session
            var session = new JellyseerrSession
            {
                JellyfinUserId = userId,
                SessionCookie = sessionCookie,
                JellyseerrUserId = userInfo.TryGetProperty("id", out var idProp) ? idProp.GetInt32() : 0,
                Username = username,
                DisplayName = userInfo.TryGetProperty("displayName", out var dnProp) ? dnProp.GetString() : username,
                Avatar = userInfo.TryGetProperty("avatar", out var avProp) ? avProp.GetString() : null,
                Permissions = userInfo.TryGetProperty("permissions", out var permProp) ? permProp.GetInt32() : 0,
                CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                LastValidated = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };

            await SaveSessionAsync(session);

            _logger.LogInformation("Seerr SSO session created for user {Username} (Jellyfin: {UserId})",
                username, userId);

            return new JellyseerrAuthResult
            {
                Success = true,
                JellyseerrUserId = session.JellyseerrUserId,
                DisplayName = session.DisplayName,
                Avatar = session.Avatar,
                Permissions = session.Permissions
            };
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Failed to connect to Seerr at {Url}", jellyseerrUrl);
            return new JellyseerrAuthResult
            {
                Success = false,
                Error = $"Cannot reach Seerr: {ex.Message}"
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error during Seerr auth for user {Username}", username);
            return new JellyseerrAuthResult
            {
                Success = false,
                Error = "An unexpected error occurred"
            };
        }
    }

    /// <summary>
    /// Gets the stored session for a user, optionally validating it.
    /// </summary>
    public async Task<JellyseerrSession?> GetSessionAsync(Guid userId, bool validate = false)
    {
        var session = await LoadSessionAsync(userId);
        if (session == null || string.IsNullOrEmpty(session.SessionCookie))
        {
            if (session != null)
            {
                _logger.LogWarning("Seerr session for user {UserId} has empty cookie, treating as invalid", userId);
            }
            return null;
        }

        if (validate)
        {
            var isValid = await ValidateSessionAsync(session);
            if (!isValid)
            {
                _logger.LogInformation("Seerr session expired for user {UserId}, removing", userId);
                await ClearSessionAsync(userId);
                return null;
            }
        }

        return session;
    }

    /// <summary>
    /// Stellt sicher, dass eine Session für den User existiert. Falls keine vorhanden ist,
    /// wird anhand der admin-hinterlegten Credentials automatisch ein Login versucht.
    /// Gibt null zurück wenn weder Session noch Auto-Login-Credential verfügbar sind.
    /// </summary>
    public async Task<JellyseerrSession?> EnsureSessionAsync(Guid userId)
    {
        var session = await LoadSessionAsync(userId);
        if (session != null && !string.IsNullOrEmpty(session.SessionCookie))
        {
            return session;
        }

        return await TryAutoLoginAsync(userId);
    }

    /// <summary>
    /// Versucht einen Auto-Login für den gegebenen User anhand der admin-hinterlegten
    /// Credentials. Gibt die neu erstellte Session zurück, oder null wenn kein passendes
    /// aktives Credential existiert bzw. der Login fehlschlug.
    /// </summary>
    public async Task<JellyseerrSession?> TryAutoLoginAsync(Guid userId)
    {
        var config = MoonfinPlugin.Instance?.Configuration;
        var cred = config?.JellyseerrUserCredentials?
            .FirstOrDefault(c => c.JellyfinUserId == userId && c.Enabled);

        if (cred == null || string.IsNullOrEmpty(cred.Username))
        {
            return null;
        }

        _logger.LogInformation("Seerr auto-login attempt for user {UserId} (authType={AuthType})",
            userId, cred.AuthType);

        var result = await AuthenticateAsync(userId, cred.Username, cred.Password, cred.AuthType);
        if (result == null || !result.Success)
        {
            _logger.LogWarning("Seerr auto-login failed for user {UserId}: {Error}",
                userId, result?.Error ?? "unknown");
            return null;
        }

        return await LoadSessionAsync(userId);
    }

    /// <summary>
    /// Validates a stored session by calling Seerr's /auth/me endpoint.
    /// </summary>
    private async Task<bool> ValidateSessionAsync(JellyseerrSession session)
    {
        var config = MoonfinPlugin.Instance?.Configuration;
        var jellyseerrUrl = config?.GetEffectiveJellyseerrUrl();

        if (string.IsNullOrEmpty(jellyseerrUrl)) return false;

        try
        {
            var cookieContainer = new CookieContainer();
            cookieContainer.Add(new Uri(jellyseerrUrl), new Cookie("connect.sid", session.SessionCookie));

            using var handler = new HttpClientHandler
            {
                CookieContainer = cookieContainer,
                UseCookies = true
            };
            using var client = new HttpClient(handler);
            client.Timeout = TimeSpan.FromSeconds(10);

            var response = await client.GetAsync($"{jellyseerrUrl}/api/v1/auth/me");

            if (response.IsSuccessStatusCode)
            {
                await CheckForRotatedCookieAsync(session, response, cookieContainer, jellyseerrUrl);

                // Update last validated timestamp
                session.LastValidated = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                await SaveSessionAsync(session);
                return true;
            }

            return false;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to validate Seerr session for user {UserId}", session.JellyfinUserId);
            return false;
        }
    }

    /// <summary>
    /// Checks if Seerr rotated the connect.sid cookie and updates the session if so.
    /// Express.js with rolling sessions may issue a new cookie on every response.
    /// </summary>
    private async Task CheckForRotatedCookieAsync(
        JellyseerrSession session,
        HttpResponseMessage response,
        CookieContainer cookieContainer,
        string jellyseerrUrl)
    {
        var updatedCookie = cookieContainer.GetCookies(new Uri(jellyseerrUrl))["connect.sid"]?.Value;
        if (string.IsNullOrEmpty(updatedCookie) &&
            response.Headers.TryGetValues("Set-Cookie", out var setCookieHeaders))
        {
            foreach (var header in setCookieHeaders)
            {
                if (header.StartsWith("connect.sid=", StringComparison.OrdinalIgnoreCase))
                {
                    var value = header.Substring("connect.sid=".Length);
                    var semicolonIdx = value.IndexOf(';');
                    if (semicolonIdx > 0) value = value.Substring(0, semicolonIdx);
                    updatedCookie = Uri.UnescapeDataString(value);
                    break;
                }
            }
        }

        if (!string.IsNullOrEmpty(updatedCookie) && updatedCookie != session.SessionCookie)
        {
            _logger.LogInformation("Seerr rotated session cookie for user {UserId}, updating", session.JellyfinUserId);
            session.SessionCookie = updatedCookie;
            await SaveSessionAsync(session);
        }
    }

    public async Task ClearSessionAsync(Guid userId)
    {
        await _lock.WaitAsync();
        try
        {
            var path = GetSessionPath(userId);
            if (File.Exists(path))
            {
                File.Delete(path);
                _logger.LogInformation("Seerr session cleared for user {UserId}", userId);
            }
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// Proxies an HTTP request to Seerr with the user's stored session cookie.
    /// </summary>
    /// <param name="userId">The Jellyfin user ID.</param>
    /// <param name="method">HTTP method.</param>
    /// <param name="path">API path (e.g., "auth/me", "request", "search").</param>
    /// <param name="queryString">Optional query string.</param>
    /// <param name="body">Optional request body.</param>
    /// <param name="contentType">Content type of the body.</param>
    /// <returns>The proxied response.</returns>
    public async Task<JellyseerrProxyResponse> ProxyRequestAsync(
        Guid userId,
        HttpMethod method,
        string path,
        string? queryString = null,
        byte[]? body = null,
        string? contentType = null)
    {
        var config = MoonfinPlugin.Instance?.Configuration;
        var jellyseerrUrl = config?.GetEffectiveJellyseerrUrl();

        if (string.IsNullOrEmpty(jellyseerrUrl))
        {
            return new JellyseerrProxyResponse
            {
                StatusCode = 503,
                Body = JsonSerializer.SerializeToUtf8Bytes(new { error = "Seerr URL not configured" }),
                ContentType = "application/json"
            };
        }

        var session = await EnsureSessionAsync(userId);
        if (session == null)
        {
            return new JellyseerrProxyResponse
            {
                StatusCode = 401,
                Body = JsonSerializer.SerializeToUtf8Bytes(new { error = "Not authenticated with Seerr", code = "NO_SESSION" }),
                ContentType = "application/json"
            };
        }

        try
        {
            var (statusCode, responseBody, responseContentType, authExpired) =
                await ExecuteApiRequestAsync(session, jellyseerrUrl, method, path, queryString, body, contentType);

            // Falls die Session abgelaufen ist, versuche einmalig einen Auto-Re-Login und wiederhole.
            if (authExpired)
            {
                _logger.LogInformation("Seerr session expired for user {UserId}, attempting auto re-login", userId);
                await ClearSessionAsync(userId);

                var freshSession = await TryAutoLoginAsync(userId);
                if (freshSession != null)
                {
                    (statusCode, responseBody, responseContentType, authExpired) =
                        await ExecuteApiRequestAsync(freshSession, jellyseerrUrl, method, path, queryString, body, contentType);
                }

                if (freshSession == null || authExpired)
                {
                    return new JellyseerrProxyResponse
                    {
                        StatusCode = 401,
                        Body = JsonSerializer.SerializeToUtf8Bytes(new { error = "Seerr session expired", code = "SESSION_EXPIRED" }),
                        ContentType = "application/json"
                    };
                }
            }

            return new JellyseerrProxyResponse
            {
                StatusCode = statusCode,
                Body = responseBody,
                ContentType = responseContentType
            };
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Failed to proxy request to Seerr: {Path}", path);
            return new JellyseerrProxyResponse
            {
                StatusCode = 502,
                Body = JsonSerializer.SerializeToUtf8Bytes(new { error = $"Cannot reach Seerr: {ex.Message}" }),
                ContentType = "application/json"
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error proxying to Seerr: {Path}", path);
            return new JellyseerrProxyResponse
            {
                StatusCode = 500,
                Body = JsonSerializer.SerializeToUtf8Bytes(new { error = "Internal proxy error" }),
                ContentType = "application/json"
            };
        }
    }

    /// <summary>
    /// Proxies a raw HTTP request to Seerr for web content (no /api/v1/ prefix).
    /// Session cookie is optional — if unavailable, the request proceeds without auth.
    /// </summary>
    public async Task<JellyseerrProxyResponse> ProxyWebRequestAsync(
        Guid userId,
        HttpMethod method,
        string path,
        string? queryString = null,
        byte[]? body = null,
        string? contentType = null)
    {
        var config = MoonfinPlugin.Instance?.Configuration;
        var jellyseerrUrl = config?.GetEffectiveJellyseerrUrl();

        if (string.IsNullOrEmpty(jellyseerrUrl))
        {
            return new JellyseerrProxyResponse
            {
                StatusCode = 503,
                Body = Encoding.UTF8.GetBytes("Seerr not configured"),
                ContentType = "text/plain"
            };
        }

        // Versuche Auto-Login, bleibe aber tolerant — Web-Requests dürfen auch ohne Session laufen
        // (z.B. initiale Login-Seiten-Assets die Jellyseerr selber public ausliefert).
        var session = await EnsureSessionAsync(userId);

        try
        {
            var (statusCode, responseBody, responseContentType, authExpired) =
                await ExecuteWebRequestAsync(session, jellyseerrUrl, method, path, queryString, body, contentType);

            if (authExpired && session != null)
            {
                _logger.LogInformation("Seerr web session expired for user {UserId}, attempting auto re-login", userId);
                await ClearSessionAsync(userId);

                var freshSession = await TryAutoLoginAsync(userId);
                if (freshSession != null)
                {
                    (statusCode, responseBody, responseContentType, authExpired) =
                        await ExecuteWebRequestAsync(freshSession, jellyseerrUrl, method, path, queryString, body, contentType);
                }
            }

            return new JellyseerrProxyResponse
            {
                StatusCode = statusCode,
                Body = responseBody,
                ContentType = responseContentType
            };
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Failed to proxy web request to Seerr: {Path}", path);
            return new JellyseerrProxyResponse
            {
                StatusCode = 502,
                Body = Encoding.UTF8.GetBytes($"Cannot reach Seerr: {ex.Message}"),
                ContentType = "text/plain"
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error proxying web request to Seerr: {Path}", path);
            return new JellyseerrProxyResponse
            {
                StatusCode = 500,
                Body = Encoding.UTF8.GetBytes("Internal proxy error"),
                ContentType = "text/plain"
            };
        }
    }

    /// <summary>
    /// Führt den eigentlichen API-Request gegen Jellyseerr aus. Gibt Status, Body, Content-Type
    /// und ein Flag zurück ob die Session abgelaufen ist (401/403).
    /// </summary>
    private async Task<(int StatusCode, byte[] Body, string ContentType, bool AuthExpired)> ExecuteApiRequestAsync(
        JellyseerrSession session,
        string jellyseerrUrl,
        HttpMethod method,
        string path,
        string? queryString,
        byte[]? body,
        string? contentType)
    {
        var cookieContainer = new CookieContainer();
        cookieContainer.Add(new Uri(jellyseerrUrl), new Cookie("connect.sid", session.SessionCookie));

        using var handler = new HttpClientHandler
        {
            CookieContainer = cookieContainer,
            UseCookies = true
        };
        using var client = new HttpClient(handler);
        client.Timeout = TimeSpan.FromSeconds(30);

        var targetUrl = $"{jellyseerrUrl}/api/v1/{path.TrimStart('/')}";
        if (!string.IsNullOrEmpty(queryString))
        {
            targetUrl += $"?{queryString.TrimStart('?')}";
        }

        var request = new HttpRequestMessage(method, targetUrl);

        if (method != HttpMethod.Get && method != HttpMethod.Head)
        {
            var csrfToken = await FetchCsrfTokenAsync(client, jellyseerrUrl, cookieContainer);
            if (!string.IsNullOrEmpty(csrfToken))
            {
                request.Headers.Add("X-CSRF-Token", csrfToken);
            }
        }

        if (body != null && body.Length > 0)
        {
            request.Content = new ByteArrayContent(body);
            request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(
                contentType ?? "application/json");
        }

        var response = await client.SendAsync(request);
        var responseBody = await response.Content.ReadAsByteArrayAsync();
        var responseContentType = response.Content.Headers.ContentType?.ToString() ?? "application/json";

        var authExpired = response.StatusCode == HttpStatusCode.Unauthorized
            || response.StatusCode == HttpStatusCode.Forbidden;

        if (response.IsSuccessStatusCode)
        {
            await CheckForRotatedCookieAsync(session, response, cookieContainer, jellyseerrUrl);
        }

        return ((int)response.StatusCode, responseBody, responseContentType, authExpired);
    }

    /// <summary>
    /// Führt den eigentlichen Web-Request gegen Jellyseerr aus (rohe Pfade ohne /api/v1/-Präfix).
    /// </summary>
    private async Task<(int StatusCode, byte[] Body, string ContentType, bool AuthExpired)> ExecuteWebRequestAsync(
        JellyseerrSession? session,
        string jellyseerrUrl,
        HttpMethod method,
        string path,
        string? queryString,
        byte[]? body,
        string? contentType)
    {
        var cookieContainer = new CookieContainer();
        if (session != null)
        {
            cookieContainer.Add(new Uri(jellyseerrUrl), new Cookie("connect.sid", session.SessionCookie));
        }

        using var handler = new HttpClientHandler
        {
            CookieContainer = cookieContainer,
            UseCookies = true,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli
        };
        using var client = new HttpClient(handler);
        client.Timeout = TimeSpan.FromSeconds(30);

        var targetUrl = $"{jellyseerrUrl}/{path?.TrimStart('/') ?? ""}";
        if (!string.IsNullOrEmpty(queryString))
        {
            targetUrl += queryString.StartsWith('?') ? queryString : $"?{queryString}";
        }

        var request = new HttpRequestMessage(method, targetUrl);

        if (body != null && body.Length > 0)
        {
            request.Content = new ByteArrayContent(body);
            if (!string.IsNullOrEmpty(contentType))
            {
                request.Content.Headers.TryAddWithoutValidation("Content-Type", contentType);
            }
        }

        var response = await client.SendAsync(request);
        var responseBody = await response.Content.ReadAsByteArrayAsync();
        var responseContentType = response.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";

        var authExpired = response.StatusCode == HttpStatusCode.Unauthorized
            || response.StatusCode == HttpStatusCode.Forbidden;

        if (session != null && response.IsSuccessStatusCode)
        {
            await CheckForRotatedCookieAsync(session, response, cookieContainer, jellyseerrUrl);
        }

        return ((int)response.StatusCode, responseBody, responseContentType, authExpired);
    }

    private async Task SaveSessionAsync(JellyseerrSession session)
    {
        await _lock.WaitAsync();
        try
        {
            EnsureDirectory();
            var json = JsonSerializer.Serialize(session, _jsonOptions);
            await File.WriteAllTextAsync(GetSessionPath(session.JellyfinUserId), json);
        }
        finally
        {
            _lock.Release();
        }
    }

    private async Task<JellyseerrSession?> LoadSessionAsync(Guid userId)
    {
        var path = GetSessionPath(userId);
        if (!File.Exists(path)) return null;

        await _lock.WaitAsync();
        try
        {
            var json = await File.ReadAllTextAsync(path);
            return JsonSerializer.Deserialize<JellyseerrSession>(json, _jsonOptions);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load Seerr session for user {UserId}", userId);
            return null;
        }
        finally
        {
            _lock.Release();
        }
    }
}

/// <summary>
/// Stored Seerr session data for a Jellyfin user.
/// </summary>
public class JellyseerrSession
{
    /// <summary>The Jellyfin user ID this session belongs to.</summary>
    [JsonPropertyName("jellyfinUserId")]
    public Guid JellyfinUserId { get; set; }

    /// <summary>The Seerr connect.sid session cookie value.</summary>
    [JsonPropertyName("sessionCookie")]
    public string SessionCookie { get; set; } = string.Empty;

    /// <summary>The Seerr internal user ID.</summary>
    [JsonPropertyName("jellyseerrUserId")]
    public int JellyseerrUserId { get; set; }

    /// <summary>The username used to authenticate.</summary>
    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;

    /// <summary>Display name from Seerr.</summary>
    [JsonPropertyName("displayName")]
    public string? DisplayName { get; set; }

    /// <summary>Avatar URL from Seerr.</summary>
    [JsonPropertyName("avatar")]
    public string? Avatar { get; set; }

    /// <summary>Seerr permission bitmask.</summary>
    [JsonPropertyName("permissions")]
    public int Permissions { get; set; }

    /// <summary>When the session was created (unix ms).</summary>
    [JsonPropertyName("createdAt")]
    public long CreatedAt { get; set; }

    /// <summary>When the session was last validated (unix ms).</summary>
    [JsonPropertyName("lastValidated")]
    public long LastValidated { get; set; }
}

/// <summary>
/// Result of a Seerr authentication attempt.
/// </summary>
public class JellyseerrAuthResult
{
    /// <summary>Whether authentication succeeded.</summary>
    public bool Success { get; set; }

    /// <summary>Error message if auth failed.</summary>
    public string? Error { get; set; }

    /// <summary>Seerr user ID if successful.</summary>
    public int JellyseerrUserId { get; set; }

    /// <summary>Display name from Seerr.</summary>
    public string? DisplayName { get; set; }

    /// <summary>Avatar URL.</summary>
    public string? Avatar { get; set; }

    /// <summary>Seerr permission bitmask.</summary>
    public int Permissions { get; set; }
}

/// <summary>
/// Response from a proxied Seerr request.
/// </summary>
public class JellyseerrProxyResponse
{
    /// <summary>HTTP status code.</summary>
    public int StatusCode { get; set; }

    /// <summary>Response body bytes.</summary>
    public byte[]? Body { get; set; }

    /// <summary>Response content type.</summary>
    public string ContentType { get; set; } = "application/json";
}
