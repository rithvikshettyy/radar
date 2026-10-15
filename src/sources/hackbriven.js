import { normalize } from "../filter.js";

// HackBriven (hackbriven.com) — India student hackathon/event host. Next.js site whose
// own listing page calls a public, keyless JSON endpoint:
//   GET https://hackbriven.com/api/events?page=&limit=  ->  { events: [...], hasMore }
// The whole archive is ~35 rows (mostly closed), so we page through and keep what's open.
//
// Hackathon-type rows are precurated (many carry no AI word); workshops/events face the
// normal keyword gate. Everything still faces the India/remote + exclude filters.

const ENDPOINT = "https://hackbriven.com/api/events";
const PAGE = 50;
const MAX_PAGES = 10; // safety stop

const flat = (s) => (s || "").replace(/\s+/g, " ").trim();
// Descriptions are HTML; strip tags so they read as text in the blob.
const text = (html) => flat((html || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&"));

const toIso = (v) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

function place(ev) {
  const loc = flat(ev.location);
  if (ev.locationType === "virtual") return loc ? `Online · ${loc}` : "Online";
  if (ev.locationType === "hybrid") return loc ? `Hybrid · ${loc}` : "Hybrid";
  return loc;
}

async function fetchPage(page) {
  const r = await fetch(`${ENDPOINT}?page=${page}&limit=${PAGE}`, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; event-radar)" },
  });
  if (!r.ok) {
    console.error("hackbriven fail:", r.status);
    return { events: [], hasMore: false };
  }
  return r.json();
}

export async function fetchHackBriven() {
  const rows = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const d = await fetchPage(page);
      rows.push(...(d?.events || []));
      if (!d?.hasMore) break;
    }
  } catch (e) {
    console.error("hackbriven fail:", e.message);
    return [];
  }

  const now = Date.now();
  const out = [];
  for (const ev of rows) {
    if (ev.status !== "Approved") continue;
    if (ev.registrationStatus !== "open") continue;

    const end = toIso(ev.endDate);
    if (end && Date.parse(end) < now) continue;

    // Registration close is the actionable date; fall back to start, then end.
    const deadline = toIso(ev.registrationDeadline || ev.registrationEndDate) || toIso(ev.startDate) || end;

    out.push(
      normalize(
        {
          title: ev.eventName,
          url: `https://hackbriven.com/event/${ev.slug}`,
          deadline,
          location: place(ev),
          description: [ev.organizationName, ev.prizePool && `Prize ${flat(ev.prizePool)}`, text(ev.description).slice(0, 400)]
            .filter(Boolean)
            .join(" — "),
          tags: `hackbriven ${ev.eventType || ""} ${ev.locationType || ""} ${(ev.tags || []).join(" ")}`,
        },
        "hackbriven",
        { precurated: ev.eventType === "hackathon" }
      )
    );
  }
  return out;
}
