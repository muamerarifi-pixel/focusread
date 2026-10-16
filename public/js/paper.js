/* FocusRead — paper textures.
   Classic (non-module) script loaded in <head> so the chosen paper is painted
   before first render. Textures are tiny generated SVG noise tiles + CSS lines,
   so they cost no downloads and work offline. Adapts to light and dark themes.
   Choice is stored per device in localStorage('focusread_paper'). */
(function () {
  var KEY = 'focusread_paper';
  var root = document.documentElement;

  var DESIGNS = ['none', 'smooth', 'cotton', 'recycled', 'laid', 'linen', 'washi', 'antique'];
  var NAMES = {
    sq: { h: 'Sfondi i letrës', none: 'Pa teksturë', smooth: 'E lëmuar', cotton: 'Pambuk', recycled: 'E ricikluar', laid: 'Me vija', linen: 'Li', washi: 'Washi', antique: 'E vjetër' },
    en: { h: 'Paper texture', none: 'Plain', smooth: 'Smooth', cotton: 'Cotton', recycled: 'Recycled', laid: 'Laid', linen: 'Linen', washi: 'Washi', antique: 'Antique' }
  };
  // Base tone each paper gives the light themes (dark themes keep their own colour).
  var TONES = { smooth: '#fbf9f4', cotton: '#f8f3e6', recycled: '#eee8db', laid: '#f6f0e1', linen: '#f3eee3', washi: '#fbfaf6', antique: '#efe2c3' };

  function svg(w, h, freq, oct, seed, ink, a1, a0) {
    var s = "<svg xmlns='http://www.w3.org/2000/svg' width='" + w + "' height='" + h + "'>" +
      "<filter id='f' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='" + freq + "' numOctaves='" + oct + "' seed='" + seed + "' stitchTiles='stitch'/>" +
      "<feColorMatrix type='matrix' values='0 0 0 0 " + ink[0] + " 0 0 0 0 " + ink[1] + " 0 0 0 0 " + ink[2] + " " + a1 + " 0 0 0 " + a0 + "'/></filter>" +
      "<rect width='100%' height='100%' filter='url(#f)'/></svg>";
    return 'url("data:image/svg+xml,' + encodeURIComponent(s) + '")';
  }

  /** Returns [images[], sizes[]] for a design. `dark` flips the ink to light fibres. */
  function layers(name, dark) {
    var ink = dark ? [1, 1, 1] : [0.27, 0.21, 0.13];
    var k = dark ? 0.38 : 1;              // dark paper needs a lighter touch
    var line = dark ? 'rgba(255,255,255,' : 'rgba(70,52,30,';
    var L = [], S = [];
    function add(img, size) { L.push(img); S.push(size); }
    var grain = function (amt) { add(svg(180, 180, '0.85', 3, 7, ink, (1.1 * k * amt).toFixed(3), (-0.42 * k * amt).toFixed(3)), '180px 180px'); };
    switch (name) {
      case 'smooth':
        grain(0.55);
        break;
      case 'cotton':
        add(svg(420, 420, '0.012', 4, 3, ink, (0.22 * k).toFixed(3), (-0.08 * k).toFixed(3)), '420px 420px');   // soft cloudy mottling
        grain(0.75);
        break;
      case 'recycled':
        add(svg(260, 260, '0.9', 2, 11, ink, (12 * k).toFixed(2), (-9.5 * k).toFixed(2)), '260px 260px');    // dark flecks
        add(svg(320, 320, '0.05 0.3', 2, 5, ink, (1.8 * k).toFixed(2), (-1.22 * k).toFixed(2)), '320px 320px'); // short fibres
        add(svg(300, 300, '0.3 0.05', 2, 8, ink, (1.6 * k).toFixed(2), (-1.1 * k).toFixed(2)), '300px 300px');
        grain(1);
        break;
      case 'laid':
        add('repeating-linear-gradient(90deg,' + line + (0.07 * k) + ') 0 1px,transparent 1px 92px)', 'auto');
        add('repeating-linear-gradient(0deg,' + line + (0.045 * k) + ') 0 1px,transparent 1px 4px)', 'auto');
        grain(0.6);
        break;
      case 'linen':
        add('repeating-linear-gradient(0deg,' + line + (0.045 * k) + ') 0 1px,transparent 1px 3px)', 'auto');
        add('repeating-linear-gradient(90deg,' + line + (0.04 * k) + ') 0 1px,transparent 1px 3px)', 'auto');
        add(svg(300, 300, '0.004 0.25', 2, 9, ink, (0.55 * k).toFixed(2), (-0.28 * k).toFixed(2)), '300px 300px'); // slubs
        grain(0.5);
        break;
      case 'washi':
        add(svg(480, 480, '0.012 0.07', 3, 13, ink, (1.1 * k).toFixed(2), (-0.68 * k).toFixed(2)), '480px 480px'); // long fibres
        add(svg(360, 360, '0.07 0.012', 3, 17, ink, (1.0 * k).toFixed(2), (-0.63 * k).toFixed(2)), '360px 360px');
        grain(0.45);
        break;
      case 'antique':
        add('radial-gradient(120% 100% at 50% 40%,transparent 55%,' + line + (0.16 * k) + ') 100%)', '100% 100%');  // aged edges
        add(svg(520, 520, '0.02', 3, 21, dark ? ink : [0.48, 0.3, 0.08], (2.2 * k).toFixed(2), (-1.4 * k).toFixed(2)), '520px 520px'); // foxing
        add(svg(400, 400, '0.01', 4, 2, ink, (0.38 * k).toFixed(3), (-0.15 * k).toFixed(3)), '400px 400px');
        grain(0.9);
        break;
    }
    return [L, S];
  }

  function isDark() { var t = root.getAttribute('data-theme'); return t === 'dark' || t === 'oled' || t === 'night'; }
  function current() { try { var v = localStorage.getItem(KEY); return DESIGNS.indexOf(v) >= 0 ? v : 'none'; } catch (e) { return 'none'; } }

  var applying = false;
  function apply(name) {
    applying = true;
    root.setAttribute('data-paper', name);
    if (name === 'none') { root.style.removeProperty('--paper-img'); root.style.removeProperty('--paper-size'); root.style.removeProperty('--paper-tone'); }
    else {
      var l = layers(name, isDark());
      root.style.setProperty('--paper-img', l[0].join(','));
      root.style.setProperty('--paper-size', l[1].join(','));
      root.style.setProperty('--paper-tone', TONES[name]);
    }
    applying = false;
  }
  apply(current());

  // Re-tint when the theme changes (light ink on dark themes).
  new MutationObserver(function () { if (!applying) apply(current()); syncLabels(); })
    .observe(root, { attributes: true, attributeFilter: ['data-theme', 'lang'] });

  function lang() { return root.lang === 'en' ? 'en' : 'sq'; }
  function syncLabels() {
    var g = document.getElementById('paperGrid'); if (!g) return;
    var n = NAMES[lang()];
    var h = document.getElementById('paperHead'); if (h) h.textContent = n.h;
    g.querySelectorAll('button').forEach(function (b) { b.querySelector('span').textContent = n[b.dataset.paper]; b.title = n[b.dataset.paper]; });
  }

  function buildPicker() {
    var themes = document.getElementById('themeGrid');
    if (!themes || document.getElementById('paperGrid')) return;
    var h = document.createElement('h4'); h.id = 'paperHead';
    var g = document.createElement('div'); g.id = 'paperGrid'; g.className = 'papers'; g.setAttribute('role', 'radiogroup');
    var cur = current();
    DESIGNS.forEach(function (d) {
      var b = document.createElement('button'); b.type = 'button'; b.dataset.paper = d; b.setAttribute('role', 'radio');
      var sw = document.createElement('i'); sw.className = 'pp';
      if (d !== 'none') {
        var l = layers(d, false);
        sw.style.backgroundColor = TONES[d]; sw.style.backgroundImage = l[0].join(','); sw.style.backgroundSize = l[1].join(',');
      }
      b.appendChild(sw); b.appendChild(document.createElement('span'));
      b.classList.toggle('on', d === cur); b.setAttribute('aria-checked', d === cur ? 'true' : 'false');
      b.addEventListener('click', function () {
        try { localStorage.setItem(KEY, d); } catch (e) {}
        apply(d);
        g.querySelectorAll('button').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
      });
      g.appendChild(b);
    });
    themes.after(h, g);
    syncLabels();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPicker); else buildPicker();
})();
