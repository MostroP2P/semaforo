# AGENTS.md

Instructions for coding agents (Claude Code, Codex, Cursor, Aider and similar) working
in this repository. Humans are welcome to read it too; nothing here is addressed only to
a machine.

Read [`docs/SPEC.md`](docs/SPEC.md) before changing anything. It is the source of truth
for what this site shows, why, and the exact rules it reads events with. `README.md` is
the shorter way in.

## Everything written here is in English

Source, identifiers, comments, documentation, test names and fixtures, commit messages,
branch names, pull request titles and bodies, issue titles and bodies, review comments,
and replies to review comments, including replies to automated reviewers. All of it,
always, in English.

Conversation with the maintainer may happen in Spanish. The artifacts do not: a comment
on a pull request is an artifact, and so is a reply to a reviewer. Mostro is worked on
across several languages, and a thread nobody outside one of them can follow is a
decision taken in private in a public place.

The one exception is the Spanish user-interface catalogue, which exists to be
translated. Its keys, and every comment around it, stay in English. The English
catalogue is the source; the Spanish one is a translation of it.

If you are prompted in another language, answer the person in that language, but write
English into the repository, the pull request and the issue tracker. If Spanish is
already there, fix it.

## What this project is

Semáforo is the public status page of trusted Mostro instances, served as a static site
at `status.mostro.network`. It reads the signed health events (kind 38389) that Mostro
instances publish, verifies them in the visitor's browser, and shows one traffic light
per instance plus a 90-day history of daily colours. There is no backend, no keys and
no tracking.

```text
browser ──► Nostr relays (wss)       live 38389 / 38385 events, verified client-side
        ──► block explorers (https)  tip height per network, the independent cross-check
        ──► GitHub Pages             index.html, config.json, trusted.json, data/daily/*.json

GitHub Actions (cron every 5 min) ──► relays ──► data branch ──► Pages   (the history sampler)
```

The sampling workflow is scheduled every 5 minutes, GitHub's minimum, and stores samples
only once `sample_interval_minutes` (10 by default) have passed since the last stored
sample. The spare runs absorb GitHub's late or skipped cron starts; do not schedule the
workflow at the sampling interval itself.

Properties everything else serves. None is negotiable in a patch:

- **Verifiable, not trusted.** Every live colour drawn from an event comes from one
  whose signature was checked in the browser that drew it. The history bars come from
  the sampler, which verifies every event with the same reader code before it stores a
  sample; that history is only as trustworthy as this repository, which is why the live
  colour never comes from it. When there is no valid event, the colour comes from that
  absence, as the next rule says, and never from an unverified event. The page is a
  reader of the protocol, never a source of truth.
- **No data is not good data.** An instance that stops reporting never stays green. A
  `monitored` instance with no valid fresh event is red, "Not reporting". Missing,
  expired or stale means unknown, never ok. A gap in sampling is grey, never filled in.
- **Never better than published.** A recomputed status may be worse than the published
  `status` (a block lag of `block_lag_red` or more is red whatever the event says), but
  never better.
- **Live is live; history is history.** The colour shown now always comes from the live
  events the browser read, never from the sampler. The sampler only feeds the bars, the
  uptime and the incident list.
- **Curated, not discovered.** Only instances in `trusted.json` are shown. Anyone can
  publish a validly signed health event; a page that showed every one it found could be
  filled with fake, always-green nodes.
- **Colour is never the only signal.** Every state has a word and an icon as well.

## Stack

Plain HTML, CSS and ES modules. No framework, no bundler, no build step. The only
third-party script is nostr-tools, loaded from a CDN pinned to an exact version with an
SRI hash. Vanilla keeps the attack surface small and the page easy to audit, so do not
introduce a framework or a build tool to save typing.

| Path | Purpose |
|---|---|
| `index.html`, `styles.css` | The page and its two themes |
| `app.js` | Wires the modules to the browser: loads the settings, opens the relays, polls the explorers, redraws |
| `src/reader.js` | The spec's reader rules as pure functions, shared by the page and the sampler |
| `src/config.js` | Validation of `config.json` and `trusted.json`, alone and against each other |
| `src/crosscheck.js` | The block-height reference (explorers, then the peer median) and the lag |
| `src/light.js` | The colour of one instance with its reasons and labels, and watcher liveness |
| `src/banner.js` | The banner and its counters |
| `src/store.js` | The newest valid event per trusted key, and the relays that returned it |
| `src/view.js` | Everything the page shows, as a pure function of the store, the tips and the clock |
| `src/dom.js` | Draws the view with `textContent`; the only module that touches the DOM |
| `src/relays.js`, `src/explorers.js` | The relay pool and the explorer client, with the network passed in |
| `src/i18n.js`, `src/i18n/` | The language picker and the English and Spanish catalogues |
| `src/format.js`, `src/bech32.js` | Durations, UTC times, percentages; npub and nevent encoding |
| `scripts/sample.mjs`, `scripts/rollup.mjs` | The history sampler and the daily rollup, run in GitHub Actions |
| `scripts/build-site.mjs`, `scripts/csp.mjs` | Build the published site and its Content-Security-Policy from the settings |
| `CNAME` | The custom domain, `status.mostro.network` |
| `test/` | `node --test` suites, one per module, and the event builders they share |
| `package.json` | The test scripts; the page itself has no dependencies to install |
| `config.json` | Every tunable value (relays, intervals, thresholds, explorers) |
| `trusted.json` | The curated list of instances and watchers |
| `assets/avatars/` | Vetted avatar copies; never load an avatar from a remote URL |
| `data/` (on the `data` branch) | Raw samples and daily rollups written by the sampler |
| `docs/SPEC.md` | The specification |
| `docs/ROADMAP.md` | The phases, one row per pull request |

