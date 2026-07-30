import { normalize } from "../filter.js";

// Devfolio = India's main hackathon host (Hacker House Goa, most Indian hackathons).
// Its own list page calls a public, unauthenticated search endpoint — no key needed:
//   POST https://api.devfolio.co/api/search/hackathons  { type, from, size }
// Response is Elasticsearch-shaped: { hits: { total: { value }, hits: [{ _source }] } }.
// Precurated: everything here is a hackathon, so it skips the keyword gate
// (still honors India/remote + exclude), so "Hacker House Goa" gets through.

const ENDPOINT = "https://api.devfolio.co/api/search/hackathons";
// The two buckets the site itself exposes; together they cover every live hackathon.
// Other type values return an error payload with no hits, which we treat as empty.
const TYPES = ["application_open", "upcoming"];
const PAGE = 100;
const MAX = 400; // safety stop; the open list is ~20-40 in practice

export function toIso(v) {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function fetchPage(type, from) {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      // The endpoint is public but browser-shaped; keep these so it isn't treated as a bot.
      origin: "https://devfolio.co",
      referer: "https://devfolio.co/",
      "user-agent": "Mozilla/5.0 (compatible; event-radar)",
    },
    body: JSON.stringify({ type, from, size: PAGE }),
  });
  if (!r.ok) {
    console.error("devfolio fail:", type, r.status);
    return { hits: [], total: 0 };
  }
  const d = await r.json();
  return { hits: d?.hits?.hits || [], total: d?.hits?.total?.value || 0 };
}

export async function fetchDevfolio() {
  const sources = [];
  for (const type of TYPES) {
    try {
      let from = 0;
      for (;;) {
        const { hits, total } = await fetchPage(type, from);
        sources.push(...hits.map((h) => h._source || {}));
        from += PAGE;
        if (hits.length < PAGE || from >= Math.min(total, MAX)) break;
      }
    } catch (e) {
      console.error("devfolio fail:", type, e.message);
    }
  }

  const now = Date.now();
  const seenUuid = new Set();
  const out = [];
  for (const s of sources) {
    if (s.private) continue;
    if (s.uuid && seenUuid.has(s.uuid)) continue; // same event can sit in both buckets
    if (s.uuid) seenUuid.add(s.uuid);

    const ends = toIso(s.ends_at);
    if (ends && Date.parse(ends) < now) continue; // drop finished ones

    const setting = s.hackathon_setting || {};
    const slug = s.slug || setting.subdomain || "";
    // reg_ends_at is the actionable date (last day to apply); fall back to event start.
    const deadline = toIso(setting.reg_ends_at) || toIso(s.starts_at) || ends;
    const themes = (s.themes || []).map((t) => t?.name || t).filter(Boolean).join(" ");

    out.push(
      normalize(
        {
          title: s.name,
          url: slug ? `https://${slug}.devfolio.co` : "",
          deadline,
          location: s.is_online ? "Online" : s.location || s.city || "India",
          description: [s.tagline, s.desc].filter(Boolean).join(" — "),
          tags: `hackathon devfolio ${themes}`,
        },
        "devfolio",
        { precurated: true }
      )
    );
  }
  return out;
}
