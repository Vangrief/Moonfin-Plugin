using System.Collections.Concurrent;
using System.Net.Mime;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moonfin.Server.Services;

namespace Moonfin.Server.Api;

/// <summary>
/// API controller for Jellyseerr SSO proxy.
/// Handles authentication, session management, and API proxying so that
/// any Moonfin client can access Jellyseerr through the Jellyfin server.
/// </summary>
[ApiController]
[Route("Moonfin/Jellyseerr")]
[Produces(MediaTypeNames.Application.Json)]
public class JellyseerrProxyController : ControllerBase
{
    private readonly JellyseerrSessionService _sessionService;

    public JellyseerrProxyController(JellyseerrSessionService sessionService)
    {
        _sessionService = sessionService;
    }

    /// <summary>
    /// Authenticate with Seerr using Jellyfin credentials.
    /// The session cookie is stored server-side and associated with the Jellyfin user.
    /// Any Moonfin client can then proxy requests through this plugin.
    /// </summary>
    /// <param name="request">Jellyfin credentials for Seerr auth.</param>
    /// <returns>Authentication result with Seerr user info.</returns>
    [HttpPost("Login")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> Login([FromBody] JellyseerrLoginRequest request)
    {
        var config = MoonfinPlugin.Instance?.Configuration;
        var jellyseerrUrl = config?.GetEffectiveJellyseerrUrl();
        if (config?.JellyseerrEnabled != true || string.IsNullOrEmpty(jellyseerrUrl))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { error = "Seerr integration is not enabled" });
        }

        var userId = this.GetUserIdFromClaims();
        if (userId == null)
        {
            return Unauthorized(new { error = "User not authenticated" });
        }

        if (string.IsNullOrEmpty(request.Username))
        {
            return BadRequest(new { error = "Username is required" });
        }

        var result = await _sessionService.AuthenticateAsync(
            userId.Value, request.Username, request.Password,
            request.AuthType);

        if (result == null || !result.Success)
        {
            return Unauthorized(new
            {
                error = result?.Error ?? "Authentication failed",
                success = false
            });
        }

