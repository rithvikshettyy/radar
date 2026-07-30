import { normalize } from "../filter.js";

// Devpost exposes a JSON listing. Shape can change — parsing is defensive.
// challenge_type[]=online etc. We just pull AI-tagged + open ones and filter later.
const URLS = [
  "https://devpost.com/api/hackathons?challenge_type[]=online&status[]=open&order_by=recently-added",
  "https://devpost.com/api/hackathons?search=ai&order_by=recently-added",
];

export async function fetchDevpost() {
  const out = [];
  for (const u of URLS) {
    try {
      const r = await fetch(u, { headers: { accept: "application/json" } });
      if (!r.ok) continue;
      const data = await r.json();
      const list = data.hackathons || data.results || [];
      for (const h of list) {
        out.push(
          normalize(
            {
              title: h.title,
              url: h.url,
              deadline: h.submission_period_dates_end || h.submission_period_dates || null,
              location: h.displayed_location?.location || (h.open_state === "open" ? "online" : ""),
              description: (h.themes || []).map((t) => t.name).join(" "),
              tags: (h.themes || []).map((t) => t.name).join(" "),
            },
            "devpost"
          )
        );
      }
    } catch (e) {
      console.error("devpost fail:", e.message);
    }
  }
  return out;
}
