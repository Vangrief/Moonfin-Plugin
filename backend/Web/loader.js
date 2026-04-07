// Moonfin Plugin Loader
// This file is injected into index.html by the File Transformation plugin.
// It loads the main plugin.js and plugin.css files, and adds a Moonfin
// toggle button to the Jellyfin header (next to SyncPlay).
(function () {
  "use strict";

  console.log("Moonfin loader starting...");

  function resolveMoonfinBase() {
    try {
      var api = window.ApiClient || (window.connectionManager && window.connectionManager.currentApiClient());
      if (api && typeof api.serverAddress === "function") {
        var server = api.serverAddress() || "";
        if (server) {
          // Keep only the pathname so asset URLs stay same-origin.
          var parsed = new URL(server, window.location.origin);
          var prefix = (parsed.pathname || "").replace(/\/$/, "");
          return prefix + "/Moonfin";
        }
      }
    } catch (e) {}

    // Fallback when ApiClient is not yet available.
    var path = window.location.pathname || "";
    var webIdx = path.toLowerCase().lastIndexOf("/web/");
    if (webIdx >= 0) {
      return path.substring(0, webIdx) + "/Moonfin";
    }

    return "/Moonfin";
  }

  var moonfinBase = resolveMoonfinBase();
  var baseUrl = moonfinBase + "/Web/";
  var cacheBust = "?v=" + Date.now();

  var css = document.createElement("link");
  css.rel = "stylesheet";
  css.type = "text/css";
  css.href = baseUrl + "plugin.css" + cacheBust;
  document.head.appendChild(css);

  var script = document.createElement("script");
  script.type = "text/javascript";
  script.src = baseUrl + "plugin.js" + cacheBust;
  script.onerror = function () {
    console.error("Failed to load Moonfin plugin.js from " + script.src);
  };
  document.head.appendChild(script);

  function injectHeaderButton() {
    if (document.querySelector(".headerMoonfinButton")) return;

    var syncBtn = document.querySelector(".headerSyncButton");
    var headerRight = syncBtn
      ? syncBtn.parentNode
      : document.querySelector(".headerRight");
    if (!headerRight) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "headerButton headerButtonRight headerMoonfinButton";
    btn.title = "Moonfin Settings";
    btn.innerHTML =
      '<img src="' + moonfinBase + '/Assets/icon.png" ' +
      'style="width:24px;height:24px;border-radius:4px;vertical-align:middle" ' +
      'alt="Moonfin">';
    btn.addEventListener("click", function () {
      if (window.Moonfin && window.Moonfin.Settings) {
        window.Moonfin.Settings.show();
      }
    });

    if (syncBtn) {
      headerRight.insertBefore(btn, syncBtn);
    } else {
      headerRight.insertBefore(btn, headerRight.firstChild);
    }
  }

  if (document.readyState === "complete") {
    setTimeout(injectHeaderButton, 200);
  } else {
    window.addEventListener("load", function () {
      setTimeout(injectHeaderButton, 200);
    });
  }

  // Re-inject after SPA navigations that rebuild the header
  var _lastHeader = null;
  setInterval(function () {
    var h = document.querySelector(".headerRight");
    if (h && h !== _lastHeader) {
      _lastHeader = h;
      injectHeaderButton();
    }
  }, 1000);
})();
