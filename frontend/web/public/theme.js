/* Shared first-paint and runtime appearance owner. No storage without consent. */
(function () {
  var key = 'qsvc:theme', consentKey = 'qsvc:storage-consent:v2';
  var root = document.documentElement, listeners = new Set();
  var media;
  try { media = window.matchMedia('(prefers-color-scheme: dark)'); } catch (_) {}
  function read(name) { try { return localStorage.getItem(name); } catch (_) { return null; } }
  // This tab's own choice survives full page loads (links, Back, reloads) without consent:
  // sessionStorage is functional, never shared across tabs and cleared when the tab closes.
  function readTab() { try { return sessionStorage.getItem(key); } catch (_) { return null; } }
  function writeTab() {
    try { if (preference !== 'system') sessionStorage.setItem(key, preference); else sessionStorage.removeItem(key); }
    catch (_) { /* Blocked storage must not prevent changing appearance. */ }
  }
  function valid(value) { return value === 'light' || value === 'dark' ? value : 'system'; }
  var allowed = read(consentKey) === 'allow';
  var preference = allowed ? valid(read(key) || readTab()) : valid(readTab());
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
    setPreference: function (value) { preference = valid(value); persist(); writeTab(); apply(); },
    subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; }
  };
  if (media) {
    if (media.addEventListener) media.addEventListener('change', apply);
    else if (media.addListener) media.addListener(apply);
  }
  window.addEventListener('storage', function (event) {
    if (event.key !== key && event.key !== consentKey && event.key !== null) return;
    allowed = read(consentKey) === 'allow';
    preference = allowed ? valid(read(key)) : valid(readTab());
    apply();
  });
  window.addEventListener('qsvc:storage-consent', function (event) {
    allowed = event.detail === true;
    persist();
  });
  apply();
}());
