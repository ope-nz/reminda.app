/*!
 * caco3-alerts — toast notifications for CaCO3
 * Usage: caco3Alerts.show(message, options?)
 *        caco3Alerts.show(title, message, options?)
 *
 * Local adaptation: icon classes use "ph" instead of the upstream "ph-thin",
 * because this app bundles only the regular-weight Phosphor font.
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    kind:      'info',
    duration:  4000,   // ms — 0 = no auto-dismiss
    icon:      true,
    placement: 'bottom-end',  // top-start | top-center | top-end | bottom-start | bottom-center | bottom-end
  };

  const ICONS = {
    info:    'ph ph-info',
    success: 'ph ph-check-circle',
    warning: 'ph ph-warning',
    danger:  'ph ph-x-circle',
  };

  const trays = {};

  function getTray(placement) {
    if (!trays[placement]) {
      const t = document.createElement('div');
      t.className = 'caco3-alert-tray';
      t.setAttribute('data-placement', placement);
      t.setAttribute('aria-live', 'polite');
      t.setAttribute('aria-label', 'Notifications');
      document.body.appendChild(t);
      // Promote the tray into the top layer so alerts render above
      // modal dialogs (e.g. caco3Dialog.wait). 'manual' popovers don't
      // light-dismiss on Esc or outside-click.
      if (t.showPopover) {
        t.popover = 'manual';
        t.showPopover();
      }
      trays[placement] = t;
    }
    return trays[placement];
  }

  // Re-promote the tray so it stacks above any dialog opened after it —
  // top-layer elements paint in promotion order, latest on top.
  function bringToFront(tray) {
    if (!tray.showPopover) return;
    try { tray.hidePopover(); } catch (e) { /* not open — ignore */ }
    try { tray.showPopover(); } catch (e) { /* disconnected — ignore */ }
  }

  function dismiss(el) {
    el.classList.remove('caco3-alert--visible');
    el.classList.add('caco3-alert--hiding');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }

  function show(titleOrMessage, messageOrOptions, opts) {
    let title, message, config;

    if (typeof messageOrOptions === 'string') {
      title   = titleOrMessage;
      message = messageOrOptions;
      config  = Object.assign({}, DEFAULTS, opts);
    } else {
      title   = null;
      message = titleOrMessage;
      config  = Object.assign({}, DEFAULTS, messageOrOptions);
    }

    const el = document.createElement('div');
    el.className = 'caco3-alert';
    el.setAttribute('role', 'alert');
    el.setAttribute('data-kind', config.kind);

    let html = '';

    if (config.icon) {
      const iconClass = ICONS[config.kind] || ICONS.info;
      html += `<i class="${iconClass} caco3-alert__icon" aria-hidden="true"></i>`;
    }

    html += `<div class="caco3-alert__body">`;
    if (title) {
      html += `<p class="caco3-alert__title">${title}</p>`;
      html += `<p class="caco3-alert__message">${message}</p>`;
    } else {
      html += `<p class="caco3-alert__title">${message}</p>`;
    }
    html += `</div>`;
    html += `<button class="caco3-alert__close" aria-label="Dismiss"><i class="ph ph-x" aria-hidden="true"></i></button>`;

    el.innerHTML = html;
    el.querySelector('.caco3-alert__close').addEventListener('click', () => dismiss(el));

    const tray = getTray(config.placement);
    tray.appendChild(el);
    bringToFront(tray);

    // Double rAF ensures the element is painted before the transition fires
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.classList.add('caco3-alert--visible');
    }));

    let timer = null;

    function scheduleTimer() {
      if (config.duration > 0) {
        timer = setTimeout(() => dismiss(el), config.duration);
      }
    }

    scheduleTimer();

    // Pause auto-dismiss while hovered
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', scheduleTimer);

    return el;
  }

  const caco3Alerts = { show, dismiss };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = caco3Alerts;
  } else {
    global.caco3Alerts = caco3Alerts;
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
