import ical from "node-ical";
import { config } from "../../config.js";
import { normalize } from "../filter.js";

// Luma calendars expose an ICS feed. Best source for AI meetups/hackathons.
export async function fetchLuma() {
  const out = [];
  for (const url of config.lumaIcsUrls) {
    try {
      const data = await ical.async.fromURL(url);
      for (const k of Object.keys(data)) {
        const ev = data[k];
        if (ev.type !== "VEVENT") continue;
        out.push(
          normalize(
            {
              title: ev.summary,
              url: ev.url || ev.uid,
              deadline: ev.start ? new Date(ev.start).toISOString() : null,
              // ICS CREATED is when the organiser published it; DTSTAMP is when the
              // feed was generated (i.e. now), so it's only a last resort.
              posted: ev.created ? new Date(ev.created).toISOString() : null,
              location: ev.location || "",
              description: ev.description || "",
            },
            "luma"
          )
        );
      }
    } catch (e) {
      console.error("luma fail:", url, e.message);
    }
  }
  return out;
}
