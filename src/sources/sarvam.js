import { normalize } from "../filter.js";

// Sarvam AI events (Sarvam Epoch, webinars, hackathons). sarvam.ai/events is an
// Astro island whose HTML is a pain to parse, but the site is Sanity-backed and
// the dataset is world-readable, so we query the CDN API directly — no key:
//   GET https://<projectId>.apicdn.sanity.io/v<date>/data/query/<dataset>?query=<groq>
// projectId/dataset are public values, lifted from the asset URLs on the site.
//
// Precurated: everything Sarvam posts is India + AI, so it skips the keyword gate
// (a "Sarvam Epoch" with no literal AI word in the title still gets through).

const PROJECT = "03117ysv";
const DATASET = "production";
const API_VERSION = "v2024-01-01";
// apicdn is the cached edge host — same data, and the one meant for read traffic.
const ENDPOINT = `https://${PROJECT}.apicdn.sanity.io/${API_VERSION}/data/query/${DATASET}`;

const GROQ = `*[_type=="event"]{title,"slug":slug.current,startAt,format,eventType,location,description,category,_createdAt}|order(startAt desc)[0...50]`;

// Events with no startAt can't be date-checked, so fall back to how recently the
// doc was published — old undated entries are archive, not something to alert on.
const UNDATED_MAX_AGE_DAYS = 60;

export async function fetchSarvam() {
  let docs = [];
  try {
    const u = new URL(ENDPOINT);
    u.searchParams.set("query", GROQ);
    const r = await fetch(u, {
      headers: { accept: "application/json", "user-agent": "event-radar" },
    });
    if (!r.ok) {
      console.error("sarvam fail:", r.status);
      return [];
    }
    docs = (await r.json())?.result || [];
  } catch (e) {
    console.error("sarvam fail:", e.message);
    return [];
  }

  const now = Date.now();
  const out = [];
  for (const d of docs) {
    if (d.startAt) {
      if (Date.parse(d.startAt) < now) continue; // already happened
    } else {
      const age = (now - Date.parse(d._createdAt || 0)) / 8.64e7;
      if (!(age >= 0) || age > UNDATED_MAX_AGE_DAYS) continue;
    }

    const online = String(d.format || "").toLowerCase() === "online";
    out.push(
      normalize(
        {
          title: d.title,
          url: d.slug ? `https://www.sarvam.ai/events/${d.slug}` : "https://www.sarvam.ai/events",
          deadline: d.startAt || null,
          posted: d._createdAt || null, // real publish date from the CMS
          // Sarvam is Bengaluru-based; an offline event with no venue set is still India.
          location: online ? "Online" : d.location || "Bengaluru, India",
          description: d.description || "",
          tags: `sarvam ${d.eventType || ""} ${d.category || ""}`,
        },
        "sarvam",
        { precurated: true }
      )
    );
  }
  return out;
}
