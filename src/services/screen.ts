/**
 * Safari on iOS 26 sometimes runs the page under the status bar and the floating toolbar, and
 * sometimes keeps it between them, and it reports the same safe areas either way. This looks at
 * which one is happening and tells the styles, so the menu and the captions never land under the
 * clock or the toolbar, and never leave a gap for bars that are not there.
 */
export function watchScreen() {
  const html = document.documentElement;
  const ua = navigator.userAgent;
  const version = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
  const glass = /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua) && version >= 26 && !standalone;

  const fit = () => {
    const vv = window.visualViewport;
    // a page that has drifted while nobody is zooming is put back in place
    if (vv && Math.abs(vv.scale - 1) < 0.01 && (window.scrollX || window.scrollY)) window.scrollTo(0, 0);
    if (!glass) return;
    const tall = innerHeight >= innerWidth;
    const full = tall ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const under = innerHeight > full - 40;
    html.classList.toggle('glass', under);
    html.classList.toggle('framed', !under);
  };
  fit();
  addEventListener('resize', fit);
  addEventListener('orientationchange', () => setTimeout(fit, 300));
  window.visualViewport?.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('scroll', fit);

  if (location.hash === '#viewport') showNumbers();
}

/** Open the site with #viewport to see what the phone reports. */
function showNumbers() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;z-index:99;left:50%;top:50%;transform:translate(-50%,-50%);margin:0;padding:14px 16px;background:#111;color:#fff;font:12px/1.5 ui-monospace,monospace;white-space:pre';
  document.body.append(probe, box);
  const tick = () => {
    const s = getComputedStyle(probe);
    const vv = window.visualViewport;
    const css = getComputedStyle(document.documentElement);
    box.textContent = [
      `inner ${innerWidth} x ${innerHeight}`,
      `screen ${screen.width} x ${screen.height}`,
      `visual ${vv ? `${Math.round(vv.width)} x ${Math.round(vv.height)} at ${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)} zoom ${vv.scale.toFixed(3)}` : '-'}`,
      `safe ${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
      `scroll ${scrollX},${scrollY}`,
      `class ${document.documentElement.className || '-'}`,
      `above ${css.getPropertyValue('--above').trim()}`,
      `below ${css.getPropertyValue('--below').trim()}`,
      navigator.userAgent.replace(/^.*?\(/, '(').slice(0, 60),
    ].join('\n');
  };
  tick();
  setInterval(tick, 500);
}
