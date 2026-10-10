// Keeps UV Studio running when the tab is hidden or another window has focus:
// 1. Timers run in a Web Worker (browsers throttle setTimeout/setInterval in
//    background tabs to >=1s, or once per minute after a few minutes).
// 2. A Web Lock and a screen wake lock discourage tab freezing/discarding.
(function () {
  'use strict';

  if (typeof Worker !== 'undefined') {
    try {
      const worker = new Worker('js/timer-worker.js');
      const nativeSetTimeout = window.setTimeout.bind(window);
      const nativeClearTimeout = window.clearTimeout.bind(window);
      const nativeSetInterval = window.setInterval.bind(window);
      const nativeClearInterval = window.clearInterval.bind(window);
      const callbacks = new Map();
      let nextId = 1;
      let workerOk = true;

      worker.onmessage = ({ data: id }) => {
        const entry = callbacks.get(id);
        if (!entry) return;
        if (!entry.repeat) callbacks.delete(id);
        try { entry.fn(...entry.args); } catch (e) { console.error(e); }
      };
      worker.onerror = () => { workerOk = false; };

      const schedule = (repeat, fn, delay, args) => {
        if (typeof fn !== 'function' || !workerOk) {
          return (repeat ? nativeSetInterval : nativeSetTimeout)(fn, delay, ...args);
        }
        const id = 'w' + nextId++;
        callbacks.set(id, { fn, args, repeat });
        worker.postMessage({ cmd: 'start', id, delay: Math.max(0, Number(delay) || 0), repeat });
        return id;
      };
      const cancel = (id, native) => {
        if (typeof id === 'string' && callbacks.has(id)) {
          callbacks.delete(id);
          worker.postMessage({ cmd: 'stop', id });
        } else {
          native(id);
        }
      };

      window.setTimeout = (fn, delay, ...args) => schedule(false, fn, delay, args);
      window.setInterval = (fn, delay, ...args) => schedule(true, fn, delay, args);
      window.clearTimeout = id => cancel(id, nativeClearTimeout);
      window.clearInterval = id => cancel(id, nativeClearInterval);
    } catch (e) {
      console.warn('Background timer worker unavailable:', e);
    }
  }

  // Held for the lifetime of the page.
  if (navigator.locks && navigator.locks.request) {
    navigator.locks.request('uvstudio-active', () => new Promise(() => {})).catch(() => {});
  }

  let wakeLock = null;
  const acquireWakeLock = async () => {
    if (!navigator.wakeLock || wakeLock || document.visibilityState !== 'visible') return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { /* denied or unsupported */ }
  };
  acquireWakeLock();
  document.addEventListener('visibilitychange', acquireWakeLock);
})();
