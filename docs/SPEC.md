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
- **Look:** a one-glance overview like [status.claude.com](https://status.claude.com):
  a banner with the overall state, then one row per instance with its current colour and
  a 90-day bar of daily colours.

Status: draft for review. Nothing is implemented yet.

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
  recomputed status be better than the published one.

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
The info event also provides the fee and the version for the detail panel.

### 3.3 Independent block-height reference

The health event spec says a node on a stale chain does not necessarily know it is
stale. Lightning instances are therefore cross-checked against block explorers for the
same `lnd_network` (mempool.space and blockstream.info for mainnet; their signet and
testnet endpoints where they exist). No cross-check is done on networks without an
explorer, such as regtest.

- A tip fetched more than 30 minutes ago is not used.
- A lag of 3 blocks or more turns the instance red, whatever its own `status` says.
  That is exactly the failure of 2026-10-14.

### 3.4 Watcher heartbeats

Watchers (for example mostro-watchdog) publish a heartbeat with the same kind and
`z` = `watcher`. Semáforo shows a small "Monitoring" section with the watchers listed in
the trusted list and whether each one is alive. A dead watcher means alerts may not
reach operators, which is worth knowing even when every instance is green.

### 3.5 History

Relays keep only the latest revision of an addressable event, so the 90-day bars need
their own record. Options:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Sampler in GitHub Actions** (recommended for v1) | A scheduled workflow in this repo runs every 10 minutes, reads the health events from the relays with the same reader code, and appends one sample per instance to compact JSON files on a `data` branch. A daily job rolls samples up into one record per instance per day. The page fetches those static files. | No new protocol; free; transparent (every sample is a commit); the same pattern as [Upptime](https://github.com/upptime/upptime) | GitHub's cron is best-effort and can be late or skip runs; the history is only as trustworthy as this repo |
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
{"t":1792060200,"state":"green","status":"ok","lag":0,"event":"<event id>","seq":1532}
```

Daily rollup (`data/daily/<hex pubkey>.json`, last 90 days):

```json
{"day":"2026-10-14","green":0.18,"yellow":0.0,"red":0.82,"none":0.0,"worst":"red","incidents":[{"from":1791952200,"to":1792030000,"state":"red","reason":"lnd_sync"}]}
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
    { "pubkey": "npub1…", "name": "mostro-watchdog (Mostro team)" }
  ]
}
```

- **Order.** The page shows instances in the order of this list. The global Mostro is
  always first; after it come the community instances in the order they joined, as
  listed in [MostroP2P/community](https://github.com/MostroP2P/community)
  (`src/config/communities.ts`). A new instance is appended at the end.
- **Initial list.** In order: Mostro (global), then the community instances (Cuba,
  España, Colombia, Bolivia, Venezuela, Brasil, Argentina, Europa, Ecuador), each with
  the pubkey from the community list. Names and avatars can be read from each instance's
  kind 0 profile, as the community site does.
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
| 🟢 Green | Operativo / Operational | ✓ | `status` = `ok`, the event is fresh, and the block-height cross-check (if any) shows a lag below 3 |
| 🟡 Yellow | Con problemas / Degraded | ! | `status` = `degraded`, or `maintenance_mode` = `true` (labelled "Mantenimiento / Maintenance") |
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
as on status.claude.com. A day's colour is:

- **red** if the instance was red for 15 minutes or more that day;
- otherwise **yellow** if it was yellow for 15 minutes or more;
- otherwise **green**;
- **grey** if fewer than half of the expected samples exist for that day.

Hovering or tapping a bar shows the day, the time in each state and the incidents with
their reasons (for example "LND not synced, 21 h 12 min").

Uptime % = time not red ÷ time with data, over the 90 days, shown under the bars as in
the reference ("99.54 % uptime"). Grey time is excluded, not counted as up.

## 6. Layout

Inspired by status.claude.com: calm, plenty of whitespace, one column, with the state
before anything else.

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
  - the event id with a link to view it on a Nostr explorer ("verify it yourself").
- **Incident history:** a simple list under the instances of the latest red and yellow
  periods across all instances, derived from the daily rollups. There are no
  hand-written incident posts in v1.
- **Responsive:** on a phone the 90 bars become 30 (last 30 days) so each stays
  tappable. The banner and the colours don't change.
- **Light and dark themes**, following the system, with a toggle. The three traffic
  colours meet WCAG AA contrast against both backgrounds; the text labels carry the
  meaning.
- **Language:** Spanish and English, following the browser, with a toggle. The URL
  keeps the choice (`?lang=en`).

## 7. Architecture

```text
            ┌──────────── GitHub Pages (static) ────────────┐
 browser ──►│ index.html · app.js · styles.css · trusted.json│
   │        │ data/daily/*.json (written by the sampler)     │
   │        └───────────────────────────────────────────────┘
   ├──► Nostr relays (wss)        live 38389 / 38385 events
   └──► block explorers (https)   tip height per network

 GitHub Actions (every 10 min) ──► relays ──► data branch ──► Pages
```

- **Front end:** plain HTML, CSS and ES modules, no framework and no build step.
  nostr-tools is loaded from a CDN pinned to an exact version with an SRI hash.
  Vanilla keeps the attack surface small and the page easy to audit.
- **Reader module:** `src/reader.js` holds the spec's reader rules as pure functions,
  shared by the page and by the sampler (Node). It is ported from the status page in
  MostroP2P/mostro-watchdog#48 and its tests.
- **Sampler:** `scripts/sample.mjs` and `scripts/rollup.mjs`, run by
  `.github/workflows/sample.yml` (scheduled) and `deploy.yml` (on push to `main` and
  after each sample).
- **Configuration:** `config.json` holds every tunable value, so it can be changed with a
  pull request and no code change. The page and the sampler read the same file.

  ```json
  {
    "relays": [
      "wss://relay.mostro.network",
      "wss://mostro-p2p.tech",
      "wss://relay.shadowbip.com"
    ],
    "sample_interval_minutes": 10,
    "raw_sample_retention_days": 90,
    "daily_rollup_retention_days": 400,
    "history_days_shown": 90,
    "day_state_threshold_minutes": 15,
    "min_day_coverage": 0.5,
    "block_lag_red": 3,
    "explorer_tip_max_age_minutes": 30
  }
  ```

  The relays are the global Mostro's. The workflow's cron schedule is generated from
  `sample_interval_minutes`, and GitHub's minimum is 5 minutes.
- **Domain:** `status.mostro.network`, through a `CNAME` file in the published site and a
  DNS CNAME record pointing to `mostrop2p.github.io`.
- **Live versus history:** the colour shown now always comes from the live events read
  by the browser, never from the sampler. History only feeds the bars and the uptime.
- **Security:**
  - a strict Content-Security-Policy (scripts only from self and the pinned CDN;
    `connect-src` limited to the trusted relays and the explorers);
  - all event text rendered with `textContent`, never HTML;
  - every value validated as the spec says before use.
- **Tests:**
  - `node --test` for the reader rules, the traffic-light mapping, the daily
    aggregation and the banner, run in CI on every pull request;
  - a smoke test that loads the page against a local relay with fixture events.

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
