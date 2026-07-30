import * as cheerio from "cheerio";
import { config } from "../../config.js";
import { normalize } from "../filter.js";

// Optional net for events that live NOWHERE structured — announced only on a
// standalone site, LinkedIn, or X (e.g. a Sarvam Epoch main-conference page).
// Two providers, picked by config.webSearch.provider (default "auto"):
//   brave — used when BRAVE_API_KEY is set. Clean JSON, 2k queries/mo free.
//   ddg   — html.duckduckgo.com scrape. No key, no signup. Brittle BY DESIGN:
//           unofficial endpoint, markup can change, and DDG rate-limits shared
//           CI egress IPs — a GitHub Actions run may legitimately return zero.
//           Best-effort only; it logs and yields [] rather than failing a run.
// Not precurated -> the keyword + India/remote gate still applies (search is noisy).

const BRAVE_KEY = process.env.BRAVE_API_KEY;
const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DDG_ENDPOINT = "https://html.duckduckgo.com/html/";

// Brave free tier is 1 query/sec. DDG has no published limit and blocks harder,
// so give it more room — queries run back-to-back otherwise.
const BRAVE_GAP_MS = 1100;
const DDG_GAP_MS = 2500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Aggregator/listicle hosts: they rank well for these queries but are never a
// single event you can apply to, so they'd be permanent noise in the feed.
const DENY_HOSTS = [
  "reskilll.com", "internshala.com", "youtube.com", "reddit.com", "quora.com",
  "medium.com", "linkedin.com/pulse", "pinterest.com", "facebook.com",
  "hackathons.hackclub.com", "eventbrite.com/d",
];

function denied(url) {
  const u = url.toLowerCase();
  return DENY_HOSTS.some((h) => u.includes(h));
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
  if (want === "ddg") return "ddg";
  return BRAVE_KEY ? "brave" : "ddg"; // auto
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

export async function fetchWebSearch() {
  const provider = pickProvider();
  if (!provider) return [];

  const run = provider === "brave" ? braveQuery : ddgQuery;
  const gap = provider === "brave" ? BRAVE_GAP_MS : DDG_GAP_MS;
  const queries = config.searchQueries || [];

  const out = [];
  const seenUrl = new Set();
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
      out.push(
        normalize(
          { title: h.title, url: h.url, description: h.description, tags: q },
          "search"
        )
      );
    }
  }
  console.log(`websearch(${provider}): ${out.length} raw hits from ${queries.length} queries`);
  return out;
}
