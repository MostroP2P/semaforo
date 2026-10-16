# Roadmap

How [SPEC.md](SPEC.md) gets built: its phases, and one row per pull request. Work is
delivered one pull request per row, in order. A row is done when its pull request is
merged.

## Phase 0 · Live

The live traffic light: banner, instance rows with details, watchers, trusted list,
es/en, themes. No history bars yet.

| # | Pull request | Contents |
|---|---|---|
| 0.1 | Reader rules, configuration and CI | `src/reader.js` (health and info events), `src/config.js` (validation of `config.json` and `trusted.json`), both files with the initial trusted list, `node --test` with coverage thresholds in CI |
| 0.2 | Traffic light, cross-check and banner | The state of one instance (§ 5.1) with its reasons, the block-height reference and lag (§ 3.3), watcher liveness (§ 3.4) and the banner (§ 5.2), as pure functions |
| 0.3 | The live page | `index.html`, `styles.css`, `app.js`; the relay and explorer layers; the es/en catalogues; rows, details, watchers, themes and language toggle |
| 0.4 | Deploy | `deploy.yml` to GitHub Pages, the Content-Security-Policy generated from `config.json` and `trusted.json`, `CNAME` |
| 0.5 | Smoke test | The page loaded in a headless browser against a local relay serving fixture events, in CI |

## Phase 1 · History

| # | Pull request | Contents |
|---|---|---|
| 1.1 | Sampler | `scripts/sample.mjs` and `sample.yml`: one sample per instance on the `data` branch, gated on `sample_interval_minutes` |
| 1.2 | Daily rollups | `scripts/rollup.mjs`: daily colours, coverage and incidents (§ 3.5, § 5.3) |
| 1.3 | Bars, uptime and incidents | The 90-day bars (30 on a phone), the uptime and the incident list on the page |
| 1.4 | History from the data branch | The page reads the daily records from the `data` branch (`history_url`); the sampler no longer dispatches a deploy |

## Phase 2 · Nostr-native history

Signed daily summaries from trusted watchers (§ 3.5, option B). Not planned in detail
until the protocol has the event kind.
