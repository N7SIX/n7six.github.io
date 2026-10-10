// Dedicated workers are not throttled when the tab is in the background.
const timers = new Map();
self.onmessage = ({ data }) => {
  const { cmd, id, delay, repeat } = data;
  if (cmd === 'start') {
    const fire = () => {
      if (!repeat) timers.delete(id);
      self.postMessage(id);
    };
    timers.set(id, repeat ? setInterval(fire, delay) : setTimeout(fire, delay));
  } else if (cmd === 'stop') {
    const h = timers.get(id);
    if (h !== undefined) {
      clearTimeout(h);
      clearInterval(h);
      timers.delete(id);
    }
  }
};
