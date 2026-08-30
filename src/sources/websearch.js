import * as cheerio from "cheerio";
import { config } from "../../config.js";
import { normalize } from "../filter.js";

// Optional net for events that live NOWHERE structured — announced only on a
// standalone site, LinkedIn, or X (e.g. a Sarvam Epoch main-conference page).
// Three providers, picked by config.webSearch.provider (default "auto"):
//   brave     — used when BRAVE_API_KEY is set. Clean JSON, 2k queries/mo free.
//   firecrawl — api.firecrawl.dev/v2/search. JSON, and it answers WITHOUT a key,
//               which is what makes it the useful default: it works from an Actions
//               runner where the DDG scrape just gets a block page. FIRECRAWL_API_KEY
//               is used if present, but the free tier bills search at 2 credits per
//               10 results (1k credits/mo = ~500 searches), which an hourly cron
//               burns through in days — so keyless is the better setting here.
//               Firecrawl documents the keyless tier for its own MCP/CLI/SDK
//               clients; a plain fetch works today but is outside that contract,
//               so treat it as best-effort and keep ddg behind it.
//   ddg       — html.duckduckgo.com scrape. No key, no signup. Brittle BY DESIGN:
//               unofficial endpoint, markup can change, and DDG rate-limits shared
//               CI egress IPs — a GitHub Actions run may legitimately return zero.
// All three log and yield [] rather than failing a run.
// Not precurated -> the keyword + India/remote gate still applies (search is noisy).

const BRAVE_KEY = process.env.BRAVE_API_KEY;
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;
const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/search";
const DDG_ENDPOINT = "https://html.duckduckgo.com/html/";

// Brave free tier is 1 query/sec. DDG has no published limit and blocks harder,
// so give it more room — queries run back-to-back otherwise. Firecrawl takes
// 3-8s to answer on its own, so a small gap is enough.
const BRAVE_GAP_MS = 1100;
const FIRECRAWL_GAP_MS = 1000;
const DDG_GAP_MS = 2500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Aggregator/listicle hosts: they rank well for these queries but are never a
// single event you can apply to, so they'd be permanent noise in the feed.
const DENY_HOSTS = [
  "reskilll.com", "internshala.com", "youtube.com", "reddit.com", "quora.com",
  "medium.com", "linkedin.com", "pinterest.com", "facebook.com",
  "hackathons.hackclub.com", "eventbrite.com/d",
  // Firecrawl's past-month filter surfaces a lot of these: reels and roundup
  // pages that talk about an event but give you nothing to apply to.
  "instagram.com", "tiktok.com", "unstop.com/hackathons", "devpost.com/c/",
  "lablab.ai/ai-hackathons", "techcrunch.com",
  // News/aggregator sites: report ON an event, aren't the event page, and
  // carry no deadline field, so an old article about a past event never expires.
  "finance.yahoo.com", "techgig.com", "news.google.com",
  "tahawultech.com", "telanganatoday.com", "indiatoday.in", "threads.com",
  // Press-release wires. Every page is a company announcement by definition, so
  // there is no shape rule worth writing — deny the host.
  "prnewswire.com", "businesswire.com", "globenewswire.com",
  // AI-written "events in <city> this month" roundups — a page of links, never
  // one thing you can register for.
  "scouts.yutori.com", "preetbeacon.com",
];

// Built-in list plus whatever config.denyHosts adds, so tuning the feed never means
// editing a source file.
const ALL_DENY = [...DENY_HOSTS, ...(config.denyHosts || [])].map((s) =>
  String(s).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "")
);

// Match on the parsed HOSTNAME, not a substring of the whole URL. Substring
// matching is quietly wrong the moment a short entry is added: "x.com" appears
// inside phoenix.com, matrix.com and devpost.com/x.com-anything, so the naive
// check would blackhole unrelated hosts. An entry may carry a path prefix
// ("eventbrite.com/d") to deny only part of a site.
// Exported for selftest: getting this wrong either floods the feed or silently
// blackholes good hosts, and neither shows up until it's already happened.
export function denied(url) {
  let host, path;
  try {
    const u = new URL(url);
    host = u.host.toLowerCase().replace(/^www\./, "");
    path = u.pathname.toLowerCase();
  } catch {
    return true; // not a usable link, so nothing to alert on either way
  }
  return ALL_DENY.some((entry) => {
    const slash = entry.indexOf("/");
    const h = slash === -1 ? entry : entry.slice(0, slash);
    const p = slash === -1 ? "" : entry.slice(slash);
    if (host !== h && !host.endsWith(`.${h}`)) return false;
    return !p || path.startsWith(p);
  });
}

