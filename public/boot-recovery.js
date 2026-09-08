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

  function recover() {
    if (recovering) return;
    if (!bootStillVisible()) return;
    try {
      if (sessionStorage.getItem(FLAG) === "1") return;
      sessionStorage.setItem(FLAG, "1");
    } catch (e) {
      /* private mode */
    }
    recovering = true;

    var reload = function () {
      location.reload();
    };

    var clearCachesThenReload = function () {
      if (!window.caches) {
        reload();
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
        .then(reload, reload);
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

  window.addEventListener(
    "error",
    function (event) {
      var t = event.target;
      if (!t || t.tagName !== "SCRIPT") return;
      var src = t.getAttribute("src") || "";
      if (src.indexOf("/assets/") === -1 && src.indexOf("/src/main.") === -1) return;
      recover();
    },
    true,
  );
})();
