// Offline sanity test: no network, no secrets. Validates filter + dedupe + reminder logic.
import { normalize, idFor, isRelevant, isExpired, deadlineDueSoon, extractLatestDate } from "./filter.js";
import { toIso } from "./sources/devfolio.js";
import { parseDdgHtml, looksLikeArticle, expandQuery, denied } from "./sources/websearch.js";
import { parseDevpostRange } from "./sources/devpost.js";
import { parseSeasonHtml } from "./sources/mlh.js";
import { formatMessage, parseTargets } from "./telegram.js";

let fail = 0;
const ok = (cond, msg) => {
  if (!cond) {
    fail++;
    console.error("FAIL:", msg);
  } else console.log("pass:", msg);
};

const inFuture = (h) => new Date(Date.now() + h * 3.6e6).toISOString();

const aiIndia = normalize(
  { title: "GenAI Buildathon Bengaluru", url: "https://x.com/a", location: "Bengaluru, India" },
  "devpost"
);
const aiRemote = normalize(
  { title: "LLM Agent Hackathon", url: "https://x.com/b", location: "Online" },
  "devpost"
);
const aiUsOnly = normalize(
  { title: "AI Hackathon", url: "https://x.com/c", location: "Redmond, WA" },
  "devpost"
);
const nonAi = normalize(
  { title: "Baking contest", url: "https://x.com/d", location: "Mumbai" },
  "mlh"
);
const schoolAi = normalize(
  { title: "AI hackathon for high school students", url: "https://x.com/e", location: "Online" },
  "mlh"
);

ok(isRelevant(aiIndia), "AI + India passes");
ok(isRelevant(aiRemote), "AI + remote passes");
ok(!isRelevant(aiUsOnly), "AI + US-only rejected (indiaOrRemoteOnly)");
ok(!isRelevant(nonAi), "non-AI rejected");
ok(!isRelevant(schoolAi), "school-tagged rejected via exclude");

// precurated (Luma ai/tech sweep): no AI keyword needed, but India/remote + exclude still apply
const hackerHouseGoa = normalize(
  { title: "Hacker House Goa 2026", url: "https://luma.com/hhgoa", location: "Goa · 12 spots left" },
  "luma-discover",
  { precurated: true }
);
const sarvamEpoch = normalize(
  { title: "Sarvam Epoch", url: "https://luma.com/epoch", location: "Bengaluru" },
  "luma-discover",
  { precurated: true }
);
const precuratedUsParty = normalize(
  { title: "Founder Mixer", url: "https://luma.com/x", location: "San Francisco" },
  "luma-discover",
  { precurated: true }
);
const precuratedSchool = normalize(
  { title: "Kids coding day for high school students", url: "https://luma.com/y", location: "Online" },
  "luma-discover",
  { precurated: true }
);
ok(isRelevant(hackerHouseGoa), "precurated Hacker House Goa passes (no AI word needed)");
ok(isRelevant(sarvamEpoch), "precurated Sarvam Epoch passes");
ok(!isRelevant(precuratedUsParty), "precurated US event still rejected (not India/remote)");
ok(!isRelevant(precuratedSchool), "precurated school event still excluded");

// dedupe: same url -> same id; different url -> different id
ok(idFor({ ...aiIndia, id: "" }) === idFor({ ...aiIndia, id: "" }), "stable id for same event");
ok(idFor(aiIndia) !== idFor(aiRemote), "different url -> different id");

// deadline reminder window
ok(deadlineDueSoon({ deadline: inFuture(10) }), "10h out -> due soon");
ok(!deadlineDueSoon({ deadline: inFuture(200) }), "200h out -> not yet");
ok(!deadlineDueSoon({ deadline: inFuture(-5) }), "past deadline -> no");
ok(!deadlineDueSoon({ deadline: null }), "no deadline -> no");

// expiry gate: entry closed = not news, even if the event itself is still running
ok(isExpired({ deadline: inFuture(-1) }), "deadline an hour ago -> expired");
ok(!isExpired({ deadline: inFuture(1) }), "deadline an hour out -> live");
ok(!isExpired({ deadline: null }), "no deadline -> kept, not expired");
ok(!isExpired({ deadline: "sometime soon" }), "unparseable deadline -> kept");

