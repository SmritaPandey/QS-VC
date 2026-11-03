/* Shared first-paint and runtime appearance owner. No storage without consent. */
(function () {
  var key = 'qsvc:theme', consentKey = 'qsvc:storage-consent:v2';
  var root = document.documentElement, listeners = new Set();
  var media;
  try { media = window.matchMedia('(prefers-color-scheme: dark)'); } catch (_) {}
  function read(name) { try { return localStorage.getItem(name); } catch (_) { return null; } }
  function valid(value) { return value === 'light' || value === 'dark' ? value : 'system'; }
  var allowed = read(consentKey) === 'allow';
  var preference = allowed ? valid(read(key)) : 'system';
  function apply() {
    var resolved = preference === 'system' ? (media && media.matches ? 'dark' : 'light') : preference;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = resolved === 'dark' ? '#0b1420' : '#f5f8fa';
    listeners.forEach(function (listener) { listener(); });
  }
  function persist() {
    try {
      if (allowed && preference !== 'system') localStorage.setItem(key, preference);
      else localStorage.removeItem(key);
    } catch (_) { /* A blocked store must not prevent changing appearance. */ }
  }
  window.qsvcTheme = {
    getPreference: function () { return preference; },
    setPreference: function (value) { preference = valid(value); persist(); apply(); },
    subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; }
  };
  if (media) {
    if (media.addEventListener) media.addEventListener('change', apply);
    else if (media.addListener) media.addListener(apply);
  }
  window.addEventListener('storage', function (event) {
    if (event.key !== key && event.key !== consentKey && event.key !== null) return;
    allowed = read(consentKey) === 'allow';
    preference = allowed ? valid(read(key)) : 'system';
    apply();
  });
  window.addEventListener('qsvc:storage-consent', function (event) {
    allowed = event.detail === true;
    persist();
  });
  apply();
}());
