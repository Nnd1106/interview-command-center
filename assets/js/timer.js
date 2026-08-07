/* ---------------------------------------------------------------------
 * timer.js — visible per-question countdown. Purely cosmetic pressure:
 * it never force-submits or deletes what the candidate has typed, it
 * just turns amber then red and shows "Time's up" so they wrap up —
 * matching a real interview's social pressure without a data-loss bug.
 * ------------------------------------------------------------------- */

const TimerModule = (() => {
  function start(totalSeconds, { onTick, onExpire }) {
    let remaining = totalSeconds;
    let expired = false;
    onTick(remaining, totalSeconds);
    const handle = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0 && !expired) {
        expired = true;
        onTick(0, totalSeconds);
        if (onExpire) onExpire();
        return;
      }
      if (remaining > 0) onTick(remaining, totalSeconds);
    }, 1000);
    return { stop: () => clearInterval(handle) };
  }

  return { start };
})();