// devfolio timestamp normalization (unix seconds, unix ms, ISO string, null)
const isoSec = toIso(1893456000); // 2030-ish unix seconds
const isoMs = toIso(1893456000000); // same in ms
ok(isoSec === isoMs, "toIso: unix seconds and ms resolve equal");
ok(toIso("2026-09-01T10:00:00Z") === "2026-09-01T10:00:00.000Z", "toIso: ISO string ok");
ok(toIso(null) === null && toIso("garbage") === null, "toIso: bad input -> null");

// a devfolio-shaped hackathon (no AI word, offline India) still passes via precurated
const devfolioGoa = normalize(
  { title: "Hacker House Goa", url: "https://hhgoa.devfolio.co", location: "Goa", tags: "hackathon devfolio" },
  "devfolio",
  { precurated: true }
);
ok(isRelevant(devfolioGoa), "devfolio Hacker House Goa passes");

// Devpost date range -> deadline. It has no machine-readable end field, only a
// display string, and feeding that to new Date() rendered "Invalid Date" in Telegram
// while silently killing every devpost 48h reminder (Date.parse -> NaN -> false).
ok(parseDevpostRange("Jul 28 - Aug 12, 2026") === "2026-08-12T23:59:00.000Z", "devpost: cross-month range -> end date");
ok(parseDevpostRange("Jul 27 - 31, 2026") === "2026-07-31T23:59:00.000Z", "devpost: day-only end inherits month");
ok(parseDevpostRange("Dec 20, 2026 - Jan 5, 2027") === "2027-01-05T23:59:00.000Z", "devpost: end carries its own year");
ok(parseDevpostRange("Jul 28, 2026") === "2026-07-28T23:59:00.000Z", "devpost: single day");
ok(parseDevpostRange("Jul 28, 2026 - Aug 12") === "2026-08-12T23:59:00.000Z", "devpost: year-less end inherits year");
ok(parseDevpostRange("Jul 28 – Aug 12, 2026") === "2026-08-12T23:59:00.000Z", "devpost: en-dash tolerated");
ok(parseDevpostRange(null) === null && parseDevpostRange("") === null, "devpost: empty -> null");
ok(parseDevpostRange("sometime next spring") === null, "devpost: unparseable -> null, not Invalid Date");
// End-of-day matters: a deadline today must still be 'due soon', not already past.
const todayEnd = parseDevpostRange(
  new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
);
ok(deadlineDueSoon({ deadline: todayEnd }), "devpost: a deadline dated today is still live");

// MLH: payload lives in the Inertia script's TEXT, while its data-page attribute is
// just the page name ("app") — reading the attribute instead was silently empty.
const mlhFixture = `<script data-page="app" type="application/json">${JSON.stringify({
  component: "EventsListing",
  props: {
    upcomingEvents: [{ id: "a", slug: "pec-hacks", name: "PEC HACKS", startsAt: "2026-08-29T10:30:00Z" }],
    pastEvents: [{ id: "z", slug: "old", name: "Old Hack" }],
  },
})}</script>`;
const mlhEvents = parseSeasonHtml(mlhFixture);
ok(mlhEvents.length === 1 && mlhEvents[0].name === "PEC HACKS", "mlh: reads upcomingEvents from inertia payload");
ok(!mlhEvents.some((e) => e.name === "Old Hack"), "mlh: pastEvents archive ignored");
ok(parseSeasonHtml("<html><body>redesigned again</body></html>").length === 0, "mlh: missing payload -> [] not a throw");
ok(parseSeasonHtml('<script data-page="app">{broken</script>').length === 0, "mlh: malformed JSON -> [] not a throw");

