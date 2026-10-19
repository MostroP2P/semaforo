# Semáforo: specification

Semáforo is the public status page of trusted Mostro instances. At a glance it shows the
latest health each trusted Mostro reports, cross-checked where possible, using the three
colours of a traffic light, and how reliable each one has been over the last 90 days. A
green light means the instance reports itself healthy and passes the independent checks.
It is not a guarantee that a given trade will succeed.

- **What:** a static website on GitHub Pages, served at `status.mostro.network`, with no
  backend and no keys.
- **Data:** signed Nostr events that Mostro instances already publish (the health event,
  kind 38389), read and verified in the visitor's browser.
- **Look:** a standard status page that tells users at a glance what is happening: a
  banner with the overall state, then one row per instance with its current colour and
  a 90-day bar of daily colours.

Status: being implemented. [ROADMAP.md](ROADMAP.md) lists the pull requests, one per
step.

## 1. Why

On 2026-10-14 a Mostro node's Lightning backend stopped following the chain for about
21 hours. The daemon kept creating hold invoices and accepting payments, so everything
looked normal, but no buyer payout could succeed. Nobody noticed until a person looked
at the logs.

Two things were missing:

1. **Operators had no alert.** That is handled by mostro-watchdog's health module and
   by the health event itself (MostroP2P/protocol#84, MostroP2P/mostro#1063,
   MostroP2P/mostro-watchdog#46).
2. **Users had no way to see it.** A buyer about to take an order on that node had no
   signal that the node could not pay them. Semáforo is that signal.

Semáforo serves three audiences:

| Audience | Question it answers |
|---|---|
| Users | "Is the Mostro I want to trade on working right now? Has it been reliable?" |
| Operators | "How does my node look from the outside? Is my health event being seen?" |
| The community | "How healthy is the trusted Mostro network as a whole?" |

It is **not** an alerting tool. It never notifies anyone; mostro-watchdog does that.

## 2. Principles

- **Verifiable, not trusted.** Every state shown comes from an event signed by the
  instance and verified in the browser. The page is a reader of the protocol, not a
  source of truth.
- **No data is not good data.** An instance that stops reporting never stays green. This
  follows the reader rules of the health event spec: missing, expired or stale means
  unknown, never ok.
- **One glance first, details on demand.** The colour of the banner and of each row must
  answer the main question without reading any text. Everything else is one click away.
- **Colour is never the only signal.** Every state also has a word and an icon, for
  colour-blind visitors and for screenshots in black and white.
- **No backend, no tracking.** Static files, no cookies, no analytics, no third-party
  requests other than Nostr relays, the pinned script CDN and block explorers.
- **Curated, not discovered.** Only instances in the trusted list are shown (see § 4).

## 3. Data sources

### 3.1 Live state: the health event (kind 38389)

The authoritative definition is `src/health_event.md` in MostroP2P/protocol (PR #84).
Semáforo implements the reader side of that spec exactly:

- verify the NIP-01 signature, `kind` = 38389, `z` = `health`, `d` = `pubkey`;
- reject repeated tags (`check` once per name), malformed values, integers above
  2^53 − 1, an `interval` outside 30–3600, and an `expiration` that isn't exactly
  `created_at + 3 × interval`;
- ignore events more than 300 seconds in the future;
- across relays, keep the highest `seq`, breaking ties by the lowest event id;
- treat the instance as **unknown** when there is no valid event, it has passed its
  `expiration`, or its `created_at` is older than `3 × interval`;
- ignore check names it doesn't know, read unknown states as `unknown`, and never let a
  recomputed status be better than the published one;
- read a check the escrow mode should publish but the event leaves out (`lnd_sync` and
  `payouts` for Lightning, `cashu_mint` for Cashu) as `unknown`, so an instance can't
  look green by omitting the check that would fail.

Semáforo only reads the **public tags**. The encrypted `content` is for the operator's
watchdog, and the page has no key to read it.

Public tags used on the page:

| Tag | Used for |
|---|---|
| `status` | the traffic-light colour (§ 5) |
| `check` (`lnd_sync`, `payouts`, `cashu_mint`, `relays`, `database`) | the detail panel: which part is failing and since when |
| `escrow_mode` | label (Lightning / Cashu) and which checks to expect |
| `lnd_block_height`, `lnd_network`, `lnd_synced_to_chain` | the independent block-height cross-check (§ 3.3) |
| `maintenance_mode` | the "maintenance" label |
| `mostro_version` | the detail panel |
| `interval`, `created_at`, `expiration` | freshness and "last seen" |

### 3.2 Names and metadata: the info event (kind 38385) and the trusted list

The display name comes from the trusted list (§ 4) first, then from the `y` tag of the
instance's info event (`["y", "mostro", "<name>"]`), and falls back to a short npub.
An info event is read only with `z` = `info` and `d` = `pubkey`, each tag it uses at most
once, and not more than 300 seconds in the future.
The info event also provides the fee and the version for the detail panel.

### 3.3 Independent block-height reference

The health event spec says a node on a stale chain does not necessarily know it is
stale. Lightning instances are therefore cross-checked against block explorers for the
same `lnd_network` (mempool.space and blockstream.info for mainnet; their signet and
testnet endpoints where they exist). The explorers are listed per network in
`config.json`. When several return a fresh tip, the reference is the **highest** of
them, so a lagging explorer can never hide a lagging node, and the browser and the
sampler always pick the same value. No cross-check is done on networks without an
explorer, such as regtest. The reported `lnd_network` must match the `network` of the
instance in the trusted list. A mismatch never earns the no-explorer exemption: the
instance is shown yellow, "Red inesperada / Unexpected network", and is cross-checked
against its trusted network as usual.

- A tip fetched more than 30 minutes ago is not used.
- When no fresh explorer tip is available for a network that has explorers, the page
  falls back to the median `lnd_block_height` of at least three other fresh, `monitored`
  instances on the same network (rounded down between the two middle values when there
  is an even number of them). If neither reference exists, the cross-check is
  **unavailable**: a Lightning instance that would otherwise be green is shown yellow,
  labelled "Sin verificación independiente / Not independently verified", because a
  stale chain is exactly what it would miss. Networks with no explorer at all, such as
  regtest, keep their explicit exemption and are not affected.
- A lag of 3 blocks or more turns the instance red, whatever its own `status` says.
  That is exactly the failure of 2026-10-14.
- **A node is held only to the blocks the reader had seen when it signed.** An event
  carries the height of the moment it was signed, up to an `interval` earlier, so when
  blocks come in a burst every instance can be a few behind the explorer for a minute
  (on 2026-10-19 six turned red at once while reporting `ok`). Each tip therefore
  remembers the last few heights the explorer answered (eight), with when the reader
  first and last saw each, and an event is held to the last of them the reader had seen
  when it was signed, never to more than the tip itself. A height found on the reader's
  first look at an explorer counts as seen from the start, however old the event. Nothing
  is excused when the reader had not heard from the explorer for more than the 30
  minutes above right after that height, or when the event is older than every height it
  remembers, since nobody knows when those blocks appeared. A node that has really
  stopped publishes again within its `interval` without them and turns red then. The
  page keeps the tips for as long as it is open. The sampler looks at the explorers on
  every pass, sampling or not, and keeps the tips between the passes of one job in a
  temporary file, never on the `data` branch: each job begins with a first look, so no
  height a job saw can be forgotten by the next and excused.
- A Lightning event with no `lnd_block_height` (the node can't reach LND) can't be
  cross-checked either, so it is never green: at best yellow, "Not independently
  verified". A height with no `lnd_network` counts as a network mismatch, since it can't
  be placed on a chain.

### 3.4 Watcher heartbeats

Watchers (for example mostro-watchdog) publish a heartbeat with the same kind and
`z` = `watcher`. Semáforo shows a small "Monitoring" section with the watchers listed in
the trusted list and whether each one is alive. A dead watcher means alerts may not
reach operators, which is worth knowing even when every instance is green.

A heartbeat is read with the watcher rules of the health event spec:
- the signature, `d` = `pubkey` = a watcher key from the trusted list, and `z` = `watcher`;
- the watcher tag table, with each tag at most once;
- `interval` within 30–3600 and `expiration` exactly `created_at + 3 × interval`;
- the highest `seq` across relays.

A watcher is **alive** while its newest valid heartbeat is fresh: before its
`expiration`, `created_at` not older than `3 × interval`, and not more than 300 seconds
in the future. Otherwise it is **not reporting**. A relay that keeps serving an old
heartbeat therefore never makes a stopped watcher look alive.

### 3.5 History

Relays keep only the latest revision of an addressable event, so the 90-day bars need
their own record. Options:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Sampler in GitHub Actions** (recommended for v1) | A workflow in this repo samples every 10 minutes from a long-running job (§ 7 explains the schedule), reads the health events from the relays with the same reader code, and appends one sample per instance to compact JSON files on a `data` branch. After every run that stores samples, the same job recomputes today's rollup (and finalises yesterday's once it is complete), so today's bar and incidents follow each new sample. The page fetches the daily records straight from that branch (`history_url` in `config.json`), so no deploy stands between a sample and the bars. | No new protocol; free; transparent (every sample is a commit); the same pattern as [Upptime](https://github.com/upptime/upptime) | GitHub's cron is best-effort and can be late or skip runs; the history is only as trustworthy as this repo |
| B. Signed daily summaries on Nostr | Trusted watchers publish one signed summary event per instance per day | Nostr-native, verifiable, several independent watchers | Needs a new event kind in the protocol and changes in mostro-watchdog |
| C. History only while the page is open | The browser records what it sees | Trivial | Useless for a first-time visitor |

Recommendation: start with **A**, keep the sample format close to what **B** would
publish, and move to B once the health event is widely deployed. Gaps in sampling are
shown as grey ("no data"), never filled in.

**How samples map to time.** Each sample stands for the time from its own timestamp to
the next sample of the same instance, capped at `1.5 × sample_interval`. Time past that
cap (a skipped or late run) counts as **no data**. All durations in § 5.3 (the 15-minute
thresholds and the uptime) are sums of these covered spans, so the same samples always
give the same bars and percentages. With the default interval of 10 minutes, one sample
covers at most 15 minutes, so a single red sample is enough to reach the red threshold.

Sample record (one line per sample, newline-delimited JSON, one file per instance per
month, e.g. `data/samples/<hex pubkey>/2026-10.ndjson`):

```json
{"t":1792060200,"state":"red","status":"down","lag":0,"reasons":["lnd_sync","payouts"],"event":"<event id>","seq":1532}
```

A run stores samples only if at least one relay query completed (the relay answered
with EOSE) in that run. If the runner reaches no relay at all, the run stores nothing,
so a relay or Actions outage leaves a grey gap instead of recording every instance as
`not_reporting`.

`reasons` lists what made the sample anything but green, so a rollup can still name the
cause after the event itself is gone from the relays (they keep only the latest
revision). Possible values: the name of each check whose state is `warn`, `fail` or
`unknown`; `block_lag` when the cross-check reached `block_lag_red`;
`unverified` when the cross-check was unavailable (§ 3.3); `network_mismatch` when the
reported `lnd_network` differs from the trusted one (§ 3.3); `reported_status` when the
published `status` is `degraded` or `down` but no check the reader knows explains it
(for example a check added in a later protocol version); `maintenance`; and
`not_reporting` when there was no valid fresh event. It is empty for a green sample, and
daily rollups keep these codes in each incident's `reason`.

Daily rollup (`data/daily/<hex pubkey>.json`): one record per day, keeping the last
`daily_rollup_retention_days` days (400 by default). The page shows only the last
`history_days_shown` (90 by default) from that file, so both settings can change
independently. `until` is the Unix second the record was judged up to: the end of the
day, or the time of the run for a day still in progress, so a reader can tell a finished
day from one judged early and treat the time after `until` as no data.

```json
{"day":"2026-10-14","until":1792022400,"green":0.18,"yellow":0.0,"red":0.82,"none":0.0,"worst":"red","incidents":[{"from":1791952200,"to":1792030000,"state":"red","reason":"lnd_sync"}]}
```

## 4. The trusted list

Anyone can publish a validly signed health event, so a page that showed every instance
it discovers could be filled with fake, always-green nodes. Semáforo shows only
instances in `trusted.json`, which maintainers curate through pull requests:

```json
{
  "instances": [
    {
      "pubkey": "82fa8cb978b43c79b2156585bac2c011176a21d2aead6d9f7c575c005be88390",
      "name": "Mostro",
      "region": "Global",
      "network": "mainnet",
      "monitored": true,
      "website": "https://mostro.network"
    }
  ],
  "watchers": [
    { "pubkey": "<hex pubkey>", "name": "mostro-watchdog (Mostro team)" }
  ]
}
```

- **Order.** The page shows instances in the order of this list. The global Mostro is
  always first; after it come the community instances in the order they joined, as
  listed in [MostroP2P/community](https://github.com/MostroP2P/community)
  (`src/config/communities.ts`). A new instance is appended at the end.
- **Initial list.** In order: Mostro (global), then the community instances (Cuba,
  España, Colombia, Bolivia, Venezuela, Brasil, Argentina, Europa, Ecuador), each with
  the pubkey from the community list. Names can be read from each instance's
  kind 0 profile, as the community site does. **Avatars are never loaded from the
  profile's URL**, because that would make every visitor's browser contact a host chosen
  by the instance. An avatar, if any, is a vetted copy committed to this repository
  (`assets/avatars/<hex pubkey>.webp`) and served with the site. The protocol puts an
  instance's avatar in the `picture` of its kind 0 profile; the info event (kind 38385)
  carries none. `scripts/avatars.mjs`, run by a maintainer, reads that profile, checks its
  signature, downloads the picture (https only, at most 2 MB), re-encodes it in a headless
  browser to a 128 × 128 WebP and sets `avatar: true` on the instance; the pictures are
  reviewed in the pull request that adds them. The build fails if an instance claims an
  avatar whose file is missing, and the monogram shows when there is none.
  So that a copy follows the operator's picture, the script records the SHA-256 of each
  picture it downloaded in `avatar-sources/<hex pubkey>.sha256` (outside the published
  site) and copies a picture again only when its bytes changed: the source is compared,
  not the WebP, whose bytes may differ with the machine or the browser that encoded it.
  The workflow `avatars.yml` runs the script after every merge to `main` and weekly, and
  opens one pull request per changed avatar; it never pushes to `main`, so every picture
  is still reviewed before it is served, and each is accepted or declined on its own. A
  picture whose fingerprint a closed, unmerged pull request for the same instance
  already proposed is not proposed again.
- **`monitored`** says whether the instance is expected to publish the health event. It
  is set to `true` in the pull request that confirms the instance publishes it. A
  stateless browser can't tell "never published" from "stopped publishing" (relays drop
  expired events, per NIP-40), so this field is what decides between grey and red:
  - `monitored: false`: grey, "not monitored yet", excluded from the banner and from
    uptime;
  - `monitored: true` with no valid fresh event: red, "not reporting".
- **Relays** are not listed per instance by default. All instances are read from the
  relays in `config.json` (§ 7). An entry may add `relays` for an instance that
  publishes elsewhere.
- **Inclusion criteria**, documented in the README: the instance is listed in
  MostroP2P/community (or is the global Mostro), and its operator agrees to be shown.

## 5. The traffic light

### 5.1 State of one instance

| Colour | Word (es / en) | Icon | When |
|---|---|---|---|
| 🟢 Green | Operativo / Operational | ✓ | `status` = `ok`, the event is fresh, and the block-height cross-check shows a lag below 3 (or the network has no explorer, § 3.3) |
| 🟡 Yellow | Con problemas / Degraded | ! | `status` = `degraded`, or `maintenance_mode` = `true` (labelled "Mantenimiento / Maintenance"), or the cross-check is unavailable (labelled "Sin verificación independiente / Not independently verified", § 3.3) |
| 🔴 Red | Caído / Down | ✕ | `status` = `down`, **or** a block lag of 3 or more, **or** the instance is `monitored` but has no valid fresh event (labelled "Sin señal / Not reporting") |
| ⚪ Grey | Sin monitoreo / Not monitored | ? | `monitored: false` in the trusted list; excluded from the banner and from uptime |

Why "not reporting" is red and not grey: for a user about to trade, a node that cannot
prove it is working is not safe to trade on. The label tells it apart from a node that
reports `down`. The decision is driven by the `monitored` field (§ 4), not by what the
browser happens to have seen.

### 5.2 The banner

The banner sits at the top, full width, coloured by the worst state among monitored
instances:

The rules apply in this order; the first that matches wins:

| Condition | Colour | Text (es / en) |
|---|---|---|
| no relay has answered yet (the page is loading) | grey | "Comprobando…" / "Checking…" |
| the page can't reach any relay | grey | "No se puede verificar el estado" / "Unable to verify status" |
| no instance is `monitored` | grey | "Todavía no hay Mostros monitoreados" / "No Mostro is monitored yet" |
| at least one red | red | "N Mostros caídos" / "N Mostros down" |
| at least one yellow | yellow | "Algunos Mostros con problemas" / "Some Mostros degraded" |
| every monitored instance green | green | "Todos los Mostros operativos" / "All Mostros operational" |

The green rule needs at least one monitored instance; an empty set is never green.

Next to the text, a small three-lamp traffic light lights the matching lamp, which is
also the page's logo. Below the banner, three counters: N green · N yellow · N red.

### 5.3 Daily bars and uptime

Each instance row has 90 thin vertical bars, oldest on the left and today on the right,
the usual layout of status pages. A day's colour is:

1. **grey** ("no data") if the covered time (§ 3.5) is less than `min_day_coverage`
   (half) of the day. For today, still in progress, the threshold applies to the part of
   the day elapsed so far, not to the full 24 hours. This check comes first, so a nearly
   unsampled day is never red or green;
2. otherwise **red** if the instance was red for 15 minutes or more that day;
3. otherwise **yellow** if it was yellow for 15 minutes or more;
4. otherwise **green**.

Hovering or tapping a bar shows the day, the time in each state and the incidents with
their reasons (for example "LND not synced, 21 h 12 min").

Uptime % = time not red ÷ time with data, over the 90 days, shown under the bars (for
example "99.54 % uptime"). Grey time is excluded, not counted as up.

## 6. Layout

A standard status page layout: calm, plenty of whitespace, one column, with the state
before anything else, so a user can see what is happening without reading any detail.

```text
┌──────────────────────────────────────────────────────────────┐
│  🚦 Semáforo · Mostro status                     [es|en] [☾]  │
├──────────────────────────────────────────────────────────────┤
│ ████████████████ Todos los Mostros operativos ██████████████ │  ← banner
│        ● 5 operativos   ● 1 con problemas   ● 0 caídos        │
├──────────────────────────────────────────────────────────────┤
│                    Disponibilidad en los últimos 90 días      │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Mostro (mostro.network)  ⚡ Lightning        ✓ Operativo  │ │
│ │ ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌ │ │
│ │ hace 90 días ─────────── 99.54 % ─────────────── hoy      │ │
│ │ ▸ detalles                                               │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Ralph                    ⚡ Lightning      ! Con problemas │ │
│ │ ...                                                      │ │
│ └──────────────────────────────────────────────────────────┘ │
│  Monitoreo: 2 watchers activos ✓                              │
│  Cómo funciona · Verificalo vos mismo · GitHub · Spec         │
└──────────────────────────────────────────────────────────────┘
```

- **Row order:** the order of the trusted list (§ 4): the global Mostro first, then
  community instances in the order they joined. The order doesn't change with state,
  so each instance keeps its place; the banner and the counters point at problems.
- **Details panel** (expands in place), per instance:
  - each check with its state and "since" (e.g. "LND sync: fail since 04:20 UTC");
  - last seen (relative and absolute time) and how many relays returned the event;
  - its block height versus the explorer tip, and the lag;
  - escrow mode, Mostro version and fee;
  - a link to the instance's health event on a Nostr explorer ("verify it yourself"),
    by its address (`naddr`: kind 38389, the instance's key, `d` = that key), so it
    opens the latest version. A link to one event id would stop resolving within an
    `interval`, once the next event replaces it on the relays.
- **Incident history:** a simple list under the instances of the latest red and yellow
  periods across all instances, derived from the daily rollups. There are no
  hand-written incident posts in v1.
- **Responsive:** on a phone the 90 bars become 30 (last 30 days) so each stays
  tappable. The banner and the colours don't change.
- **Light and dark themes**, following the system, with a toggle. The three traffic
  colours meet WCAG AA contrast against both backgrounds; the text labels carry the
  meaning.
- **Look:** the one of [mostro.network](https://mostro.network) and
  [mostro.community](https://mostro.community): a night-blue field, the Mostro green,
  glass cards and the Inter typeface, served from this site. The banner is a hero with a
  large traffic light whose lamp glows, and the drifting network mesh in the background
  and the glow behind the light take the colour of the banner, so the whole page turns red
  when Mostros are down. Under `prefers-reduced-motion` nothing moves. Below the
  instances, a short "How it works" section explains the verification in three steps.
- **Language:** Spanish and English, following the browser, with a toggle. The URL
  keeps the choice (`?lang=en`).

## 7. Architecture

```text
            ┌──────────── GitHub Pages (static) ────────────┐
 browser ──►│ index.html · app.js · styles/ · trusted.json   │
   │        └───────────────────────────────────────────────┘
   ├──► data branch (https)       data/daily/*.json, written by the sampler
   ├──► Nostr relays (wss)        live 38389 / 38385 events
   └──► block explorers (https)   tip height per network

 GitHub Actions (one job at a time, samples every 10 min) ──► relays ──► data branch
```

- **Front end:** plain HTML, CSS and ES modules, no framework and no build step.
  nostr-tools is loaded from a CDN pinned to an exact version with an SRI hash.
  Vanilla keeps the attack surface small and the page easy to audit.
- **Reader module:** `src/reader.js` holds the spec's reader rules as pure functions,
  shared by the page and by the sampler (Node). It is ported from the status page in
  MostroP2P/mostro-watchdog#48 and its tests.
- **Sampler:** `scripts/sample.mjs` and `scripts/rollup.mjs`, run by
  `.github/workflows/sample.yml` (scheduled). It pushes the `data` branch and nothing
  else: the page reads the daily records from that branch, so the sampler and the
  deploy (`deploy.yml`, on push to `main`) never wait on each other.
- **Configuration:** `config.json` holds every tunable value, so it can be changed with a
  pull request and no code change. The page and the sampler read the same file.

  ```json
  {
    "relays": [
      "wss://relay.mostro.network",
      "wss://mostro-p2p.tech",
      "wss://relay.shadowbip.com"
    ],
    "explorers": {
      "mainnet": [
        "https://mempool.space/api/blocks/tip/height",
        "https://blockstream.info/api/blocks/tip/height"
      ],
      "signet": ["https://mempool.space/signet/api/blocks/tip/height"]
    },
    "sample_interval_minutes": 10,
    "raw_sample_retention_days": 90,
    "daily_rollup_retention_days": 400,
    "history_days_shown": 90,
    "day_state_threshold_minutes": 15,
    "min_day_coverage": 0.5,
    "block_lag_red": 3,
    "explorer_tip_max_age_minutes": 30,
    "explorer_refresh_seconds": 60,
    "history_url": "https://raw.githubusercontent.com/MostroP2P/semaforo/data/data/daily/",
    "sampler_run_minutes": 350
  }
  ```

  `explorers` lists, per network, URLs that answer with the tip height as plain text
  (abridged above; the committed file also lists testnet and testnet4). A network with
  no entry has no explorer, which is what exempts regtest from the cross-check.
  `explorer_refresh_seconds` is how often the page asks them again. `history_url` is
  where the page reads the daily records (`<history_url><hex pubkey>.json`): the `data`
  branch of this repository, served raw by GitHub, so the history stays as trustworthy
  as the repository and no more. Pubkeys in both files are lowercase hex. `src/config.js` validates both files, and CI runs it on the
  committed ones.

  The relays are the global Mostro's. GitHub's cron is best effort: it starts late,
  skips runs, and on a quiet repository can fire only a few times a day, so the sampling
  workflow does not take its cadence from it. Each job samples in a loop for
  `sampler_run_minutes` (350 by default and at most; GitHub ends a job at 360, counted
  from before the checkout, and the last pass may still be pushing), trying once a
  minute: an attempt reads `config.json` and the time of the last stored sample, and
  stores nothing until the whole `sample_interval_minutes` have passed, so a sample lands
  up to a minute after the interval, never before it. Each stored sample is rolled up and
  pushed at once. The cron fires hourly,
  off the hour, only to queue the next job; one job runs at a time, and the queued one
  starts when the active one ends, so the loop carries on across jobs. Changing the
  interval is therefore a `config.json` change only, as long as it is a multiple of 5
  minutes.
- **Domain:** `status.mostro.network`, through a `CNAME` file in the published site and a
  DNS CNAME record pointing to `mostrop2p.github.io`.
- **Live versus history:** the colour shown now always comes from the live events read
  by the browser, never from the sampler. History only feeds the bars and the uptime.
- **Security:**
  - a strict Content-Security-Policy (scripts only from self and the pinned CDN; `img-src`
    and `font-src` only from self;
    `connect-src` limited to `'self'` (for `config.json` and `trusted.json`), the
    configured relays, any per-instance relays from the trusted list, the explorers and
    `history_url`, whose trailing `/` the policy reads as a path prefix). The deploy workflow generates the policy from
    `config.json` and `trusted.json` and writes it into the published `index.html` as a
    `<meta http-equiv="Content-Security-Policy">` tag, so a relay change in the
    configuration updates the policy in the same deploy;
  - all event text rendered with `textContent`, never HTML;
  - every value validated as the spec says before use.
- **Tests:**
  - `node --test` for the reader rules, the traffic-light mapping, the daily
    aggregation and the banner, run in CI on every pull request;
  - a smoke test that loads the page against a local relay with fixture events.
- **Language of the repository:** everything written into this repository and its
  GitHub project is in English: source, identifiers, comments, documentation, test
  names, commit messages, branch names, pull request and issue titles and bodies, and
  review comments and their replies. Mostro is worked on across several languages, and
  a thread only one of them can follow is a decision taken in private in a public place.
  The one exception is the Spanish user-interface catalogue, which exists to be
  translated; its keys and the comments around it stay in English. `AGENTS.md` holds
  this rule and the other conventions for contributors and coding agents.

## 8. Phases

| Phase | Scope | Depends on |
|---|---|---|
| **0 · Live** | Banner, instance rows with live colour and details, watchers, trusted list, es/en, themes. No bars yet (an "uptime history coming soon" placeholder). | mostrod publishing 38389 (MostroP2P/mostro#1066) on at least one trusted instance |
| **1 · History** | Sampler, daily rollups, 90-day bars, uptime %, incident list | Phase 0 |
| **2 · Nostr-native history** | Signed daily summaries from trusted watchers (option B), the sampler kept as a fallback | A protocol addition, mostro-watchdog support |

Until mostrod releases the health event, Phase 0 can run against a regtest instance and
fixture events.

## 9. Non-goals

- Alerting or notifications (mostro-watchdog).
- Showing every instance on the network. A "discovered instances" tab can come later,
  clearly separated from the trusted list.
- Showing the encrypted health details (liquidity, failure counts): those stay private
  between an operator and their watchdog.
- Hand-written incident reports. Maybe later, as Markdown files in the repo.

## 10. Decisions

1. **"Not reporting" is red** (§ 5.1), decided by the `monitored` field of the trusted
   list.
2. **Trusted instances:** the global Mostro first, then the MostroP2P/community
   instances in the order they joined (§ 4).
3. **Domain:** `status.mostro.network`.
4. **Sampling and retention:** a sample every 10 minutes, raw samples kept 90 days
   (about 13,000 lines per instance), daily rollups kept 400 days. All values live in
   `config.json` and can change without code changes (§ 7).
5. **Relays:** the global Mostro's relays, `wss://relay.mostro.network`,
   `wss://mostro-p2p.tech` and `wss://relay.shadowbip.com`, in `config.json`, with an
   optional per-instance override in the trusted list.
6. **Everything in the repository is in English** (§ 7), including pull requests, issues
   and review threads. The user interface is bilingual (es/en); the repository is not.
