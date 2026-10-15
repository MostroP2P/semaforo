# Semáforo

The public status page of trusted Mostro instances: one look tells you whether each
trusted Mostro can trade right now (green, yellow or red) and how reliable it has been
over the last 90 days.

It reads the signed Mostro health events (kind 38389) straight from Nostr relays and
verifies them in your browser. There is no backend and no tracking.

The design is in [docs/SPEC.md](docs/SPEC.md). Nothing is implemented yet.

## License

[GPL-3.0](LICENSE)