// DuckDuckGo markup parsing — the bit that rots silently when DDG changes its HTML.
// Both href shapes: POST gives a direct URL, GET wraps it in /l/?uddg=<encoded>.
const ddgFixture = `
<div class="result results_links">
  <a class="result__a" href="https://epoch.sarvam.ai/">Sarvam Epoch 2026</a>
  <a class="result__snippet">Two days of AI in Bengaluru.</a>
</div>
<div class="result results_links">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fhack&amp;rut=abc">Wrapped Hack</a>
  <a class="result__snippet">Redirect-wrapped result.</a>
</div>
<div class="result"><a class="result__a" href="">no title or url</a></div>`;
const ddgHits = parseDdgHtml(ddgFixture);
ok(ddgHits.length === 2, "ddg: parses results, drops the empty one");
ok(ddgHits[0].url === "https://epoch.sarvam.ai/", "ddg: direct href kept as-is");
ok(ddgHits[1].url === "https://example.com/hack", "ddg: uddg-wrapped href unwrapped");
ok(ddgHits[0].description === "Two days of AI in Bengaluru.", "ddg: snippet captured");
ok(parseDdgHtml("<html><body>anomaly detected</body></html>").length === 0, "ddg: block page -> 0 hits");

// Article/roundup gate. Every DROP case below is a hit that actually reached the
// Telegram chat; every KEEP is a real event page from the same live runs. The
// search net is majority coverage-not-events, so this is the gate that decides
// whether the feed is usable — regressions have to fail here, offline.
const article = (title, url) => looksLikeArticle({ title, url });
ok(
  article(
    "KnowBe4 extends agent security to Anthropic's Claude with agent risk manager | TahawulTech.com",
    "https://www.tahawultech.com/home-slide/knowbe4-extends-agent-security-to-anthropics-claude-with-agent-risk-manager/"
  ),
  "search: press release dropped (verb 'extends')"
);
ok(
  article(
    "Tech Cloud Business Startup Events and Hackathons in Bangalore (April-May 2026) | Yutori",
    "https://scouts.yutori.com/x"
  ),
  "search: city roundup dropped ('events and hackathons')"
);
ok(
  article("Anthropic says AI models hacked three organisations during testing", "https://telanganatoday.com/x"),
  "search: news story dropped (verb 'says')"
);
ok(
  article("Tata Bharat YuvAI Hackathon", "https://www.tcs.com/who-we-are/newsroom/news-alert/tata-bharat-yuvai-hackathon"),
  "search: /newsroom/ path dropped even with a clean title"
);
ok(
  article("Mentoring at India's AI Hardware Buildathon", "https://www.edgeimpulse.com/blog/mentoring-at-ai-hardware-buildathon"),
  "search: /blog/ path dropped"
);
ok(article("Top 10 AI Hackathons in India", "https://x.com/a"), "search: listicle dropped");
ok(
  article("Chandigarh University hosts 24-hour National AI Hackathon", "https://www.prnewswire.com/in/news-releases/chandigarh-university"),
  "search: /news-releases/ path dropped (hyphenated plural, not just /news/)"
);
ok(
  article("Sarvam holding AI event Epoch on July 30", "https://www.indiatoday.in/technology/news/story/sarvam-2957900"),
  "search: /news/story/ path dropped"
);

ok(!article("National Road Safety Hackathon 2026", "https://coers.iitm.ac.in/event/national-road-safety-hackathon-2026/"), "search: real event page kept");
ok(!article("ZeAI Hackathon 2026", "https://www.startupgrantsindia.com/competitions/zeai-hackathon-2026"), "search: /competitions/ kept");
ok(!article("Hack the Law 2026", "https://hackthelaw-cambridge.com/hackathon-2026/"), "search: standalone event site kept");
ok(
  !article("HackIndia Appinventiv AI Hackathon 2026", "https://hackindia.org/2026/hackindia-appinventiv-ai-hackathon-2026/teams/forge"),
  "search: bare year path is an edition, not a news archive"
);
ok(!article("Kaya AI IIT India Hackathon 2026", "https://eventopia.in/event/kaya-ai-iit-india-hackathon-2026"), "search: event listing kept");
ok(!article("", ""), "search: empty hit doesn't throw");

// "global" was pulled from indiaOrRemoteHints: it named neither a place nor a
// delivery mode, so press-release boilerplate walked a Dubai launch through the
// India gate. This is the exact blob that leaked.
const dubaiPR = normalize(
  {
    title: "KnowBe4 extends agent security to Anthropic's Claude",
    url: "https://x.com/pr",
    description: "Dubai — KnowBe4, the global leader in managing human risk, today announced AI agents",
  },
  "search"
);
ok(!isRelevant(dubaiPR), "gate: 'global leader' no longer counts as India/remote");
ok(
  isRelevant(normalize({ title: "Global AI Hackathon", url: "https://x.com/g", location: "Online" }, "search")),
  "gate: a genuinely global event still passes on 'online'"
);

