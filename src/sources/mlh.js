import * as cheerio from "cheerio";
import { normalize } from "../filter.js";

// MLH season schedule. The old scrape (.event / .event-name / .event-location)
// broke twice over, silently returning zero:
//   1. mlh.io moved to www.mlh.com and the page was rebuilt as an Inertia.js app
//      with Tailwind classes — none of the semantic .event-* hooks exist anymore.
//   2. The season year was pinned to the current calendar year. MLH seasons run
//      mid-year, so from ~July onward the current-year page has upcomingEvents: []
//      and everything live sits under NEXT year's season.
// Inertia serialises the whole page payload as JSON in a single script tag, so we
// read that instead of scraping markup — same request, structured data.

const SEASON_URL = (year) => `https://www.mlh.com/seasons/${year}/events`;

// Fetch this season and the next; from mid-year the next one holds everything live.
function seasonYears(now = new Date()) {
  const y = now.getUTCFullYear();
  return [y, y + 1];
}

// Exported for selftest: this is the part that rots when MLH redesigns again.
export function parseSeasonHtml(html) {
  const $ = cheerio.load(html);
  // The payload is the script's TEXT; data-page is just the Inertia page name ("app").
  const raw = $('script[data-page="app"]').first().text();
  if (!raw) return [];
  let props;
  try {
    props = JSON.parse(raw)?.props || {};
  } catch {
    return [];
  }
  // pastEvents is the archive (250+ entries) — deliberately ignored.
  return Array.isArray(props.upcomingEvents) ? props.upcomingEvents : [];
}

export async function fetchMLH() {
  const raw = [];
  for (const year of seasonYears()) {
    try {
      const r = await fetch(SEASON_URL(year), {
        // A plain "event-radar" UA gets a 302 to the same page; harmless, but send
        // something browser-shaped so we don't rely on redirect-following.
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; event-radar)",
          accept: "text/html",
        },
      });
      if (!r.ok) {
        console.error("mlh fail:", year, r.status);
        continue;
      }
      raw.push(...parseSeasonHtml(await r.text()));
    } catch (e) {
      console.error("mlh fail:", year, e.message);
    }
  }

  const now = Date.now();
  const seenId = new Set();
  const out = [];
  for (const e of raw) {
    if (e.id && seenId.has(e.id)) continue; // an event can appear in both seasons
    if (e.id) seenId.add(e.id);
    if (e.endsAt && Date.parse(e.endsAt) < now) continue;

    // "digital" events carry location "Everywhere, Worldwide", which misses every
    // India/remote hint — say "Online" so they clear the gate on their own merit.
    const digital = e.formatType === "digital";
    const country = e.venueAddress?.country;
    const location = digital
      ? "Online"
      : [e.location, country === "IN" ? "India" : country].filter(Boolean).join(", ");

    out.push(
      normalize(
        {
          title: e.name,
          // e.url points at /events/<slug>/prizes; the event's own site is more useful.
          url: e.websiteUrl || (e.slug ? `https://www.mlh.com/events/${e.slug}` : ""),
          deadline: e.startsAt || null,
          location,
          description: [e.dateRange, e.region].filter(Boolean).join(" · "),
          tags: `mlh hackathon ${e.region || ""}`,
        },
        "mlh"
      )
    );
  }
  return out;
}
