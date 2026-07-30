// Offline sanity test: no network, no secrets. Validates filter + dedupe + reminder logic.
import { normalize, idFor, isRelevant, deadlineDueSoon } from "./filter.js";
import { toIso } from "./sources/devfolio.js";
import { parseDdgHtml } from "./sources/websearch.js";
import { parseDevpostRange } from "./sources/devpost.js";
import { parseSeasonHtml } from "./sources/mlh.js";

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

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);