// Telegram message shape. Broken markup here doesn't fail a run — Telegram just
// rejects the send (400) or renders tags as literal text — so assert it offline.
const msgEvent = {
  ...normalize(
    {
      title: "GenAI <Buildathon> & Demo",
      url: "https://hhgoa.devfolio.co/?a=1",
      deadline: inFuture(72),
      location: "Bengaluru, India",
      posted: new Date().toISOString(),
    },
    "devfolio"
  ),
};
const newMsg = formatMessage(msgEvent, false);
ok(newMsg.startsWith("🔵 🆕 <b>NEW EVENT</b>"), "msg: new-event header, devfolio colour tag");
ok(newMsg.includes('<a href="https://hhgoa.devfolio.co/?a=1">'), "msg: title carries the link");
ok(newMsg.includes("GenAI &lt;Buildathon&gt; &amp; Demo"), "msg: title html-escaped");
ok(!newMsg.includes("<Buildathon>"), "msg: no raw angle brackets leak into HTML mode");
ok(newMsg.includes("📍 Bengaluru, India"), "msg: location line");
// {2,3} on the month, not {2}: ICU abbreviates September as "Sept", so pinning it to
// three letters made this fail for three days every August.
ok(/⏳ <b>[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2,3} \d{4}, \d{2}:\d{2}<\/b> · in 3 days/.test(newMsg), "msg: deadline + countdown");
ok(/🗓 Posted .+ \(today\)/.test(newMsg), "msg: posted date with relative day");
ok(newMsg.includes("🔗 devfolio · hhgoa.devfolio.co"), "msg: source + host footer");

const remindMsg = formatMessage({ ...msgEvent, deadline: inFuture(10) }, true);
ok(remindMsg.startsWith("🔵 ⏰ <b>DEADLINE SOON</b> — in 10h"), "msg: reminder header carries colour + countdown");
ok(!/<\/b> · in \d/.test(remindMsg), "msg: reminder doesn't repeat the countdown on the deadline line");

// Per-source colour tags. Telegram can't colour text for bots, so this square is the
// whole feature — if the map key stops matching the source name it silently greys out.
const colourOf = (source) => formatMessage({ ...msgEvent, source }, false).slice(0, 2).trim();
ok(colourOf("basecamp") === "🟠", "msg: basecamp -> orange");
ok(colourOf("devfolio") === "🔵", "msg: devfolio -> blue");
ok(colourOf("luma") === "🟣", "msg: luma -> purple");
ok(colourOf("luma-discover") === "🟣", "msg: luma-discover -> purple too");
ok(colourOf("mlh") === "⚪", "msg: unmapped source falls back to default");
ok(!formatMessage({ ...msgEvent, source: "mlh" }, false).includes("undefined"), "msg: no undefined leaks into the header");

// Missing/garbage fields must degrade, not produce "Invalid Date" or empty lines.
const sparse = formatMessage(normalize({ title: "Bare Event" }, "search"), false);
ok(!sparse.includes("Invalid Date"), "msg: no Invalid Date anywhere");
ok(!sparse.includes("📍") && !sparse.includes("⏳") && !sparse.includes("🗓"), "msg: absent fields drop their lines");
ok(sparse.includes("<b>Bare Event</b>") && !sparse.includes("<a href"), "msg: no url -> plain bold title");
ok(formatMessage({ ...msgEvent, deadline: "sometime in spring" }, false).includes("⏳ <b>sometime in spring</b>"), "msg: unparseable date shown raw");
ok(formatMessage({ ...msgEvent, title: "" }, false).includes("(untitled)"), "msg: empty title placeholder");

