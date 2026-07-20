/* SPEC-249 · ADR-0060 · snippet browser untuk mengirim error ke hanoman (Sentry ringan).
   Pemakaian: set window.HANOMAN_DSN (dan opsional window.HANOMAN_OPTS) SEBELUM memuat snippet ini.

   <script>
     window.HANOMAN_DSN = "https://hanoman.example/api/ingest/my-project?key=hnm_ing_...";
     window.HANOMAN_OPTS = { environment: "production", release: "1.2.3" };
   </script>
   <script src="/hanoman-error.js"></script>

   Fire-and-forget dengan keepalive: hanoman down / unload tak menjatuhkan halaman. */
(function (dsn, opts) {
  if (!dsn) return;
  opts = opts || {};
  function send(type, message, stack) {
    try {
      fetch(dsn, {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: type,
          message: message,
          stack: stack,
          environment: opts.environment,
          release: opts.release,
          context: { url: location.href },
        }),
      }).catch(function () { /* telan: hanoman down ≠ halaman rusak */ });
    } catch (e) { /* abaikan */ }
  }
  window.addEventListener("error", function (e) {
    var err = e.error || {};
    send(err.name || "Error", e.message || String(err), err.stack);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason || {};
    send(r.name || "UnhandledRejection", r.message || String(r), r.stack);
  });
})(window.HANOMAN_DSN, window.HANOMAN_OPTS);
