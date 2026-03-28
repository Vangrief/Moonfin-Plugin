using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Moonfin.Server.Api;

/// <summary>
/// Controller to serve Moonfin web plugin files.
/// </summary>
[ApiController]
[Route("Moonfin/Web")]
public class MoonfinWebController : ControllerBase
{
    private readonly Assembly _assembly;

    public MoonfinWebController()
    {
        _assembly = typeof(MoonfinWebController).Assembly;
    }

    /// <summary>
    /// Serves the Moonfin web plugin JavaScript file.
    /// </summary>
    /// <returns>The plugin.js file.</returns>
    [HttpGet("plugin.js")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult GetPluginJs()
    {
        var resourceName = "Moonfin.Server.Web.plugin.js";
        var stream = _assembly.GetManifestResourceStream(resourceName);

        if (stream == null)
        {
            return NotFound(new { Error = "plugin.js not found" });
        }

        return File(stream, "application/javascript");
    }

    /// <summary>
    /// Serves the Moonfin web plugin CSS file.
    /// </summary>
    /// <returns>The plugin.css file.</returns>
    [HttpGet("plugin.css")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult GetPluginCss()
    {
        var resourceName = "Moonfin.Server.Web.plugin.css";
        var stream = _assembly.GetManifestResourceStream(resourceName);

        if (stream == null)
        {
            return NotFound(new { Error = "plugin.css not found" });
        }

        return File(stream, "text/css");
    }

    /// <summary>
    /// Serves the Moonfin loader script.
    /// </summary>
    /// <returns>The loader.js file.</returns>
    [HttpGet("loader.js")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult GetLoaderJs()
    {
        var resourceName = "Moonfin.Server.Web.loader.js";
        var stream = _assembly.GetManifestResourceStream(resourceName);

        if (stream == null)
        {
            return NotFound(new { Error = "loader.js not found" });
        }

        return File(stream, "application/javascript");
    }
}