// ---------------------------------------------------------------------------
// Finished / expired events. A web-search hit carries no deadline field, so for a
// long time NOTHING could retire one — a page about a hackathon that ended in May
// still arrived as a "NEW EVENT" in August. isExpired() now reads the dates out of
// the event's own text when there's no deadline, so these are the regression tests
// for "don't tell me about things that are already over".
// ---------------------------------------------------------------------------
const YEAR = new Date().getUTCFullYear();
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

ok(iso(extractLatestDate("AI Hackathon 2019")) === "2019-12-31T23:59:59.000Z", "date: bare year -> end of that year");
ok(iso(extractLatestDate("Demo Day 12 Aug 2026")) === "2026-08-12T23:59:59.000Z", "date: '12 Aug 2026'");
ok(iso(extractLatestDate("Demo Day Aug 12, 2026")) === "2026-08-12T23:59:59.000Z", "date: 'Aug 12, 2026'");
ok(iso(extractLatestDate("Sept 5th, 2026 demo")) === "2026-09-05T23:59:59.000Z", "date: 'Sept 5th, 2026'");
ok(iso(extractLatestDate("starts 2026-08-12")) === "2026-08-12T23:59:59.000Z", "date: ISO form");
ok(iso(extractLatestDate("Epoch, August 2026")) === "2026-08-31T23:59:59.000Z", "date: month+year -> end of month");
ok(extractLatestDate("Hacker House Goa") === null, "date: no date named -> null");
// Precision tiers must not mix: a full date next to a stray year kept the event
// alive until December, four months after it finished.
ok(
  iso(extractLatestDate("Held 12 Aug 2026 · © 2026 Acme")) === "2026-08-12T23:59:59.000Z",
  "date: a full date beats a loose year in the same text"
);
// The loose month regex read "Marathon 2026" as March 2026 and expired live events.
ok(iso(extractLatestDate("AI Marathon 2026")) === "2026-12-31T23:59:59.000Z", "date: 'Marathon' is not March");
// The exact leak the user reported: a months-old tweet whose id contains "2084".
ok(
  extractLatestDate("https://x.com/SarvamAI/status/2084578727158317435") === null,
  "date: a tweet id is not the year 2084"
);
ok(extractLatestDate("") === null && extractLatestDate(null) === null, "date: empty input -> null");

const undatedSearchHit = normalize({ title: "Some AI Hackathon", url: "https://e.org/h" }, "search");
const lastYearHit = normalize({ title: `AI Hackathon ${YEAR - 1}`, url: "https://e.org/h" }, "search");
const nextYearHit = normalize({ title: `AI Hackathon ${YEAR + 1}`, url: "https://e.org/h" }, "search");
ok(isExpired(lastYearHit), "expired: last year's edition is finished, even with no deadline field");
ok(!isExpired(nextYearHit), "expired: next year's edition is not");
ok(!isExpired(undatedSearchHit), "expired: a hit naming no date at all is kept — nothing to check");
// tags is the SEARCH QUERY, which carries the current year. Reading it would stamp
// "this year" onto every hit and make the check above pass unconditionally.
const staleHitFreshQuery = normalize(
  { title: `AI Hackathon ${YEAR - 1}`, url: "https://e.org/h", tags: `AI hackathon India ${YEAR} apply` },
  "search"
);
ok(isExpired(staleHitFreshQuery), "expired: the query's own year doesn't rescue a stale hit");
// A real deadline always wins over prose: a page can name last year and still be live.
ok(
  !isExpired({ deadline: inFuture(48), dateText: `Since ${YEAR - 2}, the AI Hackathon` }),
  "expired: a live deadline outranks an old year in the text"
);

// Coverage of a FINISHED event — the other half of "don't alert me weeks later".
ok(looksLikeArticle({ title: "AI Hackathon 2026 Recap", url: "https://e.org/x" }), "search: recap dropped");
ok(looksLikeArticle({ title: "Winners announced for GenAI Buildathon", url: "https://e.org/x" }), "search: winners write-up dropped");
ok(looksLikeArticle({ title: "Sarvam Epoch concludes in Bengaluru", url: "https://e.org/x" }), "search: 'concludes' dropped");
ok(looksLikeArticle({ title: "How we built our hackathon project", url: "https://e.org/x" }), "search: personal write-up dropped");
ok(looksLikeArticle({ title: "AI Buildathon kicks off today", url: "https://e.org/x" }), "search: 'kicks off' coverage dropped");
ok(
  looksLikeArticle({ title: "GenAI Hackathon", url: "https://e.org/x", description: "Registrations are now closed." }),
  "search: closed window caught in the snippet, not just the title"
);
// …without eating live event pages that merely mention prizes or winners.
ok(!looksLikeArticle({ title: "AI Hackathon 2026 — ₹5L prizes for winners", url: "https://e.org/x" }), "search: a prize line is not a recap");
ok(!looksLikeArticle({ title: "Hacker House Goa 2026", url: "https://hhgoa.devfolio.co" }), "search: real event page still kept");

