import { normalize } from "../filter.js";

// HackCulture (hackculture.io) — India-focused hackathon / innovation-challenge host.
// The /programs page renders client-side; it calls this public, keyless endpoint:
//   GET https://api.hackculture.io/api/v1/hackathons?skip=&limit=  ->  [ {...}, ... ]
// (`/hackathons/all` is the same data but 401s without a login — don't use it.)
// The whole archive is ~50 rows, so we page through it and drop what's over.
//
// Precurated: every row is a hackathon, innovation challenge or startup challenge,
// so it skips the keyword gate — "Aavishkara" and "FLUX 2026" carry no AI word —
// but still faces the India/remote + exclude filters.

const ENDPOINT = "https://api.hackculture.io/api/v1/hackathons";
const PAGE = 50; // the API rejects limit > 50 with a 422
const MAX = 300; // safety stop; the archive is ~50 in practice

const toIso = (v) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

// Addresses here run to a full postal line (and FLUX 2026 packs two venues in, with
// newlines), which would blow up the 📍 line. Collapse whitespace, and keep the
// address out of `location` — it rides in the description instead, where it still
// reaches the blob the India/remote gate reads.
const flat = (s) => (s || "").replace(/\s+/g, " ").trim();

// location is a nested object, null for online events.
function place(ev) {
  const name = flat(ev.location?.name);
  if (!name) return ev.mode === "online" ? "Online" : "";
  return ev.mode === "online" ? `Online · ${name}` : name;
}

async function fetchPage(skip) {
  const r = await fetch(`${ENDPOINT}?skip=${skip}&limit=${PAGE}`, {
    headers: {
      accept: "application/json",
      // Public endpoint, but browser-shaped; keep these so it isn't treated as a bot.
      origin: "https://hackculture.io",
      referer: "https://hackculture.io/programs",
      "user-agent": "Mozilla/5.0 (compatible; event-radar)",
    },
  });
  if (!r.ok) {
    console.error("hackculture fail:", r.status);
    return [];
  }
  const d = await r.json();
  return Array.isArray(d) ? d : d?.data || [];
}

export async function fetchHackCulture() {
  const rows = [];
  try {
    for (let skip = 0; skip < MAX; skip += PAGE) {
      const page = await fetchPage(skip);
      rows.push(...page);
      if (page.length < PAGE) break;
    }
  } catch (e) {
    console.error("hackculture fail:", e.message);
    return [];
  }

  const now = Date.now();
  const out = [];
  for (const ev of rows) {
    if (ev.status !== "published") continue;
    // Nothing to do about an event you can't enter. A not-yet-open one flips to true
    // later and lands then as a NEW alert, which is exactly when it's actionable.
    if (!ev.is_registration_open) continue;

    const end = toIso(ev.end_datetime);
    if (end && Date.parse(end) < now) continue;

    // No registration-close field on this API, so the start is the actionable date.
    // An already-running event has a start in the past — fall back to its end so the
    // 48h reminder still means something.
    const start = toIso(ev.start_datetime);
    const deadline = start && Date.parse(start) > now ? start : end;

    out.push(
      normalize(
        {
          title: ev.name,
          // /programs/<slug> is the public page the site's own nav links to.
          url: ev.external_registration_url || `https://hackculture.io/programs/${ev.slug || ""}`,
          deadline,
          location: place(ev),
          description: [ev.tagline, ev.organizer_name, flat(ev.location?.address)]
            .filter(Boolean)
            .join(" — "),
          tags: `hackculture ${ev.type || ""} ${ev.industry || ""} ${ev.mode || ""}`,
        },
        "hackculture",
        { precurated: true }
      )
    );
  }
  return out;
}
