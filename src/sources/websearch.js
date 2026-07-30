import { config } from "../../config.js";
import { normalize } from "../filter.js";

// Optional net for events that live NOWHERE structured — announced only on a
// standalone site, LinkedIn, or X (e.g. a Sarvam Epoch main-conference page).
// Uses Brave Search API free tier. Disabled unless BRAVE_API_KEY is set.
// Not precurated -> the keyword + India/remote gate still applies (search is noisy).
const KEY = process.env.BRAVE_API_KEY;
const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

// Brave's free tier allows 1 query/sec; queries below run back-to-back, so space them.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchWebSearch() {
  if (!KEY) return []; // opt-in
  const out = [];
  let first = true;
  for (const q of config.searchQueries || []) {
    if (!first) await sleep(1100);
    first = false;
    try {
      const u = new URL(ENDPOINT);
      u.searchParams.set("q", q);
      u.searchParams.set("count", "15");
      u.searchParams.set("freshness", "pm"); // past month
      const r = await fetch(u, {
        headers: { accept: "application/json", "X-Subscription-Token": KEY },
      });
      if (!r.ok) {
        console.error("brave fail:", r.status, r.status === 429 ? "(rate limited)" : "");
        continue;
      }
      const data = await r.json();
      for (const res of data.web?.results || []) {
        out.push(
          normalize(
            {
              title: res.title,
              url: res.url,
              description: res.description,
              tags: q,
            },
            "search"
          )
        );
      }
    } catch (e) {
      console.error("brave fail:", e.message);
    }
  }
  return out;
}
