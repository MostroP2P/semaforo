# Semáforo

The public status page of trusted Mostro instances, at
[status.mostro.network](https://status.mostro.network). One look shows the latest health
each trusted Mostro reports, cross-checked where possible (green, yellow or red), and how
reliable it has been over the last 90 days. Green means the instance reports itself
healthy and passes the independent checks; it is not a guarantee that a trade will
succeed.

It reads the signed Mostro health events (kind 38389) straight from Nostr relays and
verifies them in your browser. There is no backend and no tracking.

The design is in [docs/SPEC.md](docs/SPEC.md), and [docs/ROADMAP.md](docs/ROADMAP.md) tracks
what is built. Conventions for
contributors and coding agents, including the rule that everything in the repository is
written in English, are in [AGENTS.md](AGENTS.md).

## Development

The page has no build step and no dependencies to install. Serve the repository with
any static file server and open it:

```sh
python3 -m http.server 8080
# then open http://localhost:8080/
```

`?lang=es` or `?lang=en` picks the language. The local copy runs without the
Content-Security-Policy; `npm run build` writes the published version, policy included,
to `_site/`. The tests need Node 24:

```sh
npm test
npm run test:coverage
```

The smoke test loads the page in Chromium against a local relay, with no network:

```sh
npm ci
npx playwright-core install chromium
npm run test:smoke
```

## Avatars

The page shows each instance's avatar from a copy in `assets/avatars/`, never from the
instance's own URL. To refresh them, after `npm ci` and
`npx playwright-core install chromium`:

```sh
node scripts/avatars.mjs            # every trusted instance
node scripts/avatars.mjs <hex>...   # only these
```

It writes `assets/avatars/<hex pubkey>.webp` and sets `avatar: true` in `trusted.json`.
Look at the pictures before opening the pull request.

## History

The 90-day bars, the uptime and the incident list come from a sampler, `scripts/sample.mjs`, that
`.github/workflows/sample.yml` runs in a loop: one job at a time, each for
`sampler_run_minutes`, trying once a minute. Each attempt reads the health events
from the relays with the same reader as the page, cross-checks them against the
explorers and appends one sample per monitored instance to the `data` branch
(`data/samples/<hex pubkey>/<year>-<month>.ndjson`), but only once
`sample_interval_minutes` have passed since the last stored sample, and only if at least
one relay answered. After each run that stored samples, `scripts/rollup.mjs` recomputes
the daily records (`data/daily/<hex pubkey>.json`): the fraction of each day in each
colour, the day's colour and its incidents, by the rules of SPEC § 3.5 and § 5.3. The
workflow creates the `data` branch on its first run. The page reads those records
straight from the branch, at the `history_url` of `config.json`, so a new sample shows
on the bars without a deploy. To run one sample and the rollup by
hand into a directory of your choice:

```sh
npm ci
node scripts/sample.mjs /tmp/semaforo-data
node scripts/rollup.mjs /tmp/semaforo-data
```

## Deploy

`.github/workflows/deploy.yml` runs the tests, builds the site and publishes it to GitHub
Pages on every push to `main`. The site holds no history; the page fetches it from the
`data` branch. The build puts one version, a hash of what it publishes, on
every URL of the site's own files (`?v=…`), so a browser never pairs a new page with a
module or stylesheet cached from an older deploy. It needs, once:

- **Settings › Pages › Source:** "GitHub Actions".
- **Settings › Pages › Custom domain:** `status.mostro.network`, with HTTPS enforced.
- **DNS:** a `CNAME` record from `status.mostro.network` to `mostrop2p.github.io`.

## License

[GPL-3.0](LICENSE). The Mostro mascot in `assets/` comes from
[MostroP2P/community](https://github.com/MostroP2P/community) (MIT), and the Inter
typeface in `assets/fonts/` is under the SIL Open Font License (`assets/fonts/OFL.txt`).