// Host denylisting. This must match the HOSTNAME: a substring check on the whole
// URL turns a short entry like "x.com" into a blackhole for phoenix.com/matrix.com.
ok(denied("https://x.com/SarvamAI/status/2084578727158317435"), "deny: x.com (the reported leak)");
ok(denied("https://twitter.com/SarvamAI/status/1"), "deny: twitter.com");
ok(denied("https://dev.to/someone/my-hackathon-writeup"), "deny: dev.to");
ok(denied("https://incorpx.io/events/ai"), "deny: incorpx.io");
ok(denied("https://www.linkedin.com/posts/x"), "deny: www. prefix ignored");
ok(denied("https://blog.medium.com/x"), "deny: subdomain of a denied host");
ok(!denied("https://phoenix.com/hackathon"), "deny: 'x.com' must not swallow phoenix.com");
ok(!denied("https://matrix.com/hack"), "deny: nor matrix.com");
ok(!denied("https://hhgoa.devfolio.co"), "deny: a real event host passes");
// Path-scoped entries deny part of a site, not the whole thing.
ok(denied("https://devpost.com/c/ai"), "deny: path-scoped entry (devpost.com/c/)");
ok(!denied("https://devpost.com/software/thing"), "deny: rest of that host still allowed");
ok(denied("not a url"), "deny: unparseable url rejected, nothing to link to anyway");

// Bootcamps / fashion, per config.exclude. Plurals need their own entry because the
// keyword match is whole-word.
const excluded = (title) => !isRelevant(normalize({ title, location: "Online" }, "search"));
ok(excluded("AI bootcamp for beginners"), "exclude: bootcamp");
ok(excluded("Generative AI bootcamps in Bengaluru"), "exclude: bootcamps (plural)");
ok(excluded("AI boot camp Mumbai"), "exclude: 'boot camp' spelled apart");
ok(excluded("AI in fashion hackathon"), "exclude: fashion");
ok(excluded("Fashion Week tech showcase Mumbai"), "exclude: fashion week");
ok(isRelevant(normalize({ title: "AI Hackathon", location: "Online" }, "search")), "exclude: a plain AI hackathon still passes");

// Search queries follow the calendar. Hard-coding "2026" meant that come January the
// radar kept asking for last year's events — and then alerted on what it found.
ok(expandQuery("AI hackathon India {year} apply") === `AI hackathon India ${YEAR} apply`, "query: {year} expands");
ok(expandQuery("hackathon {nextYear}") === `hackathon ${YEAR + 1}`, "query: {nextYear} expands");
ok(expandQuery("plain query") === "plain query", "query: no placeholder -> unchanged");

// Telegram targets: one env var, several chats, so a group gets the same feed.
ok(parseTargets("123").length === 1, "targets: single id");
ok(parseTargets("123, -1001234567890")[1].chatId === "-1001234567890", "targets: comma-separated group id");
ok(parseTargets("123 -1001234567890").length === 2, "targets: space-separated too");
ok(parseTargets("-1001234567890:42")[0].topicId === 42, "targets: forum topic split off");
ok(parseTargets("-1001234567890:42")[0].chatId === "-1001234567890", "targets: the minus stays with the chat id");
ok(parseTargets("-1001234567890")[0].topicId === null, "targets: no topic -> null, not NaN");
ok(parseTargets("@mychannel")[0].chatId === "@mychannel", "targets: @username kept whole");
ok(parseTargets("").length === 0 && parseTargets(undefined).length === 0, "targets: unset -> empty, stays dry");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);