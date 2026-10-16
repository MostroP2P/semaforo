// The Content-Security-Policy of the published page (SPEC § 7), generated
// from the same files the page reads: scripts only from the page itself and
// the pinned CDN file, and connections only to the page's own files, the
// configured relays and the explorers. A relay change in config.json
// therefore updates the policy in the same deploy.

/** The comment in index.html that the policy replaces. */
export const CSP_MARKER = '<!-- CONTENT-SECURITY-POLICY: the deploy workflow writes the policy here. -->';

/** The https sources of the page's script tags, in order. */
export function externalScripts(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc="(https:[^"]+)"/g)].map((match) => match[1]);
}

function unique(values) {
  return [...new Set(values)];
}

/**
 * The policy for `config` and `trusted` (both already validated) and the
 * page's external `scripts`. Throws on a relay that is not wss, such as the
 * local test relay, a history URL that is not https, such as the local test
 * site, or a script that is not an exact https URL: none may reach the
 * published page.
 */
export function buildCsp({ config, trusted, scripts }) {
  for (const script of scripts) {
    const url = new URL(script);
    if (url.protocol !== 'https:' || url.search || url.hash) throw new Error(`${script} is not an https script with a fixed path`);
  }
  const relays = unique([...config.relays, ...trusted.instances.flatMap((entry) => entry.relays)]);
  for (const relay of relays) {
    if (!relay.startsWith('wss://')) throw new Error(`${relay} is not a wss relay`);
  }
  const explorers = unique([...config.explorers.values()].flat());
  if (!config.historyUrl.startsWith('https://')) throw new Error(`${config.historyUrl} is not an https history URL`);
  return [
    "default-src 'none'",
    ["script-src 'self'", ...scripts].join(' '),
    "style-src 'self'",
    "img-src 'self'",
    // The page's own copy of Inter; no font is fetched from anywhere else.
    "font-src 'self'",
    // The history URL ends in `/`, which the policy reads as a path prefix.
    ["connect-src 'self'", ...relays, ...explorers, config.historyUrl].join(' '),
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** `html` with the marker replaced by the policy as a meta tag. */
export function injectCsp(html, policy) {
  if (policy.includes('"')) throw new Error('a policy with a double quote would break the attribute');
  const count = html.split(CSP_MARKER).length - 1;
  if (count !== 1) throw new Error(`index.html must hold exactly one policy marker, found ${count}`);
  return html.replace(CSP_MARKER, `<meta http-equiv="Content-Security-Policy" content="${policy}">`);
}