        return Ok(new
        {
            success = true,
            jellyseerrUserId = result.JellyseerrUserId,
            displayName = result.DisplayName,
            avatar = result.Avatar,
            permissions = result.Permissions
        });
    }

    /// <summary>
    /// Check the current user's Seerr SSO session status.
    /// </summary>
    /// <returns>Session status including whether authenticated and user info.</returns>
    [HttpGet("Status")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetStatus()
    {
        var config = MoonfinPlugin.Instance?.Configuration;
        var jellyseerrUrl = config?.GetEffectiveJellyseerrUrl();
        if (config?.JellyseerrEnabled != true || string.IsNullOrEmpty(jellyseerrUrl))
        {
            return Ok(new
            {
                enabled = false,
                authenticated = false,
                url = (string?)null
            });
        }

        var userId = this.GetUserIdFromClaims();
        if (userId == null)
        {
            return Ok(new
            {
                enabled = true,
                authenticated = false,
                url = jellyseerrUrl
            });
        }

        var session = await _sessionService.GetSessionAsync(userId.Value, validate: false);

        return Ok(new
        {
            enabled = true,
            authenticated = session != null,
            url = jellyseerrUrl,
            jellyseerrUserId = session?.JellyseerrUserId,
            displayName = session?.DisplayName,
            avatar = session?.Avatar,
            permissions = session?.Permissions ?? 0,
            sessionCreated = session?.CreatedAt,
            lastValidated = session?.LastValidated
        });
    }

    /// <summary>
    /// Validate the current session is still active with Seerr.
    /// </summary>
    /// <returns>Whether the session is valid.</returns>
    [HttpGet("Validate")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> Validate()
    {
        var userId = this.GetUserIdFromClaims();
        if (userId == null)
        {
            return Ok(new { valid = false, error = "Not authenticated with Jellyfin" });
        }

        var session = await _sessionService.GetSessionAsync(userId.Value, validate: true);

        return Ok(new
        {
            valid = session != null,
            lastValidated = session?.LastValidated
        });
    }

    /// <summary>
    /// Clear the current user's Seerr SSO session.
    /// </summary>
    [HttpDelete("Logout")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> Logout()
    {
        var userId = this.GetUserIdFromClaims();
        if (userId == null)
        {
            return Unauthorized(new { error = "User not authenticated" });
        }

        await _sessionService.ProxyRequestAsync(
            userId.Value,
            HttpMethod.Post,
            "auth/logout");

        await _sessionService.ClearSessionAsync(userId.Value);

        return Ok(new { success = true, message = "Logged out from Seerr" });
    }

    /// <summary>
    /// Proxy GET requests to Seerr API.
    /// Path is relative to /api/v1/ (e.g., "auth/me", "request", "search?query=foo").
    /// </summary>
    [HttpGet("Api/{**path}")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> ProxyGet(string path)
    {
        return await ProxyApiRequest(HttpMethod.Get, path);
    }

    /// <summary>
    /// Proxy POST requests to Seerr API.
    /// </summary>
    [HttpPost("Api/{**path}")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> ProxyPost(string path)
    {
        return await ProxyApiRequest(HttpMethod.Post, path);
    }

    /// <summary>
    /// Proxy PUT requests to Seerr API.
    /// </summary>
    [HttpPut("Api/{**path}")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> ProxyPut(string path)
    {
        return await ProxyApiRequest(HttpMethod.Put, path);
    }

    /// <summary>
    /// Proxy DELETE requests to Seerr API.
    /// </summary>
    [HttpDelete("Api/{**path}")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> ProxyDelete(string path)
    {
        return await ProxyApiRequest(HttpMethod.Delete, path);
    }

    private async Task<IActionResult> ProxyApiRequest(HttpMethod method, string path)
    {
        var config = MoonfinPlugin.Instance?.Configuration;
        var jellyseerrUrl = config?.GetEffectiveJellyseerrUrl();
        if (config?.JellyseerrEnabled != true || string.IsNullOrEmpty(jellyseerrUrl))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { error = "Seerr integration is not enabled" });
        }

        var userId = this.GetUserIdFromClaims();
        if (userId == null)
        {
            return Unauthorized(new { error = "User not authenticated" });
        }

        byte[]? body = null;
        string? contentType = null;

        if (method == HttpMethod.Post || method == HttpMethod.Put)
        {
            using var ms = new MemoryStream();
            await Request.Body.CopyToAsync(ms);
            body = ms.ToArray();
            contentType = Request.ContentType;
        }

        var result = await _sessionService.ProxyRequestAsync(
            userId.Value,
            method,
            path,
            Request.QueryString.Value,
            body,
            contentType);

        if (result.Body == null)
        {
            return StatusCode(result.StatusCode);
        }

        var responseContentType = string.IsNullOrWhiteSpace(result.ContentType)
            ? MediaTypeNames.Application.Octet
            : result.ContentType;

        Response.StatusCode = result.StatusCode;
        return File(result.Body, responseContentType);
    }

    private const string ProxyBasePathSuffix = "/Moonfin/Jellyseerr/Web";

    // Short-lived proxy sessions keyed by token, allowing iframe sub-resource loads without api_key in every URL.
    private static readonly ConcurrentDictionary<string, (Guid UserId, DateTimeOffset Expiry)> _proxySessions = new();

    /// <summary>
    /// Proxies Seerr web content through the Jellyfin server, injecting the stored
    /// SSO session cookie. This allows the Seerr iframe to be pre-authenticated.
    /// The first request must include api_key for Jellyfin auth; a proxy session cookie is
    /// then set so subsequent resource loads (scripts, styles, etc.) don't need it.
    /// </summary>
    [Route("Web/{**path}")]
    [Route("Web")]
    [AllowAnonymous]
    [ApiExplorerSettings(IgnoreApi = true)]
    [AcceptVerbs("GET", "POST", "PUT", "DELETE")]
    public async Task<IActionResult> ProxyWeb(string? path = null)
    {
        var userId = GetProxySessionUserId() ?? GetJellyfinAuthUserId();
        if (userId == null)
        {
            return Unauthorized("Authentication required");
        }

        EnsureProxySession(userId.Value);

        var method = new HttpMethod(Request.Method);

        byte[]? body = null;
        string? contentType = null;
        if (method == HttpMethod.Post || method == HttpMethod.Put)
        {
            using var ms = new MemoryStream();
            await Request.Body.CopyToAsync(ms);
            body = ms.ToArray();
            contentType = Request.ContentType;
        }

        var queryString = StripQueryParam(Request.QueryString.Value, "api_key");

        var result = await _sessionService.ProxyWebRequestAsync(
            userId.Value,
            method,
            path ?? "",
            queryString,
            body,
            contentType);

        if (result.Body == null)
        {
            return StatusCode(result.StatusCode);
        }

        var responseContentType = string.IsNullOrWhiteSpace(result.ContentType)
            ? MediaTypeNames.Application.Octet
            : result.ContentType;

        if (responseContentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
        {
            var config = MoonfinPlugin.Instance?.Configuration;
            var configuredPublicUrl = config?.JellyseerrUrl?.TrimEnd('/') ?? string.Empty;
            var proxyBasePath = GetProxyBasePath();
            var assetBaseHref = ResolveAssetBaseHref(configuredPublicUrl, proxyBasePath);
            var html = Encoding.UTF8.GetString(result.Body);
            html = RewriteHtmlForProxy(html, assetBaseHref, proxyBasePath);
            return new ContentResult
            {
                Content = html,
                ContentType = "text/html; charset=utf-8",
                StatusCode = result.StatusCode
            };
        }

        if (responseContentType.Contains("text/css", StringComparison.OrdinalIgnoreCase))
        {
            var css = Encoding.UTF8.GetString(result.Body);
            css = RewriteCssForProxy(css, GetProxyBasePath());
            Response.StatusCode = result.StatusCode;
            return File(Encoding.UTF8.GetBytes(css), responseContentType);
        }

        Response.StatusCode = result.StatusCode;
        return File(result.Body, responseContentType);
    }

    private Guid? GetProxySessionUserId()
    {
        var cookie = Request.Cookies["moonfin_proxy"];
        if (string.IsNullOrEmpty(cookie)) return null;

        if (_proxySessions.TryGetValue(cookie, out var session) && session.Expiry > DateTimeOffset.UtcNow)
        {
            return session.UserId;
        }

        _proxySessions.TryRemove(cookie, out _);
        return null;
    }

    private Guid? GetJellyfinAuthUserId()
    {
        return User.Identity?.IsAuthenticated == true ? this.GetUserIdFromClaims() : null;
    }

    private void EnsureProxySession(Guid userId)
    {
        var existingCookie = Request.Cookies["moonfin_proxy"];
        if (!string.IsNullOrEmpty(existingCookie)
            && _proxySessions.TryGetValue(existingCookie, out var existing)
            && existing.Expiry > DateTimeOffset.UtcNow)
        {
            return;
        }

        // Periodically evict expired entries to prevent unbounded growth.
        var now = DateTimeOffset.UtcNow;
        if (_proxySessions.Count > 100)
        {
            foreach (var kvp in _proxySessions)
            {
                if (kvp.Value.Expiry < now)
                    _proxySessions.TryRemove(kvp.Key, out _);
            }
        }

        if (!string.IsNullOrEmpty(existingCookie))
        {
            _proxySessions.TryRemove(existingCookie, out _);
        }

        var token = Guid.NewGuid().ToString("N");
        _proxySessions[token] = (userId, now.AddHours(12));

        var proxyBasePath = GetProxyBasePath();
        Response.Cookies.Append("moonfin_proxy", token, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Strict,
            Path = proxyBasePath,
            MaxAge = TimeSpan.FromHours(12),
            Secure = Request.IsHttps
        });
    }

    private string GetProxyBasePath()
    {
        var pathBase = Request.PathBase.HasValue
            ? (Request.PathBase.Value?.TrimEnd('/') ?? string.Empty)
            : string.Empty;
        return pathBase + ProxyBasePathSuffix;
    }

    private static string? StripQueryParam(string? queryString, string param)
    {
        if (string.IsNullOrEmpty(queryString)) return null;

        var parts = queryString.TrimStart('?').Split('&')
            .Where(p => !p.StartsWith(param + "=", StringComparison.OrdinalIgnoreCase))
            .ToArray();

        return parts.Length > 0 ? "?" + string.Join("&", parts) : null;
    }

    private string ResolveAssetBaseHref(string configuredPublicUrl, string proxyBasePath)
    {
        // Cross-origin asset bases (e.g., Jellyfin at :8096, Seerr at :5055) can fail
        // for fonts/CSP/history in iframe contexts. In that case, keep assets on proxy.
        if (string.IsNullOrEmpty(configuredPublicUrl))
        {
            return proxyBasePath + "/";
        }

        if (!Uri.TryCreate(configuredPublicUrl, UriKind.Absolute, out var configuredUri))
        {
            return proxyBasePath + "/";
        }

        if (!IsSameOrigin(configuredUri, Request.Scheme, Request.Host))
        {
            return proxyBasePath + "/";
        }

        return configuredPublicUrl + "/";
    }

    private static bool IsSameOrigin(Uri uri, string requestScheme, HostString requestHost)
    {
        if (!string.Equals(uri.Scheme, requestScheme, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (!string.Equals(uri.Host, requestHost.Host, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var expectedPort = requestHost.Port ?? (string.Equals(requestScheme, "https", StringComparison.OrdinalIgnoreCase) ? 443 : 80);
        return uri.Port == expectedPort;
    }

    private static string RewriteHtmlForProxy(string html, string assetBaseHref, string proxyBasePath)
    {
        html = Regex.Replace(
            html,
            "(?<attr>\\b(?:src|href)\\s*=\\s*[\"'])/(?!(?:/|Moonfin/))",
            "$1" + proxyBasePath + "/",
            RegexOptions.IgnoreCase);

        var escapedPath = proxyBasePath.TrimStart('/').Replace("/", "\\/");
        html = html
            .Replace("\\/_next\\/", $"\\/{escapedPath}\\/_next\\/", StringComparison.Ordinal)
            .Replace("\"/_next/", $"\"{proxyBasePath}/_next/", StringComparison.Ordinal)
            .Replace("'/_next/", $"'{proxyBasePath}/_next/", StringComparison.Ordinal)
            .Replace("=/_next/", $"={proxyBasePath}/_next/", StringComparison.Ordinal)
            .Replace("\\/imageproxy\\/", $"\\/{escapedPath}\\/imageproxy\\/", StringComparison.Ordinal)
            .Replace("\"/imageproxy/", $"\"{proxyBasePath}/imageproxy/", StringComparison.Ordinal)
            .Replace("'/imageproxy/", $"'{proxyBasePath}/imageproxy/", StringComparison.Ordinal)
            .Replace("=/imageproxy/", $"={proxyBasePath}/imageproxy/", StringComparison.Ordinal);

        var headIdx = html.IndexOf("<head", StringComparison.OrdinalIgnoreCase);
        if (headIdx >= 0)
        {
            var closeIdx = html.IndexOf('>', headIdx);
            if (closeIdx >= 0)
            {
                var baseTag = !string.IsNullOrEmpty(assetBaseHref)
                    ? $"<base href=\"{assetBaseHref}\">"
                    : string.Empty;
                html = html.Insert(closeIdx + 1, baseTag + GetProxyScript(proxyBasePath));
            }
        }

        return html;
    }

    private static string RewriteCssForProxy(string css, string proxyBasePath)
    {
        css = Regex.Replace(
            css,
            "url\\(\\s*(['\\\"]?)\\/(?!\\/|Moonfin\\/)",
            $"url($1{proxyBasePath}/",
            RegexOptions.IgnoreCase);

        css = Regex.Replace(
            css,
            "@import\\s+(['\\\"])\\/(?!\\/|Moonfin\\/)",
            $"@import $1{proxyBasePath}/",
            RegexOptions.IgnoreCase);

        return css;
    }

    private static string GetProxyScript(string proxyBasePath)
    {
        var escapedBasePath = proxyBasePath.Replace("'", "\\'");
        const string scriptTemplate = @"<script data-moonfin-proxy>(function(){
var b='__MOONFIN_PROXY_BASE__';
function r(v){return typeof v==='string'&&v.length>1&&v[0]==='/'&&v[1]!=='/'&&v.indexOf(b)!==0?b+v:v}

var F=window.fetch;window.fetch=function(u,o){if(typeof u==='string')return F.call(this,r(u),o);if(u instanceof Request)return F.call(this,new Request(r(u.url),u),o);return F.call(this,u,o)};

var X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){if(typeof arguments[1]==='string')arguments[1]=r(arguments[1]);return X.apply(this,arguments)};

var HP=history.pushState.bind(history);history.pushState=function(s,t,u){return HP(s,t,r(u))};
var HR=history.replaceState.bind(history);history.replaceState=function(s,t,u){return HR(s,t,r(u))};

var rewriteAttr=function(el,attr){var v=el.getAttribute(attr);if(v)el.setAttribute(attr,r(v))};
var scriptEls=document.getElementsByTagName('script');for(var i=0;i<scriptEls.length;i++)rewriteAttr(scriptEls[i],'src');
var linkEls=document.getElementsByTagName('link');for(var i=0;i<linkEls.length;i++)rewriteAttr(linkEls[i],'href');
var imgEls=document.getElementsByTagName('img');for(var i=0;i<imgEls.length;i++)rewriteAttr(imgEls[i],'src');

try{
    var d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    if(d&&d.set){
        Object.defineProperty(HTMLImageElement.prototype,'src',{
            get:d.get,
            set:function(v){d.set.call(this,r(v))},
            enumerable:d.enumerable,
            configurable:true
        });
    }
}catch(e){}

var rewriteNode=function(n){
    if(!n||n.nodeType!==1)return n;
    if(n.tagName==='SCRIPT')rewriteAttr(n,'src');
    else if(n.tagName==='LINK')rewriteAttr(n,'href');
    else if(n.tagName==='IMG')rewriteAttr(n,'src');
    else if(n.tagName==='A')rewriteAttr(n,'href');
    return n;
};
var AC=Node.prototype.appendChild;
Node.prototype.appendChild=function(n){return AC.call(this,rewriteNode(n))};
var IB=Node.prototype.insertBefore;
Node.prototype.insertBefore=function(n,rn){return IB.call(this,rewriteNode(n),rn)};

document.addEventListener('click',function(e){
    var n=e.target;
    while(n&&n!==document){
        if(n.tagName==='A'){
            var h=n.getAttribute('href');
            if(typeof h==='string'&&h.length>1&&h[0]==='/'&&h[1]!=='/'&&h.indexOf(b)!==0){
                n.setAttribute('href',b+h);
            }
            break;
        }
        n=n.parentElement;
    }
},true);
})()</script>";

        return scriptTemplate.Replace("__MOONFIN_PROXY_BASE__", escapedBasePath, StringComparison.Ordinal);
    }
}

/// <summary>
/// Request body for Seerr login.
/// </summary>
public class JellyseerrLoginRequest
{
    /// <summary>Username (Jellyfin or local Seerr account).</summary>
    public string? Username { get; set; }

    /// <summary>Password.</summary>
    public string? Password { get; set; }

    /// <summary>
    /// Authentication type: "jellyfin" (default) or "local".
    /// Determines which Seerr auth endpoint is used.
    /// </summary>
    public string? AuthType { get; set; }
}
