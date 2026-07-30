import { config } from "../../config.js";
import { normalize } from "../filter.js";

// Luma's public, unauthenticated discovery API. Catches one-off events that live
// on Luma but aren't in any calendar you've subscribed to — hacker houses,
// makeathons, demo days, satellite events (e.g. Hacker House Goa, Sarvam Epoch).
// Host is api.luma.com (NOT api.lu.ma). Category slug REQUIRES lat/lng.
const BASE = "https://api.luma.com/discover/get-paginated-events";
const MAX_PAGES = 3; // per city+category, bounds runtime

async function sweep(slug, city) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const u = new URL(BASE);
    u.searchParams.set("slug", slug);
    u.searchParams.set("pagination_limit", "20");
    u.searchParams.set("latitude", String(city.lat));
    u.searchParams.set("longitude", String(city.lng));
    if (cursor) u.searchParams.set("pagination_cursor", cursor);

    let data;
    try {
      const r = await fetch(u, { headers: { accept: "application/json" } });
      if (!r.ok) break;
      data = await r.json();
    } catch (e) {
      console.error(`luma-discover fail ${slug}/${city.name}:`, e.message);
      break;
    }

    for (const entry of data.entries || []) {
      const ev = entry.event || {};
      const ti = entry.ticket_info || {};
      const slots = ti.is_sold_out
        ? "SOLD OUT"
        : ti.spots_remaining != null
        ? `${ti.spots_remaining} spots left`
        : "";
      const place =
        ev.location_type === "online"
          ? "Online"
          : entry.geo_address_info?.city_state || city.name;

      out.push(
        normalize(
          {
            title: ev.name,
            url: ev.url ? `https://luma.com/${ev.url}` : "",
            deadline: ev.start_at || null, // event start; drives the 48h reminder
            location: [place, slots].filter(Boolean).join(" · "),
            description: (entry.calendar?.name || "") + " " + (entry.hosts || []).map((h) => h.name).join(" "),
            tags: slug,
          },
          "luma-discover",
          { precurated: true }
        )
      );
    }

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return out;
}

export async function fetchLumaDiscover() {
  const { cities = [], categories = [] } = config.lumaDiscover || {};
  const jobs = [];
  for (const city of cities) for (const cat of categories) jobs.push(sweep(cat, city));
  const results = await Promise.allSettled(jobs);
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
