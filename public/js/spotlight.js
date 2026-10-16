// Gentle reading guide: replaces the hard word-by-word highlight with a soft,
// blurred glow that glides along the line (Page mode), and softens the
// highlighted word in the sentence shown under the big word (Words mode).
// It only observes the page — the reading engine in app.js is unchanged.

const CSS = `
.pacer-page w,.pacer-page w.c{background:none!important;box-shadow:none!important}
.pacer-page w{transition:color .45s ease}
.pacer-page w.c{color:var(--fg)}
.pacer-page w.r{color:color-mix(in srgb,var(--fg) 58%,transparent)}
.fr-spot{position:absolute;left:0;top:0;width:0;height:0;z-index:-1;pointer-events:none;border-radius:999px;
  background:radial-gradient(closest-side,var(--hl) 0%,var(--hl) 45%,transparent 100%);
  filter:blur(5px);opacity:0;will-change:transform,width;
  transition:transform .32s cubic-bezier(.22,.8,.3,1),width .32s cubic-bezier(.22,.8,.3,1),height .32s ease,opacity .35s ease}
.fr-spot.on{opacity:1}
.fr-spot.jump{transition:opacity .35s ease}
.sentence-trail mark{background:none;color:var(--fg);padding:0;border-radius:0;
  text-shadow:0 0 .7em var(--hl),0 0 .25em var(--hl);transition:color .3s ease}
@media (prefers-reduced-motion: reduce){.fr-spot{transition:opacity .2s ease}.pacer-page w{transition:none}}
`;

function init() {
  const pacer = document.getElementById('pacer');
  const page = document.getElementById('pacerPage');
  if (!pacer || !page) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const spot = document.createElement('div');
  spot.className = 'fr-spot';
  spot.setAttribute('aria-hidden', 'true');
  pacer.insertBefore(spot, pacer.firstChild);

  let lastTop = null, frame = 0, forceJump = false;

  function place() {
    frame = 0;
    const cur = page.querySelectorAll('w.c');
    if (!cur.length || pacer.hidden) { spot.classList.remove('on'); lastTop = null; return; }
    const first = cur[0], last = cur[cur.length - 1];
    let x = first.offsetLeft, y = first.offsetTop, h = first.offsetHeight;
    let w = first.offsetWidth;
    if (last !== first && last.offsetTop === y) w = last.offsetLeft + last.offsetWidth - x;
    const fs = parseFloat(getComputedStyle(page).fontSize) || 20;
    const padX = fs * 0.55, padY = fs * 0.32;
    // New line (or new page): fade in place instead of sweeping across the screen.
    const jump = forceJump || lastTop === null || Math.abs(y - lastTop) > 2;
    forceJump = false;
    lastTop = y;
    if (jump) spot.classList.add('jump');
    spot.style.width = (w + padX * 2) + 'px';
    spot.style.height = (h + padY * 2) + 'px';
    spot.style.transform = `translate3d(${x - padX}px, ${y - padY}px, 0)`;
    spot.classList.add('on');
    if (jump) { void spot.offsetWidth; spot.classList.remove('jump'); }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };

  new MutationObserver(muts => {
    if (muts.some(m => m.type === 'childList')) forceJump = true;
    schedule();
  }).observe(page, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  new MutationObserver(() => { forceJump = true; schedule(); })
    .observe(pacer, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', () => { forceJump = true; schedule(); });
  document.fonts && document.fonts.ready.then(() => { forceJump = true; schedule(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
