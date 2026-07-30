# event-radar

Polls hackathon/event sources, pushes new AI + India/remote matches to Telegram.
Runs free forever on GitHub Actions cron. No server, no paid tier.

## What it does

- Sources:
  - **Devpost** (JSON) — global hackathons.
  - **Devfolio** (public API) — India's main hackathon host: Hacker House Goa, most Indian hackathons. Precurated (skips keyword gate). No key, no config.
  - **Luma calendars** (ICS) — communities you explicitly subscribe to.
  - **Luma discover** (public API) — sweeps `ai`+`tech` events around Indian cities incl. Goa. Catches one-off events NOT in any calendar: hacker houses, makeathons, demo days, Sarvam Epoch satellites. Surfaces `sold out` / `N spots left`.
  - **HackerEarth** (public API) — hackathon + competitive challenges. No key.
  - **Sarvam** (public Sanity dataset) — Sarvam Epoch, webinars, hackathons straight from the CMS behind sarvam.ai/events. Precurated. No key.
  - **MLH** (scrape) — student hackathon season.
  - **Web search** — for events on no structured feed at all. Brave when `BRAVE_API_KEY` is set, otherwise a keyless DuckDuckGo HTML scrape.
- Filters: whole-word AI/ML keywords, excludes noise (school events), India-or-remote only. Luma-discover events skip the keyword gate (already scoped) but still honor India/remote + exclude.
- Dedupes via `data/seen.json` (committed back each run).
- Alerts on: new match, and again 48h before a deadline/start you've already seen.

## Setup (~10 min)

### 1. Telegram bot
1. Telegram → message `@BotFather` → `/newbot` → copy the **bot token**.
2. Message your new bot anything (say "hi") so it can DM you.
3. Get your **chat id**: message `@userinfobot` → it replies your numeric id.

### 2. Local test
```bash
npm install
npm run selftest          # offline logic check, no secrets needed
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy npm start   # real run
```
No secrets set = dry mode: prints what it *would* send.

### 3. Add Luma calendars (best source)
Open any Luma calendar page → Subscribe → "Add to Calendar" gives an ICS link
like `https://api.lu.ma/ics/get?entity=cal-XXXX`. Paste into `config.js` →
`lumaIcsUrls`. Add Bangalore/Mumbai tech + AI community calendars.

### 4. Deploy (GitHub Actions — free)
1. Push this repo to GitHub.
2. Repo → Settings → Secrets and variables → Actions → add
   `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. **Without these the run is dry:**
   it still records everything into `seen.json`, so the backlog is consumed
   silently and those events never reach you.
3. Repo → Settings → Actions → General → Workflow permissions →
   **Read and write**. New repos default to read-only, which makes the
   `seen.json` commit at the end of the run fail — and it fails *green*, because
   the push is wrapped in `|| echo`. Symptom: every hourly run re-alerts events
   you were already sent.
4. Seed once, so the existing backlog (~240 events) doesn't land as one flood:
   ```bash
   node src/radar.js --seed
   git add data/seen.json && git commit -m "seed seen state" && git push
   ```
5. Actions tab → enable workflows. Runs **hourly** (`0 * * * *`).
   Hit "Run workflow" once to test.

GitHub disables scheduled workflows after 60 days of repo inactivity, and cron on
a busy hour commonly lags 10–20 minutes. Neither is worth fighting.

## Tuning
Everything in `config.js`: keywords, exclude list, India/remote toggle, Luma ICS
URLs, `lumaDiscover` cities/categories (add/remove cities, edit coords), and
`searchQueries` for the optional web-search net.

### Devfolio (India hackathons — the big source, zero setup)
Nothing to configure. It POSTs to `api.devfolio.co/api/search/hackathons`, the same
public keyless endpoint devfolio.co's own list page calls, over the `application_open`
and `upcoming` buckets. Deadline shown is `reg_ends_at` (last day to apply).
If Devfolio changes that endpoint you'll see `devfolio fail: <type> <status>` in the
run logs — re-derive the call from `devfolio.co/hackathons/open` → DevTools → Network.

### Web-search net (off-Luma, off-Devfolio events)
For events announced only on a standalone site / LinkedIn / X. Works with no key —
`config.webSearch.provider` picks how:

| value | behaviour |
|---|---|
| `auto` (default) | Brave if `BRAVE_API_KEY` is set, else DuckDuckGo |
| `ddg` | force the keyless `html.duckduckgo.com` scrape |
| `brave` | force Brave; logs and skips if the key is missing |
| `off` | no web search |

**DDG caveat, by design:** unofficial endpoint, and DuckDuckGo throttles shared CI
egress IPs — an Actions run can legitimately return `ddg fail: blocked (anomaly page)`
and zero hits. The sweep stops at the first block instead of hammering. Treat it as a
bonus net; Devfolio/Luma are the sources you actually rely on. Want it reliable?
Set `BRAVE_API_KEY` (2k queries/mo free) and `auto` switches over.

Search hits aren't precurated, so they face the full keyword + India/remote gate, plus
a `DENY_HOSTS` list in `websearch.js` that drops listicle/aggregator domains
(reskilll, internshala, YouTube, Reddit …). Tune queries in `config.searchQueries`.

## Adding a source
Drop `src/sources/foo.js` exporting `async function fetchFoo()` that returns
`normalize({title,url,deadline,location,description}, "foo")[]`. Wire it into
`Promise.allSettled([...])` in `src/radar.js`. One failing source never kills the run.

## Notes
- Devpost/MLH endpoints can change shape; parsing is defensive but verify if a source goes quiet.
- Company pages without feeds (Sarvam, Anthropic, OpenAI) aren't polled yet — add as scrape sources, or watch their Luma calendars where they post.
- Want email too? Add a `src/email.js` (Resend free tier) alongside `telegram.js` and call it in the loop.
```
