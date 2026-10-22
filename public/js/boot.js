// Runs before first paint: apply saved theme/lang to avoid a flash of the wrong theme.
// Apply saved theme before first paint (avoids flash).
try { var s = JSON.parse(localStorage.getItem('focusread_settings_v6') || '{}'); var th = s.theme || 'auto';
  if (th === 'auto') th = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', th); if (s.lang) document.documentElement.lang = s.lang; } catch (e) {}
  // Soft reading guide (Page mode glow + gentler sentence highlight).
try { import('/js/spotlight.js'); } catch (e) {}
// v6.7: shadow behind the text (strength in %, 50 by default), add-on styles, book covers / table of contents (js/extras.js)
try { var sv = localStorage.getItem('focusread_shadow'), sp = sv === null || sv === '' ? 50 : Math.max(0, Math.min(100, Number(sv) || 0)); document.documentElement.setAttribute('data-shadow', sp ? 'on' : 'off'); document.documentElement.style.setProperty('--tsa', String(sp / 100)); } catch (e) {}
try { var xl = document.createElement('link'); xl.rel = 'stylesheet'; xl.href = '/css/extra.css'; document.head.appendChild(xl); } catch (e) {}
try { import('/js/extras.js').catch(function () {}); } catch (e) {}
// v6.8: knobs, dimming, full screen, sun theme, page bar, classic book (js/plus.js)
try { if (localStorage.getItem('focusread_classic') !== '0') document.documentElement.setAttribute('data-classic', ''); } catch (e) {}
try { import('/js/plus.js').catch(function () {}); } catch (e) {}
