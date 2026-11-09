document.documentElement.classList.add('qsvc-boot');
    var qsvcBootStarted = performance.now();
    window.addEventListener('qsvc:ready', function () {
      clearTimeout(window.qsvcBootTimeout);
      var remaining = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0 : Math.max(0, 3000 - (performance.now() - qsvcBootStarted));
      setTimeout(function () {
        document.documentElement.classList.remove('qsvc-boot');
        document.getElementById('qsvc-startup')?.remove();
      }, remaining);
    }, { once: true });
    window.qsvcBootTimeout = setTimeout(function () {
      document.documentElement.classList.remove('qsvc-boot');
      var overlay = document.getElementById('qsvc-startup');
      if (!overlay) return;
      overlay.setAttribute('data-slow', '');
      overlay.querySelector('[data-boot-lines]').hidden = true;
      overlay.querySelector('[data-boot-status]').classList.remove('boot-sr-only');
      overlay.querySelector('[data-boot-status]').textContent = 'Taking longer than expected. Reload or continue with available content.';
      overlay.querySelector('[data-boot-recovery]').hidden = false;
      overlay.querySelector('[data-boot-continue]').hidden = !document.getElementById('root')?.hasChildNodes();
    }, 8000);

    document.addEventListener('DOMContentLoaded', function () {
      document.querySelector('[data-boot-continue]')?.addEventListener('click', function () { document.getElementById('qsvc-startup')?.remove(); });
    });
