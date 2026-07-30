import { config } from "../../config.js";
import { normalize } from "../filter.js";

// Devfolio = India's main hackathon host (Hacker House Goa, most Indian hackathons).
// Its hackathon list is served from Algolia (public, search-only creds embedded in
// the frontend). We query Algolia directly. All three creds come from ONE request:
//   devfolio.co/hackathons/open -> DevTools -> Network -> filter "algolia"
//   -> open any request -> copy header x-algolia-application-id, x-algolia-api-key,
//      and the index name from the URL path (/indexes/<index>/...).
// Put them in config.devfolio. Skips cleanly if apiKey is blank.
// Precurated: everything here is a hackathon, so it skips the keyword gate
// (still honors India/remote + exclude), so "Hacker House Goa" gets through.

export function toIso(v) {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export async function fetchDevfolio() {
  const { appId, apiKey, indexName } = config.devfolio || {};
  if (!appId || !apiKey || !indexName) return []; // opt-in until creds filled

  const url = `https://${appId}-dsn.algolia.net/1/indexes/${indexName}/query`;
  let hits = [];
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "X-Algolia-Application-Id": appId,
        "X-Algolia-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ params: "hitsPerPage=100&query=" }),
    });
    if (!r.ok) {
      console.error("devfolio/algolia fail:", r.status, "(check config.devfolio creds)");
      return [];
    }
    hits = (await r.json()).hits || [];
  } catch (e) {
    console.error("devfolio fail:", e.message);
    return [];
  }

  const now = Date.now();
  const out = [];
  for (const h of hits) {
    const ends = toIso(h.ends_at ?? h.end_time ?? h.end);
    if (ends && Date.parse(ends) < now) continue; // drop finished ones

    const online = /online/i.test(h.hackathon_setting || h.mode || "");
    const slug = h.slug || h.subdomain || "";
    out.push(
      normalize(
        {
          title: h.name || h.title,
          url: slug ? `https://${slug}.devfolio.co` : h.url || "",
          deadline: toIso(h.starts_at ?? h.start_time ?? h.start) || ends,
          location: online ? "Online" : h.city || h.location || "India",
          description: h.desc || h.tagline || "",
          tags: "hackathon devfolio",
        },
        "devfolio",
        { precurated: true }
      )
    );
  }
  return out;
}
