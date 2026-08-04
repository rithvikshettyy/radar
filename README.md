# event-radar

> Hourly hackathon + AI-event radar for India. Polls 9 sources, filters, dedupes, and pushes only the new stuff to Telegram.

[![radar](https://github.com/rithvikshettyy/radar/actions/workflows/radar.yml/badge.svg)](https://github.com/rithvikshettyy/radar/actions/workflows/radar.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)
![Runs on](https://img.shields.io/badge/runs%20on-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)
![Cost](https://img.shields.io/badge/cost-%240-brightgreen)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Finding out about a hackathon the day after registration closed is the whole
problem this solves. `event-radar` sweeps every feed that actually lists Indian
and remote AI events, keeps a `seen.json` so nothing is sent twice, and pings you
again 48h before a deadline you already know about.

No server, no database, no paid API. It runs entirely inside a GitHub Actions
cron job on the free tier.

```
🆕 NEW EVENT                              ⏰ DEADLINE SOON — in 9h

Hacker House Goa 2026   ← tappable link   Sarvam Epoch

📍 Goa · 12 spots left                    📍 Bengaluru
⏳ Mon, 10 Aug 2026, 17:23 · in 11 days   ⏳ Fri, 31 Jul 2026, 02:23
🗓 Posted Thu, 30 Jul 2026 (today)        🗓 Posted Sat, 25 Jul 2026 (5 days ago)
🔗 devfolio · hhgoa.devfolio.co           🔗 luma-discover · luma.com
```

---

## Contents

- [Sources](#sources)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Deploy on GitHub Actions](#deploy-on-github-actions)
- [Configuration](#configuration)
- [Message format](#message-format)
- [Project layout](#project-layout)
- [Adding a source](#adding-a-source)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Sources

| Source | Access | What it brings | Key needed |
|---|---|---|---|
| **Devfolio** | public API | India's main hackathon host — Hacker House Goa, most Indian hackathons. Precurated. | no |
| **Luma discover** | public API | Sweeps `ai` + `tech` events around 6 Indian cities incl. Goa. Catches one-off events in no calendar: hacker houses, makeathons, demo days. Surfaces `sold out` / `N spots left`. | no |
| **HackCulture** | public API | India-focused host for corporate/campus hackathons and innovation challenges — Sarvam BuildIn' Hours, GFF fintech sprints, campus hackathons. Precurated, registration-open only. | no |
| **Luma calendars** | ICS | Communities you explicitly subscribe to. | no |
| **Devpost** | JSON | Global hackathons. | no |
| **HackerEarth** | public API | Hackathons + competitive challenges. | no |
| **Sarvam** | public Sanity dataset | Sarvam Epoch, webinars, hackathons straight from the CMS behind `sarvam.ai/events`. Precurated. | no |
| **MLH** | scrape | Student hackathon season (current + next). | no |
| **Web search** | Brave or DDG | Events that live on no structured feed at all — standalone sites, LinkedIn, X. | optional |

Every source runs under `Promise.allSettled`, so one dead feed never kills the run.

## How it works

```mermaid
flowchart LR
  A[9 sources<br/>Promise.allSettled] --> B[normalize]
  B --> C{isRelevant}
  C -->|keyword + India/remote gate| D{isExpired}
  D -->|deadline passed → drop| X[✕]
  D --> E[dedupe by id]
  E --> F{in seen.json?}
  F -->|no| G[🆕 NEW → Telegram]
  F -->|yes, deadline ≤48h| H[⏰ REMINDER → Telegram]
  G --> I[(data/seen.json)]
  H --> I
  I --> J[committed back by the workflow]
```

- **Relevance** — whole-word keyword match (`ai` hits *AI hackathon*, not *Mumbai*),
  minus an exclude list (school events), and India-or-remote only. Precurated
  sources (Luma discover, Devfolio, HackCulture, Sarvam) skip the keyword gate —
  they're already scoped — but still honor the India/remote and exclude filters.
- **Dedupe** — stable hash of the event URL, keyed by source. One event arriving
  twice in a run (Devpost queries two listings, Luma calendars overlap) collapses to
  the copy that actually carries a deadline.
- **State** — `data/seen.json`, committed back by the workflow after each run.
- **Alerts** — once when new, once more when the deadline is inside
  `deadlineReminderHours` (default 48). If an event is *already* inside that window
  when first seen, the reminder is burned immediately so it doesn't re-ping next hour.

## Quick start

Requires Node ≥ 22 (uses global `fetch`).

```bash
git clone https://github.com/rithvikshettyy/radar.git
cd radar
npm install

npm run selftest   # offline logic check — no secrets, no network
npm run dry        # real fetch, prints what it would send
npm start          # real run (dry unless the Telegram env vars are set)
```

| Script | Does |
|---|---|
| `npm start` | Full run. Sends to Telegram if secrets are set, otherwise prints. |
| `npm run dry` | Fetches for real, never sends, **still writes `seen.json`**. |
| `npm run seed` | Records everything as already-seen without notifying. Run once so an existing backlog doesn't arrive as one flood. |
| `npm run selftest` | Offline checks on filtering + message formatting. |

### Telegram bot

1. Message [`@BotFather`](https://t.me/BotFather) → `/newbot` → copy the **bot token**.
2. Message your new bot anything (say "hi") so it's allowed to DM you.
3. Message [`@userinfobot`](https://t.me/userinfobot) → it replies your numeric **chat id**.

```bash
cp .env.example .env   # then export them, or pass inline:
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy npm start
```

| Variable | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes (to actually send) | BotFather token |
| `TELEGRAM_CHAT_ID` | yes (to actually send) | Your numeric chat id |
| `BRAVE_API_KEY` | no | Switches web search from the DDG scrape to Brave |

Unset token/chat = dry mode: it prints what it *would* send.

## Deploy on GitHub Actions

1. **Push the repo to GitHub.**
2. **Settings → Secrets and variables → Actions** → add `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_CHAT_ID`.
   > ⚠️ Without these the run is dry — but it *still* records everything into
   > `seen.json`, so the backlog is consumed silently and those events never reach you.
3. **Settings → Actions → General → Workflow permissions → Read and write.**
   New repos default to read-only, which makes the `seen.json` commit fail — and it
   fails *green*, because the push is wrapped in `|| echo`. Symptom: every hourly run
   re-alerts events you already got.
4. **Seed once**, so the existing backlog (~240 events) doesn't land as one flood:
   ```bash
   npm run seed
   git add data/seen.json && git commit -m "seed seen state" && git push
   ```
5. **Actions tab → enable workflows.** Runs hourly (`0 * * * *`); hit **Run workflow**
   once to test.

Two GitHub facts worth knowing, neither worth fighting: scheduled workflows are
disabled after 60 days of repo inactivity, and cron on a busy hour commonly lags
10–20 minutes.

## Configuration

Everything lives in [`config.js`](config.js).

| Key | Default | What it controls |
|---|---|---|
| `include` | AI/ML/hackathon terms | Whole-word keywords an event must match |
| `exclude` | school-event terms | Kills a match outright |
| `indiaOrRemoteOnly` | `true` | Restrict to India-based or online/remote |
| `indiaOrRemoteHints` | 20+ cities + `online`/`remote`/`virtual` | What counts as India-or-remote |
| `lumaIcsUrls` | `[]` | Luma calendars to watch (see below) |
| `lumaDiscover` | `ai`+`tech` × 6 cities | Categories and city coordinates for the discovery sweep |
| `webSearch.provider` | `auto` | `auto` \| `ddg` \| `brave` \| `off` |
| `searchQueries` | 5 queries | What the web-search net looks for |
| `deadlineReminderHours` | `48` | How early the reminder fires |
| `timezone` | `Asia/Kolkata` | IANA zone for dates in messages |

### Luma calendars

Open any Luma calendar page → **Subscribe** → "Add to Calendar" gives an ICS link
like `https://api.lu.ma/ics/get?entity=cal-XXXX`. Paste it into `config.lumaIcsUrls`.
Bangalore/Mumbai tech + AI community calendars are the high-yield ones.

### Devfolio — zero setup

Nothing to configure. It POSTs to `api.devfolio.co/api/search/hackathons`, the same
public keyless endpoint the site's own list page calls, over the `application_open`
and `upcoming` buckets. The deadline shown is `reg_ends_at` (last day to apply).

### Web-search net

For events announced only on a standalone site / LinkedIn / X. Works with no key —
`config.webSearch.provider` picks how:

| value | behaviour |
|---|---|
| `auto` *(default)* | Brave if `BRAVE_API_KEY` is set, else DuckDuckGo |
| `ddg` | force the keyless `html.duckduckgo.com` scrape |
| `brave` | force Brave; logs and skips if the key is missing |
| `off` | no web search |

**DDG caveat, by design:** unofficial endpoint, and DuckDuckGo throttles shared CI
egress IPs — an Actions run can legitimately return `ddg fail: blocked (anomaly page)`
and zero hits. The sweep stops at the first block instead of hammering. Treat it as a
bonus net; Devfolio/Luma are what you actually rely on. Want it reliable? Set
`BRAVE_API_KEY` (2k queries/mo free) and `auto` switches over.

Search hits aren't precurated, so they face the full keyword + India/remote gate, plus
a `DENY_HOSTS` list in `websearch.js` that drops listicle/aggregator domains
(reskilll, internshala, YouTube, Reddit …).

## Message format

The title carries the link — Telegram still builds its preview from it — so there's no
raw URL line; the footer shows source + destination host instead. Any missing field
drops its own line, and an unparseable date is printed raw rather than as
`Invalid Date`.

**On the posted date.** Almost no feed exposes a publish timestamp (checked: Devfolio,
Devpost, HackerEarth, Luma discover — none). Sarvam's CMS gives `_createdAt` and Luma
ICS gives `CREATED`; those are used directly. Everything else falls back to
`firstSeen` — the run that first spotted the event — recorded per event in `seen.json`,
so a later deadline reminder shows the same date. Entries that predate this (and
anything recorded with `--seed`) have no `firstSeen`, so they omit the line rather than
claim they were posted today.

Dates render in `config.timezone`. Actions runners are UTC, which would otherwise push
a 9pm IST event onto the previous day.

## Project layout

```
.
├── config.js               # every knob worth turning
├── data/seen.json          # dedupe state, committed back each run
├── .github/workflows/
│   └── radar.yml           # hourly cron + seen.json commit
└── src/
    ├── radar.js            # entry point: fetch → filter → dedupe → notify
    ├── filter.js           # id hashing, normalize(), relevance, expiry, reminders
    ├── telegram.js         # HTML message formatting + sendMessage
    ├── selftest.js         # offline checks
    └── sources/
        ├── devfolio.js  devpost.js  hackculture.js
        ├── hackerearth.js  mlh.js  sarvam.js
        └── luma.js  luma-discover.js  websearch.js
```

## Adding a source

Drop `src/sources/foo.js` exporting an `async function fetchFoo()` that returns

```js
normalize({ title, url, deadline, location, description, posted }, "foo")[]
```

Set `posted` only if the feed genuinely has a publish date — otherwise leave it off
and `firstSeen` covers it. Pass `{ precurated: true }` as the third argument if the
feed is already scoped and shouldn't face the keyword gate. Then wire the call into
the `Promise.allSettled([...])` array in [`src/radar.js`](src/radar.js). A failing
source never kills the run.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Every hourly run re-sends the same events | Workflow permissions are read-only, so the `seen.json` commit silently fails. Fix in Settings → Actions → General. |
| Workflow is green but nothing arrives in Telegram | Secrets missing → dry mode. It logged `[dry] would send:` and consumed the backlog into `seen.json`. |
| `devfolio fail: <type> <status>` in the logs | Endpoint changed. Re-derive the call from `devfolio.co/hackathons/open` → DevTools → Network. |
| `hackculture fail: 401` | The endpoint moved to the login-only `/hackathons/all` variant. The keyless one is `GET api.hackculture.io/api/v1/hackathons?skip=&limit=` (limit ≤ 50), what `/programs` itself calls. |
| `ddg fail: blocked (anomaly page)`, zero web hits | Expected on CI IPs. Set `BRAVE_API_KEY` if you want the net to be reliable. |
| A source goes quiet | Devpost/MLH markup can change shape. Parsing is defensive, so it fails to zero results rather than crashing — check the run log's per-source counts. |
| Scheduled runs stopped entirely | GitHub disables cron after 60 days of repo inactivity. Re-enable in the Actions tab. |

## Notes

- Company pages without feeds (Anthropic, OpenAI) aren't polled — add them as scrape
  sources, or watch their Luma calendars, where they usually post anyway.
- Want email too? Add `src/email.js` (Resend free tier) alongside `telegram.js` and
  call it in the deliver path.

## License

[MIT](LICENSE) © Rithvik Shetty
