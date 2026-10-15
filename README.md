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

## Deploy

`.github/workflows/deploy.yml` runs the tests, builds the site and publishes it to GitHub
Pages on every push to `main`. The build puts one version, a hash of what it publishes, on
every URL of the site's own files (`?v=…`), so a browser never pairs a new page with a
module or stylesheet cached from an older deploy. It needs, once:

- **Settings › Pages › Source:** "GitHub Actions".
- **Settings › Pages › Custom domain:** `status.mostro.network`, with HTTPS enforced.
- **DNS:** a `CNAME` record from `status.mostro.network` to `mostrop2p.github.io`.

## License

[GPL-3.0](LICENSE). The Mostro mascot in `assets/` comes from
[MostroP2P/community](https://github.com/MostroP2P/community) (MIT), and the Inter
typeface in `assets/fonts/` is under the SIL Open Font License (`assets/fonts/OFL.txt`).
