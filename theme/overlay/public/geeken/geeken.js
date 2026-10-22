(function () {
  fetch('/geeken/config.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (c) {
      document.documentElement.style.setProperty('--geeken-accent', c.accent || '#6c63ff');

      if (c.name) {
        document.title = document.title.replace(/Pterodactyl/gi, c.name);
        var apply = function () {
          var nav = document.getElementById('NavigationBar');
          var a = nav && nav.querySelector('a');
          if (!a || a.dataset.geeken) return;
          a.dataset.geeken = '1';
          a.textContent = '';
          if (c.logo) {
            var img = document.createElement('img');
            img.src = c.logo; img.alt = c.name;
            img.style.cssText = 'height:28px;margin-right:8px;vertical-align:middle;display:inline-block';
            a.appendChild(img);
          }
          a.appendChild(document.createTextNode(c.name));
        };
        new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
        apply();
      }

      (c.addons || []).forEach(function (n) {
        if (!/^[a-z0-9-]+$/.test(n)) return;
        var s = document.createElement('script');
        s.defer = true;
        s.src = '/geeken/addons/' + n + '/addon.js';
        document.head.appendChild(s);
      });
    })
    .catch(function () {});
})();