// A hit can be on a perfectly good host and still be COVERAGE of an event rather
// than the event: a press release, a news story, a "top 10 hackathons" roundup.
// Those are the worst kind of noise here because they carry no deadline, so
// isExpired() can never retire them — they sit in seen.json forever and any URL
// variation re-alerts them. Host denylisting alone is whack-a-mole (every run
// surfaces a new outlet), so match on shape instead. Two independent signals:

// 1. URL path segments that only ever carry editorial content. Dated archive paths
//    (/2026/08/) are here too; a bare year segment (hackindia.org/2026/) is not,
//    since real event sites organize by edition year.
const ARTICLE_PATH =
  /\/(news|news-alerts?|news-releases?|newsroom|press|press-releases?|pressroom|blog|blogs|story|stories|article|articles|insights|opinion|editorial|column|20\d\d\/\d{2})\//i;

// 2. Headline shape. Press-release verbs — the subject is a company doing a thing,
//    not an event you enter.
const ARTICLE_TITLE =
  /\b(launches|launched|announces|announced|unveils|unveiled|extends|extended|acquires|acquired|raises|raised|appoints|appointed|partners with|says|said|reveals|revealed|reports|explained|hits back|responds)\b/i;

// 3. Roundup/listicle framing — a page of links to other events.
const ROUNDUP_TITLE =
  /\b(top \d+|best \d+|\d+ best|list of|round-?up|guide to|complete guide|everything you need|events and hackathons|hackathons in [a-z]|upcoming (events|hackathons)|events in [a-z]+ \(?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i;

// 4. Write-ups ABOUT an event that already happened. These are why an alert can
//    arrive weeks after the thing ended: a recap carries no deadline, so nothing
//    downstream can retire it. Past tense in the headline is the tell.
//    Deliberately NOT here: a bare "winners" / "prizes", which live on plenty of
//    live event pages ("₹5L prize pool"). Only "winners announced" is past tense.
const RECAP_TITLE =
  /\b(recap|highlights|takeaways|key learnings|lessons from|winners announced|what happened at|my experience|we built|how we built|wrap-?up|post-?mortem|retrospective|concludes?|concluded|wraps? up|wrapped up|kicks? off|kicked off|was held|took place|successfully (held|hosted|completed|concluded))\b/i;

// 5. The window is shut. Worth its own rule because these pages are otherwise
//    perfect event pages — right host, right shape, just no longer enterable.
const CLOSED_TITLE =
  /\b((applications?|registrations?|submissions?|entries) (are )?(now )?closed|closed for (applications?|registrations?|entries)|deadline (has )?(passed|expired)|sold out|event (has )?ended|no longer accepting)\b/i;

// Exported for selftest — this is the gate that decides what reaches your chat,
// and it's tuned against real leaked hits, so regressions must be visible offline.
// Reads the snippet too for the past/closed rules: a page titled plainly
// ("Sarvam Epoch") still gives itself away in the description ("winners announced").
export function looksLikeArticle(hit) {
  const title = hit.title || "";
  const body = `${title} ${hit.description || ""}`;
  if (ARTICLE_PATH.test(hit.url || "")) return true;
  if (ARTICLE_TITLE.test(title)) return true;
  if (ROUNDUP_TITLE.test(title)) return true;
  if (RECAP_TITLE.test(title)) return true;
  if (CLOSED_TITLE.test(body)) return true;
  return false;
}

function pickProvider() {
  const want = config.webSearch?.provider || "auto";
  if (want === "off") return null;
  if (want === "brave") {
    if (!BRAVE_KEY) {
      console.error("websearch: provider=brave but BRAVE_API_KEY unset — skipping");
      return null;
    }
    return "brave";
  }
  if (want === "firecrawl" || want === "ddg") return want;
  // auto: a Brave key means someone deliberately paid attention to this, so honor it;
  // otherwise Firecrawl, which needs no key and unlike ddg actually answers from CI.
  return BRAVE_KEY ? "brave" : "firecrawl";
}

async function braveQuery(q) {
  const u = new URL(BRAVE_ENDPOINT);
  u.searchParams.set("q", q);
  u.searchParams.set("count", "15");
  u.searchParams.set("freshness", "pm"); // past month
  const r = await fetch(u, {
    headers: { accept: "application/json", "X-Subscription-Token": BRAVE_KEY },
  });
  if (!r.ok) {
    console.error("brave fail:", r.status, r.status === 429 ? "(rate limited)" : "");
    return { hits: [], blocked: r.status === 429 };
  }
  const data = await r.json();
  const hits = (data.web?.results || []).map((res) => ({
    title: res.title,
    url: res.url,
    description: res.description,
  }));
  return { hits, blocked: false };
}

async function firecrawlQuery(q) {
  const r = await fetch(FIRECRAWL_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      // Optional: raises the rate limit. Without it the keyless tier answers anyway.
      ...(FIRECRAWL_KEY ? { authorization: `Bearer ${FIRECRAWL_KEY}` } : {}),
    },
    // tbs=qdr:m is the past-month window, matching Brave's freshness=pm — an event
    // page that hasn't been touched in a year is not one you can still enter.
    body: JSON.stringify({ query: q, limit: 10, tbs: "qdr:m", location: "India" }),
  });
  if (!r.ok) {
    // 401/403 = the keyless tier is refusing us, which no amount of retrying fixes;
    // treat it like a rate limit so the sweep stops instead of burning every query
    // on the same rejection. Set FIRECRAWL_API_KEY, or config.webSearch.provider.
    const why =
      r.status === 429 ? "(rate limited)" :
      r.status === 401 || r.status === 403 ? "(keyless access refused — set FIRECRAWL_API_KEY or BRAVE_API_KEY)" :
      "";
    console.error("firecrawl fail:", r.status, why);
    return { hits: [], blocked: [429, 402, 401, 403].includes(r.status) };
  }
  const data = await r.json();
  if (!data?.success) {
    console.error("firecrawl fail:", data?.error || "unsuccessful response");
    return { hits: [], blocked: false };
  }
  const hits = (data.data?.web || [])
    .filter((res) => res?.url)
    .map((res) => ({ title: res.title, url: res.url, description: res.description }));
  return { hits, blocked: false };
}

