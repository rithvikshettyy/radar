# event-radar

Polls hackathon/event sources, pushes new AI + India/remote matches to Telegram.
Runs free forever on GitHub Actions cron. No server, no paid tier.

## What it does

- Sources:
  - **Devpost** (JSON) — global hackathons.
  - **Devfolio** (Algolia) — India's main hackathon host: Hacker House Goa, most Indian hackathons. Precurated (skips keyword gate). Needs a one-time key paste (see below).
  - **Luma calendars** (ICS) — communities you explicitly subscribe to.
  - **Luma discover** (public API) — sweeps `ai`+`tech` events around Indian cities incl. Goa. Catches one-off events NOT in any calendar: hacker houses, makeathons, demo days, Sarvam Epoch satellites. Surfaces `sold out` / `N spots left`.
  - **MLH** (scrape) — student hackathon season.
  - **Web search** (optional, Brave free tier) — for events on no structured feed at all. Off unless `BRAVE_API_KEY` set.
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
   `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
3. Actions tab → enable workflows. Runs daily 08:00 IST.
   Hit "Run workflow" once to test.

## Tuning
Everything in `config.js`: keywords, exclude list, India/remote toggle, Luma ICS
URLs, `lumaDiscover` cities/categories (add/remove cities, edit coords), and
`searchQueries` for the optional web-search net.

### Devfolio key (India hackathons — do this, it's the big one)
Devfolio's list comes from Algolia. Grab the public creds once:
1. Open `devfolio.co/hackathons/open` → DevTools (F12) → **Network** tab.
2. Filter for `algolia`. Reload. Click any request.
3. **Headers** → copy `x-algolia-api-key`. (App ID + index name are pre-filled in
   `config.js`; if they differ, `x-algolia-application-id` is in the same headers and
   the index name is in the request URL `/1/indexes/<index>/queries`.)
4. Paste the key into `config.devfolio.apiKey`.
If Devfolio ever rotates it you'll see a `403` in the run logs — just recopy.

### Optional: web-search net (off-Luma, off-Devfolio events)
For events announced only on a standalone site / LinkedIn / X:
1. Get a free key at brave.com/search/api.
2. Add repo secret `BRAVE_API_KEY` (and set it locally to test).
3. It auto-activates. Edit `config.searchQueries` to tune.

## Adding a source
Drop `src/sources/foo.js` exporting `async function fetchFoo()` that returns
`normalize({title,url,deadline,location,description}, "foo")[]`. Wire it into
`Promise.allSettled([...])` in `src/radar.js`. One failing source never kills the run.

## Notes
- Devpost/MLH endpoints can change shape; parsing is defensive but verify if a source goes quiet.
- Company pages without feeds (Sarvam, Anthropic, OpenAI) aren't polled yet — add as scrape sources, or watch their Luma calendars where they post.
- Want email too? Add a `src/email.js` (Resend free tier) alongside `telegram.js` and call it in the loop.
```
