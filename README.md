# TamilMV Torznab Proxy

A small Node.js service that turns the search results of a TamilMV mirror into a
Torznab-compatible RSS feed, so Prowlarr / Radarr can query it like any other
indexer.

Originally created by **[Febin Baiju](https://github.com/febinbaiju)** in
[febinbaiju/TamilMV-Torznab-Proxy](https://github.com/febinbaiju/TamilMV-Torznab-Proxy).
This repository is a fork maintained by [goks](https://github.com/goks), released
under the same ISC licence.

## Disclaimer

This project is provided **for educational purposes only** — as an example of
writing a Torznab-compatible indexer and scraping a public forum.

It is **not intended for, and must not be used for, any piracy-related activity**.
It does not host, upload, store or distribute any copyrighted material; it only
reformats search results that the upstream site already publishes. You are
responsible for how you use it and for complying with the laws of your
jurisdiction and the terms of any site it talks to. The authors and contributors
accept no liability for misuse.

If you are a rights holder and believe this project facilitates infringement,
open an issue and it will be addressed.

## How it works

1. Calls the mirror's public search endpoint (`/search/api/search.php`) with the
   query.
2. Fetches each matching forum topic and extracts the torrent / magnet links.
3. Renders them as a Torznab RSS feed.

Because Radarr and Sonarr rewrite `&` to `and` in search terms, the service also
queries the `&` spelling and merges the results.

## Endpoints

| Path | Purpose |
| --- | --- |
| `GET /` | Settings page (mirror URL, RSS fallback keyword) and a test search box |
| `GET /api` | Torznab endpoint (`t=caps`, `t=search`, `t=movie`), category `2000` |
| `GET /api/last` | JSON describing the last `/api` request, for debugging |

Requests without a `q` (Prowlarr's RSS sync, caps, ID-only movie lookups) return
an empty feed without contacting the site, unless the *Custom Search* toggle is
enabled — then the saved keyword is used as the fallback query. Queries
containing non-ASCII characters also return an empty feed, because the upstream
search does not handle them well.

## Run it

```bash
docker compose up -d
```

The container listens on port 5000. Configuration is stored in
`/app/database/manager.db` inside the container, which is **not persisted** —
mount a volume at `/app/database` if you want settings to survive recreating the
container.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `5000` | HTTP port |
| `TAMILMV_URL` | `https://www.1tamilmv.cards` | Mirror used for the first request |

Without Docker:

```bash
npm install
npm start      # http://localhost:5000
npm test
```

## Add it to Prowlarr

1. *Indexers → Add Indexer → Generic Torznab*.
2. URL: `http://<host>:5000/api`, Categories: `2000`, API Path: `/api`.
3. Test and save.

## Licence

ISC. See `package.json`. Original work © Febin Baiju; modifications © the fork's
contributors.