// DDG wraps some hrefs as /l/?uddg=<encoded target>. Unwrap to the real URL.
function unwrapDdg(href) {
  if (!href) return "";
  const abs = href.startsWith("//") ? `https:${href}` : href;
  try {
    const u = new URL(abs, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    return target || abs;
  } catch {
    return abs;
  }
}

// Split out from the fetch so selftest.js can exercise the markup parsing offline —
// this is the part that silently rots when DDG changes its HTML.
export function parseDdgHtml(html) {
  const $ = cheerio.load(html);
  const hits = [];
  $(".result").each((_, el) => {
    const a = $(el).find("a.result__a").first();
    const url = unwrapDdg(a.attr("href"));
    const title = a.text().trim();
    if (!title || !url) return;
    hits.push({ title, url, description: $(el).find(".result__snippet").text().trim() });
  });
  return hits;
}

async function ddgQuery(q) {
  // POST returns direct hrefs; GET returns redirect wrappers. Both handled.
  const r = await fetch(DDG_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // A browser UA is required — the default fetch UA gets a bot page.
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
    body: new URLSearchParams({ q, kl: "in-en" }).toString(),
  });
  if (!r.ok) {
    console.error("ddg fail:", r.status, r.status === 429 ? "(rate limited)" : "");
    return { hits: [], blocked: r.status === 429 || r.status === 403 };
  }
  const html = await r.text();
  const hits = parseDdgHtml(html);
  // Zero results on a query that should have some = we were served the block page.
  const blocked = hits.length === 0 && /anomaly|unusual traffic|captcha/i.test(html);
  if (blocked) console.error("ddg fail: blocked (anomaly page) — likely shared CI IP");
  return { hits, blocked };
}

// Queries carry {year}/{nextYear} rather than a literal year, so the sweep follows
// the calendar instead of asking for a year that has already been and gone.
// Exported for selftest.
export function expandQuery(q, now = new Date()) {
  const y = now.getUTCFullYear();
  return String(q).replace(/\{year\}/gi, String(y)).replace(/\{nextYear\}/gi, String(y + 1));
}

export async function fetchWebSearch() {
  const provider = pickProvider();
  if (!provider) return [];

  const run = { brave: braveQuery, firecrawl: firecrawlQuery, ddg: ddgQuery }[provider];
  const gap = { brave: BRAVE_GAP_MS, firecrawl: FIRECRAWL_GAP_MS, ddg: DDG_GAP_MS }[provider];
  const queries = (config.searchQueries || []).map((q) => expandQuery(q));

  const out = [];
  const seenUrl = new Set();
  let dropped = 0;
  let first = true;
  for (const q of queries) {
    if (!first) await sleep(gap);
    first = false;
    let res;
    try {
      res = await run(q);
    } catch (e) {
      console.error(`${provider} fail:`, e.message);
      continue;
    }
    // Once throttled, more queries only dig the hole deeper — stop the sweep.
    if (res.blocked) break;
    for (const h of res.hits) {
      if (denied(h.url) || seenUrl.has(h.url)) continue;
      seenUrl.add(h.url);
      if (looksLikeArticle(h)) {
        dropped++;
        continue;
      }
      out.push(
        normalize(
          { title: h.title, url: h.url, description: h.description, tags: q },
          "search"
        )
      );
    }
  }
  console.log(
    `websearch(${provider}): ${out.length} raw hits from ${queries.length} queries` +
      ` (${dropped} dropped as article/roundup)`
  );
  return out;
}