`docs/ROADMAP.md` says what is built and what comes next; work is delivered one pull
request per row. When you add a file, follow the layout above; if the spec and this
table disagree, the spec wins and this file gets fixed.

## Commands

Tests run with Node's built-in runner (Node 24) and nothing else:

| Command | What it does |
|---|---|
| `npm test` | Every suite under `test/` |
| `npm run build` | The published site in `_site/`, with its Content-Security-Policy, exactly as `deploy.yml` builds it |
| `npm run test:coverage` | The same, failing under 80% of `src/`, or under 100% of the reader and the traffic-light modules |
| `node scripts/sample.mjs` | One sampler run against the configured relays (Phase 1) |
| `node scripts/rollup.mjs` | Recompute the daily rollups from the raw samples (Phase 1) |

CI runs `npm run test:coverage` on every pull request. The smoke test that loads the
page against a local relay with fixture events joins it with roadmap row 0.5. Run the
tests before opening or updating a pull request, and report the real result.

## How code is written here

- **Tests first.** Write the test, watch it fail, then implement. `src/reader.js` and
  the traffic-light modules (`crosscheck.js`, `light.js`, `banner.js`) are where a bug
  is silent, so CI holds them at 100%; everything else at 80% or more. `src/dom.js` and
  `app.js` touch the browser and have no unit tests; the smoke test covers them. Node
  reports coverage only for files a test loads, so a new module without a test is
  invisible to the threshold: write its test first. Tests are named for the behaviour they pin, not for
  the function they call, and are arranged Arrange, Act, Assert.
- **Pure where it can be.** Deciding *what* to render is a pure function of the events
  received, the explorer tips and the clock. The relay layer never touches the DOM; a
  renderer never decides what belongs on screen. The same reader code runs in the page
  and in the sampler, so it cannot depend on either.
- **Small files, organised by domain.** Under 400 lines. Extract rather than append.
- **Immutable data.** Return new values; do not mutate what you were handed.
- **Absence is explicit.** No silent catch, no `?? 0` standing in for a figure nobody
  published. `null` renders as absence, never as zero.
- **Tunables live in `config.json`.** No magic numbers for intervals, thresholds or
  retention; the page and the sampler read the same file.
- **Comments say why.** The what is in the code.

## Things that bite

- **Every event field is untrusted input.** Validate exactly as the spec says before
  use: signature, `kind`, `z`, `d` = `pubkey`, no tag repeated except `check` (once per
  check name, so an event with several checks is valid), integers within 2^53 − 1,
  `interval` within 30–3600, `expiration` exactly `created_at + 3 × interval`, nothing
  more than 300 seconds in the future. Never index into a tag without checking its
  length.
- **Highest `seq` wins across relays**, ties broken by the lowest event id. A relay that
  keeps serving an old event must never make a stopped instance or watcher look alive.
- **The cross-check reference is the highest fresh explorer tip**, so a lagging explorer
  can never hide a lagging node, and the browser and the sampler agree. A tip older than
  `explorer_tip_max_age_minutes` is not a reference. With no fresh explorer tip, the
  reference falls back to the median `lnd_block_height` of at least three other fresh,
  `monitored` instances on the same network. Only when neither exists, on a network that
  has explorers, is the cross-check unavailable: a Lightning instance that would
  otherwise be green is shown yellow, "Not independently verified", never green.
- **`monitored` decides grey versus red.** The browser cannot tell "never published"
  from "stopped publishing", so the trusted list does.
- **Samples cover time, not counts.** A sample stands for the span to the next one,
  capped at 1.5 × `sample_interval_minutes` from `config.json`, not the event's own
  `interval`; anything past the cap is no data. A run that reached no
  relay stores nothing, so an outage on our side is a grey gap, not a red day.
- **Render event text with `textContent`, never as HTML.** Names, versions and check
  names come from the network.
- **The Content-Security-Policy is generated at deploy** from `config.json` and
  `trusted.json`. A new relay, explorer or script source goes in those files, not in a
  hand-edited meta tag.
- **Two catalogues.** A new user-facing string needs an English and a Spanish entry.
  Both must be real text; the tests check that neither is blank.
- **Accessibility is a requirement, not a polish pass.** WCAG AA contrast for the three
  colours on both themes, a word and an icon next to every colour, and
  `prefers-reduced-motion` honoured.

## Git and GitHub

- Branch from `main`; never commit to it directly.
- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`,
  `perf:`, `ci:`. The subject says what changed; the body says why it needed to.
- One concern per pull request. A change to `trusted.json` and a feature belong in
  separate pull requests, even when they touch the same file.
- A pull request describes the change, the reasoning, and a test plan a reviewer can
  run. Mark what you could not verify; an unverified step said plainly is worth more
  than a checked box that was not. Never claim a check passed without running it.
- Answer review comments. Fix what is real, and say briefly why for what is not; a
  finding you disagree with still deserves a reply.
- Changes to `trusted.json` follow the inclusion criteria in the spec: the instance is
  listed in MostroP2P/community (or is the global Mostro) and its operator agrees to be
  shown. `monitored` is set to `true` only in a pull request that confirms the instance
  publishes the health event.
- In English. See the top of this file.

## Guidance for agents

- Read before you edit. Match the conventions of the surrounding code instead of
  importing habits from other projects.
- Stay within the scope you were asked for. Surface adjacent problems rather than fixing
  them unprompted.
- Say what you did not verify. A change that passes `node --test` has not been seen
  against real relays; changes to the relay layer or the sampler need a run against
  them, or against the local relay with fixtures.
- Never weaken a validation rule, the CSP or a signature check to make a test or a page
  go green.
