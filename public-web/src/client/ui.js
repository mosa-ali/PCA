/*
 * PCA Public — the entire client-side runtime.
 *
 * Scope is deliberately one control: the mobile navigation disclosure. The FAQ
 * uses native <details>/<summary>, so it needs no script and its answers stay
 * in the served HTML where crawlers and assistive technology can reach them.
 *
 * There is no framework, no router, no analytics, no network call and no
 * storage access anywhere in this file. That is what makes CLM-055 ("no
 * advertising trackers or third-party analytics, and no cookies beyond a
 * language preference") checkable rather than merely asserted -- and it is why
 * the page CSP can be connect-src 'none'.
 *
 * Language choice is expressed in the URL (/ vs /ar/), so nothing needs to be
 * persisted client-side at all. No cookie is set by this site.
 */
(function () {
  'use strict';

  var toggle = document.getElementById('pw-menu-toggle');
  var menu = document.getElementById('pw-mobile-menu');
  if (!toggle || !menu) return;

  function setOpen(open) {
    menu.setAttribute('data-open', open ? 'true' : 'false');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  toggle.addEventListener('click', function () {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  // Escape closes and returns focus to the control that opened it
  // (Design Guideline section 8).
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    setOpen(false);
    toggle.focus();
  });

  // If the viewport grows past the breakpoint while the panel is open, reset
  // the control's state so aria-expanded never disagrees with what is visible.
  var desktop = window.matchMedia('(min-width: 62rem)');
  var onChange = function (event) {
    if (event.matches) setOpen(false);
  };
  if (typeof desktop.addEventListener === 'function') {
    desktop.addEventListener('change', onChange);
  } else if (typeof desktop.addListener === 'function') {
    desktop.addListener(onChange);
  }
})();
