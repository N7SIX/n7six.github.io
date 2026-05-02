// sleep-worker.js
// Handles timer-based sleep requests in a Web Worker context
// to avoid browser throttling of setTimeout in background tabs.

'use strict';

self.onmessage = function (e) {
  const { id, ms } = e.data;
  setTimeout(() => self.postMessage({ id }), ms);
};
