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

The page has no build step and no dependencies to install. The tests need Node 24:

```sh
npm test
npm run test:coverage
```

## License

[GPL-3.0](LICENSE)
