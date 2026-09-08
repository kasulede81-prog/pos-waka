/**
 * Unsticks the HTML "Waka POS / Loading…" splash when the hashed app bundle
 * never runs (typical after a deploy: stale service-worker index.html → 404 JS).
 * This file is unhashed so it can run even if the Vite module never loads.
 */
(function () {
  var FLAG = "waka.html-boot-recovery";
  var recovering = false;

  function bootStillVisible() {
    var el = document.getElementById("waka-html-boot");
    return Boolean(el && el.isConnected);
  }

  function showStuckHelp() {
    var el = document.getElementById("waka-html-boot");
    if (!el || document.getElementById("waka-html-boot-retry")) return;
    var hint = document.createElement("span");
    hint.textContent = "This page got stuck after an update.";
    hint.style.cssText = "font-size:0.75rem;font-weight:600;color:#7c2d12;max-width:16rem;text-align:center";
    var btn = document.createElement("button");
    btn.id = "waka-html-boot-retry";
    btn.type = "button";
    btn.textContent = "Tap to reload";
    btn.style.cssText =
      "margin-top:8px;min-height:44px;padding:10px 18px;border:0;border-radius:12px;background:#9a3412;color:#fffaf5;font-weight:800;font-size:0.875rem";
    btn.addEventListener("click", function () {
      try {
        sessionStorage.removeItem(FLAG);
      } catch (e) {
        /* private mode */
      }
      recover(true);
    });
    el.appendChild(hint);
    el.appendChild(btn);
  }

  function reloadPage() {
    try {
      location.reload();
    } catch (e) {
      location.href = location.href;
    }
  }

  function recover(force) {
    if (recovering) return;
    if (!bootStillVisible()) return;
    try {
      if (!force && sessionStorage.getItem(FLAG) === "1") {
        showStuckHelp();
        return;
      }
      sessionStorage.setItem(FLAG, "1");
    } catch (e) {
      /* private mode */
    }
    recovering = true;

    var finish = function () {
      var reloaded = false;
      var go = function () {
        if (reloaded) return;
        reloaded = true;
        reloadPage();
      };
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.addEventListener("controllerchange", go);
        setTimeout(go, 800);
      } else {
        go();
      }
    };

    var clearCachesThenReload = function () {
      if (!window.caches) {
        finish();
        return;
      }
      caches
        .keys()
        .then(function (keys) {
          return Promise.all(
            keys.map(function (k) {
              return caches.delete(k);
            }),
          );
        })
        .then(finish, finish);
    };

    if (!("serviceWorker" in navigator)) {
      clearCachesThenReload();
      return;
    }

    navigator.serviceWorker
      .getRegistrations()
      .then(function (regs) {
        return Promise.all(
          regs.map(function (r) {
            return r.unregister();
          }),
        );
      })
      .then(clearCachesThenReload, clearCachesThenReload);
  }

  function isAppScript(src) {
    return src.indexOf("/assets/") !== -1 || src.indexOf("/src/main.") !== -1;
  }

  window.addEventListener(
    "error",
    function (event) {
      var t = event.target;
      if (t && t.tagName === "SCRIPT") {
        var src = t.getAttribute("src") || "";
        if (isAppScript(src)) recover(false);
        return;
      }
      var msg = String((event && event.message) || "");
      if (/Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg)) {
        recover(false);
      }
    },
    true,
  );

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    var msg = reason && (reason.message || String(reason));
    if (typeof msg === "string" && /Failed to fetch|Importing a module script failed|Loading chunk/i.test(msg)) {
      recover(false);
    }
  });

  setTimeout(function () {
    if (bootStillVisible()) recover(false);
  }, 4000);
})();
