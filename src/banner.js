// The banner at the top of the page (SPEC § 5.2): one colour for the worst
// state among monitored instances, and the counters below it. Grey instances
// are not monitored and count for nothing, so an empty set is never green.

/**
 * The banner for `lights` (the result of `instanceLight` per instance) given
 * the state of the relays: `connecting` until one has answered, then
 * `reachable` or `unreachable`. The rules apply in order; the first that
 * matches wins. `count` is the number the message names, if any.
 */
export function banner({ relays, lights }) {
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const { state } of lights) {
    if (state in counts) counts[state] += 1;
  }
  const grey = (message) => ({ state: 'grey', message, count: 0, counts });
  // Before the first answer nothing is known yet: not reporting would be a
  // false alarm, and no data is not good data either.
  if (relays === 'connecting') return grey('checking');
  if (relays === 'unreachable') return grey('unreachable');
  if (counts.green + counts.yellow + counts.red === 0) return grey('none_monitored');
  if (counts.red > 0) return { state: 'red', message: 'down', count: counts.red, counts };
  if (counts.yellow > 0) return { state: 'yellow', message: 'degraded', count: counts.yellow, counts };
  return { state: 'green', message: 'operational', count: counts.green, counts };
}
