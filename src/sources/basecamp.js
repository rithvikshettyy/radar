import { normalize } from "../filter.js";

// Basecamp (basecampblr.com) — Bengaluru's founder/builder week. The site is a
// Next.js front end over a world-readable Sanity dataset, so we query the CDN API
// directly instead of parsing the 1.9 MB page:
//   GET https://<projectId>.apicdn.sanity.io/v<date>/data/query/<dataset>?query=<groq>
// projectId/dataset are public values, lifted from the cdn.sanity.io asset URLs on
// the page (same trick as sarvam.js).
//
// One week, ~90 sessions, four categories: Build, Learn, Recharge, Mingle. Only
// `Build` is precurated — those are the workshops/hackathon-shaped sessions, and
// they'd otherwise be dropped for having no literal AI word ("Glimpses of
// Singularity"). Recharge/Mingle is a cricket match and a café, so the rest faces
// the normal keyword gate and mostly falls out. That's deliberate: the alternative
// is one week dumping 88 alerts into the chat.

const PROJECT = "jz8sb9f8";
const DATASET = "production";
const API_VERSION = "v2024-01-01";
// apicdn is the cached edge host — same data, and the one meant for read traffic.
const ENDPOINT = `https://${PROJECT}.apicdn.sanity.io/${API_VERSION}/data/query/${DATASET}`;

// categories are references; [] -> derefs them to their titles.
const GROQ =
  `*[_type=="event" && defined(date)]{` +
  `title,"slug":slug.current,date,endDate,registrationUrl,venue,venueCity,_createdAt,` +
  `"categories":categories[]->title` +
  `}|order(date asc)[0...200]`;

// Venue is filled with placeholder text until a week or so out; don't print that as
// if it were an address.
const PLACEHOLDER_VENUE = /^(tba|tbd|tbc|to be announced|coming soon)$/i;

function place(ev) {
  const venue = (ev.venue || "").trim();
  // Basecamp is a Bengaluru-only week; a missing city is still Bengaluru, and the
  // city is what the India/remote gate actually reads.
  const city = (ev.venueCity || "").trim() || "Bengaluru";
  if (!venue || PLACEHOLDER_VENUE.test(venue)) return city;
  return `${venue}, ${city}`;
}

export async function fetchBasecamp() {
  let docs = [];
  try {
    const u = new URL(ENDPOINT);
    u.searchParams.set("query", GROQ);
    const r = await fetch(u, {
      headers: { accept: "application/json", "user-agent": "event-radar" },
    });
    if (!r.ok) {
      console.error("basecamp fail:", r.status);
      return [];
    }
    docs = (await r.json())?.result || [];
  } catch (e) {
    console.error("basecamp fail:", e.message);
    return [];
  }

  const now = Date.now();
  const out = [];
  for (const d of docs) {
    const start = Date.parse(d.date);
    const end = d.endDate ? Date.parse(d.endDate) : NaN;
    if (Number.isNaN(start)) continue;
    // Over once the session ends (or once it started, when no end is set).
    if (!Number.isNaN(end) ? end < now : start < now) continue;

    const cats = (d.categories || []).filter(Boolean);
    // No registration-close field, so the start is the actionable date. A session
    // already running falls back to its end so the 48h reminder still means something.
    const deadline = start > now ? new Date(start).toISOString() : new Date(end).toISOString();

    out.push(
      normalize(
        {
          title: d.title,
          // registrationUrl is where you actually sign up (luma, devfolio, …);
          // the site page is the fallback when a session hasn't got one yet.
          url: d.registrationUrl || (d.slug ? `https://www.basecampblr.com/${d.slug}` : "https://www.basecampblr.com"),
          deadline,
          posted: d._createdAt || null, // real publish date from the CMS
          location: place(d),
          description: cats.join(" · "),
          tags: `basecamp basecampblr bengaluru ${cats.join(" ")}`,
        },
        "basecamp",
        { precurated: cats.some((c) => String(c).toLowerCase() === "build") }
      )
    );
  }
  return out;
}
