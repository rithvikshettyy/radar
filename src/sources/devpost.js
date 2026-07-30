import { normalize } from "../filter.js";

// Devpost exposes a JSON listing. Shape can change — parsing is defensive.
// challenge_type[]=online etc. We just pull AI-tagged + open ones and filter later.
//
// Dates: there is NO machine-readable deadline field. The only date Devpost gives
// is submission_period_dates, a display string covering the whole window:
//   "Jul 27 - 31, 2026"        same month, day-only end
//   "Jul 28 - Aug 12, 2026"    end carries its own month
//   "Dec 20, 2026 - Jan 5, 2027"  end carries month + year
//   "Jul 28, 2026"             single day
// We want the END of that range, since that's the submission deadline.
const URLS = [
  "https://devpost.com/api/hackathons?challenge_type[]=online&status[]=open&order_by=recently-added",
  // status[]=open on both: without it the search query happily returns hackathons
  // whose submission window shut months ago.
  "https://devpost.com/api/hackathons?search=ai&status[]=open&order_by=recently-added",
];

const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

// "Jul 28 - Aug 12, 2026" -> ISO for Aug 12 end-of-day. Null on anything unrecognised.
export function parseDevpostRange(s) {
  if (!s || typeof s !== "string") return null;
  // Devpost uses a plain hyphen, but tolerate en/em dashes.
  const parts = s.split(/\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;

  const first = parts[0];
  let end = parts[parts.length - 1];

  // A day-only end ("31, 2026") inherits the month from the start of the range.
  if (!MONTH.test(end)) {
    const month = (first.match(MONTH) || [])[0];
    if (!month) return null;
    end = `${month} ${end}`;
  }
  // A year-less end inherits the year from the start ("Jul 28, 2026 - Aug 12").
  if (!/\d{4}/.test(end)) {
    const year = (first.match(/\d{4}/) || [])[0];
    if (!year) return null;
    end = `${end}, ${year}`;
  }

  // End-of-day: a deadline dated "Aug 12" is live all of Aug 12, so midnight would
  // both expire it a day early and misfire the 48h reminder.
  const t = Date.parse(`${end} 23:59:00 UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

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
              deadline: parseDevpostRange(h.submission_period_dates),
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
