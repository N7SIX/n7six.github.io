// sleep-worker.js
// Handles timing delays in a Web Worker context.
// Web Workers are not subject to background tab timer throttling,
// so sleep() calls remain accurate even when the user switches tabs.

self.onmessage = function ({ data: { id, ms } }) {
  setTimeout(function () {
    self.postMessage({ id: id });
  }, ms);
};
