// The traffic light of every trusted instance at one moment, from the
// store, the explorer tips and the clock (SPEC § 5.1 and § 3.3). The page
// draws what this returns and the sampler stores it, so a colour shown live
// and a colour kept in the history always come from the same rules.

import { crossCheck, peerHeights } from './crosscheck.js';
import { instanceLight } from './light.js';

const NO_CROSS_CHECK = { kind: 'none', networkMismatch: false };

/**
 * One result per instance of the trusted list, in its order: the `entry`,
 * what the store holds for it (`stored`, with the report and its relays),
 * the cross-check and the light. An instance without a report gets no
 * cross-check and a light that says so.
 */
export function snapshot({ trusted, config, store, tips, now }) {
  const pairs = trusted.instances.map((entry) => ({ entry, report: store.health.get(entry.pubkey)?.report }));
  return pairs.map(({ entry, report }) => {
    const check = report
      ? crossCheck({
        report,
        entry,
        explorers: config.explorers,
        tips,
        peers: peerHeights(entry.pubkey, entry.network, pairs, now),
        now,
        tipMaxAgeSeconds: config.explorerTipMaxAgeMinutes * 60,
      })
      : NO_CROSS_CHECK;
    const light = instanceLight({ entry, report, crossCheck: check, now, blockLagRed: config.blockLagRed });
    return { entry, stored: store.health.get(entry.pubkey) ?? null, report: report ?? null, check, light };
  });
}
