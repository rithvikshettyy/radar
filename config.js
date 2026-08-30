// Edit this file to tune what you get.

export const config = {
  // An event is RELEVANT if it matches at least one include keyword
  // AND does not match any exclude keyword. Case-insensitive.
  include: [
    "ai", "ml", "machine learning", "llm", "gen ai", "generative",
    "agent", "hackathon", "buildathon", "devpost", "sarvam",
    "openai", "anthropic", "claude", "gemini", "llama", "rag",
  ],
  // Keep noise out. Matched whole-word against title + location + description +
  // tags, so plurals need their own entry ("bootcamp" does NOT match "bootcamps").
  exclude: [
    "high school", "class 9", "class 10", "class 11", "class 12", "school students",
    // Paid training dressed up as an event — a course you buy, not a thing you enter.
    "bootcamp", "bootcamps", "boot camp", "boot camps", "masterclass", "crash course",
    // Not the domain you're building in.
    "fashion", "fashion week", "fashion show",
  ],
  // Only surface events that are India-based OR online/remote.
  // Set to false to get everything that matches keywords.
  indiaOrRemoteOnly: true,
  indiaOrRemoteHints: [
    "india", "bengaluru", "bangalore", "mumbai", "delhi", "hyderabad",
    "pune", "chennai", "thane", "goa", "panaji", "kolkata", "ahmedabad",
    "jaipur", "kochi", "chandigarh", "noida", "gurugram", "gurgaon",
    "mohali", "lucknow", "indore", "coimbatore", "bhubaneswar", "nagpur",
    "online", "remote", "virtual",
    // NOT "global": it's the one hint that names neither a place nor a delivery
    // mode, so it matched press-release boilerplate ("the global leader in…") and
    // walked a Dubai product announcement straight through an India-only gate.
    // A genuinely global online hackathon still passes on online/remote/virtual.
  ],

  // Luma calendars to watch. Open any Luma calendar page, grab its ICS URL
  // (calendar page -> Subscribe -> "Add to Calendar" gives an ICS link like
  //  https://api.lu.ma/ics/get?entity=cal-XXXX ). Paste those here.
  lumaIcsUrls: [
    // "https://api.lu.ma/ics/get?entity=cal-xxxxxxxx",
  ],

  // Luma DISCOVERY sweep — catches one-off Luma events NOT in any calendar you
  // subscribed to (hacker houses, makeathons, demo days, Sarvam Epoch satellites).
  // Sweeps each category around each city's coordinates. India cities + Goa below.
  lumaDiscover: {
    categories: ["ai", "tech"],
    cities: [
      { name: "Bengaluru", lat: 12.9716, lng: 77.5946 },
      { name: "Mumbai", lat: 19.076, lng: 72.8777 },
      { name: "Delhi", lat: 28.6139, lng: 77.209 },
      { name: "Hyderabad", lat: 17.385, lng: 78.4867 },
      { name: "Pune", lat: 18.5204, lng: 73.8567 },
      { name: "Goa", lat: 15.4909, lng: 73.8278 },
    ],
  },

  // Devfolio (India's main hackathon host) needs no config — it reads the same
  // public, keyless endpoint the site's own hackathon list uses. Nothing to paste.

  // Web-search net for events that live on no structured feed at all.
  //   "auto"      (default) Brave if BRAVE_API_KEY is set, else Firecrawl
  //   "firecrawl" api.firecrawl.dev — JSON, answers with no key, works from CI
  //   "ddg"       the keyless DuckDuckGo HTML scrape (blocked on CI IPs a lot)
  //   "brave"     force Brave (skips with a log line if the key is missing)
  //   "off"       no web search at all
  // Search is a bonus net either way — the structured sources (devfolio,
  // hackculture, luma) are what you actually rely on.
  webSearch: { provider: "auto" },

  // {year} / {nextYear} expand at run time. Hard-coding "2026" here quietly rots:
  // come January the radar keeps asking for last year's events and then alerts you
  // to pages about hackathons that already finished.
  searchQueries: [
    "AI hackathon India {year} apply",
    "hacker house India {year}",
    "Sarvam Epoch {year}",
    "AI buildathon Bengaluru {year} register",
    "Anthropic Claude hackathon India {year}",
    "AI hackathon India {nextYear} registration open",
  ],

  // Extra hosts the web-search net must never surface, on top of the built-in list
  // in src/sources/websearch.js. Matched on hostname (subdomains included); add a
  // path to narrow it, e.g. "example.com/blog".
  denyHosts: [
    // Social posts: a tweet is an announcement, never a page you can apply on, and
    // it carries no date the expiry check can read — so it lingers for months.
    "x.com", "twitter.com", "t.co", "bsky.app", "mastodon.social",
    // Developer-blog platforms: write-ups ABOUT hackathons, not the hackathons.
    "dev.to", "hashnode.dev", "substack.com", "wordpress.com", "blogspot.com",
    // Content/SEO sites that rank for event queries with nothing to register for.
    "incorpx.io",
  ],

  // Re-alert this many hours before a deadline/start you've already seen once.
  deadlineReminderHours: 48,

  // Timezone for dates in Telegram messages. GitHub Actions runners are UTC, so
  // without this a 9pm IST event shows the previous day. Any IANA zone name.
  timezone: "Asia/Kolkata",

  // Per-source colour tag on each Telegram message.
  //
  // Telegram gives bots NO way to colour text — HTML mode allows b/i/u/s/code/pre/
  // a/blockquote and nothing else, and <tg-emoji> (real coloured custom emoji) is
  // restricted to bots that bought a username on Fragment. A coloured square is
  // therefore the only colour that actually renders, on every client, for free.
  // It's prefixed to the header line, so the colour is what you see first in the
  // chat list preview.
  //
  // Key = the source name a fetcher passes to normalize(). Unlisted -> `default`.
  sourceColors: {
    basecamp: "🟠",
    devfolio: "🔵",
    luma: "🟣",
    "luma-discover": "🟣",
    default: "⚪",
  },
};
