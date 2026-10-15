import { normalize } from "../filter.js";

// Vybe Driven (vybedriven.in) — Mumbai-based hackathon/tech-event aggregator. There is no
// API: the listings are a static array baked into a hashed route chunk
// (/assets/opportunities-<hash>.js) that every listing page modulepreloads. The hash
// changes on each deploy, so we read it off the live HTML, then pull fields out of each
// `{slug:\`...\`,title:\`...\`,...}` object with regexes — no eval of third-party code.
//
// Type "Hackathon" is precurated; summits/meetups face the normal keyword gate.

const BASE = "https://www.vybedriven.in";
const UA = { "user-agent": "Mozilla/5.0 (compatible; event-radar)" };
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

async function get(path) {
  const r = await fetch(path.startsWith("http") ? path : BASE + path, { headers: UA });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.text();
}

// First top-level occurrence of a backtick-quoted field in one object's source.
const field = (src, name) => {
  const m = src.match(new RegExp(`(?:^|[,{])${name}:\`((?:[^\`\\\\]|\\\\.)*)\``));
  return m ? m[1].replace(/\\(.)/g, "$1").trim() : "";
};

// "Oct 23–24, 2026" / "Oct 30 – Nov 2, 2026" / "Oct 19, 2026" -> { start, end } ISO (UTC).
function parseRange(s) {
  const m = (s || "").match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:\s*[–-]\s*(?:([A-Za-z]{3})[a-z]*\.?\s+)?(\d{1,2}))?,?\s+(\d{4})/);
  if (!m) return { start: null, end: null };
  const mo1 = MONTHS[m[1].toLowerCase()];
  if (mo1 === undefined) return { start: null, end: null };
  const mo2 = m[3] ? MONTHS[m[3].toLowerCase()] ?? mo1 : mo1;
  const y = +m[5];
  return {
    start: new Date(Date.UTC(y, mo1, +m[2])).toISOString(),
    end: new Date(Date.UTC(y, mo2, +(m[4] || m[2]), 23, 59)).toISOString(),
  };
}

export async function fetchVybeDriven() {
  let js;
  try {
    // /hackathons and /events share the chunk; try both in case one stops preloading it.
    let chunk = null;
    for (const page of ["/hackathons", "/events", "/discover"]) {
      const html = await get(page);
      chunk = html.match(/\/assets\/opportunities-[A-Za-z0-9_-]+\.js/)?.[0];
      if (chunk) break;
    }
    if (!chunk) throw new Error("opportunities chunk not found");
    js = await get(chunk);
  } catch (e) {
    console.error("vybedriven fail:", e.message);
    return [];
  }

  const now = Date.now();
  const out = [];
  // Each object starts at `{slug:\``; split there and treat the remainder as one object.
  for (const src of js.split(/(?=\{slug:`)/).slice(1)) {
    const slug = field(src, "slug");
    const title = field(src, "title");
    if (!slug || !title) continue;

    if (!/open/i.test(field(src, "status"))) continue; // "Registration open" only

    const dateText = field(src, "date");
    const { start, end } = parseRange(dateText);
    if (end && Date.parse(end) < now) continue;

    // Registration close if it parses ("To be announced" doesn't), else the event start.
    const regClose = parseRange(field(src, "registrationDeadline")).end;
    const deadline = regClose || (start && Date.parse(start) > now ? start : end);

    const type = field(src, "type");
    out.push(
      normalize(
        {
          title,
          url: `${BASE}/opportunities/${slug}`,
          deadline,
          location: [...new Set([field(src, "format"), field(src, "location")].filter(Boolean))].join(" · "),
          // dateText rides in the description so isExpired() can still read it.
          description: [field(src, "tag"), field(src, "description"), field(src, "organizer"), dateText]
            .filter(Boolean)
            .join(" — "),
          tags: `vybedriven ${type}`,
        },
        "vybedriven",
        { precurated: /hackathon/i.test(type) }
      )
    );
  }
  return out;
}
