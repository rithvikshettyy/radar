import { normalize } from "../filter.js";

// HackerEarth challenges. The /challenges/hackathon/ page renders client-side, so
// scraping the HTML yields nothing — it calls this keyless API and filters locally:
//   GET /api/community/challenges/compete/  ->  { data: [...], total: n }
// The response is the full archive (~45 items) with only a handful still live, so
// we drop anything already ended.
//
// Timestamps come back naive-UTC ("2026-08-14T12:30:00", no zone) — append Z.
// NOT precurated: this feed carries plenty of non-AI contests, so the keyword
// gate in filter.js must still apply.

const ENDPOINT = "https://www.hackerearth.com/api/community/challenges/compete/";
// Hiring/College rounds are recruitment funnels, not events you'd want pinged about.
const KEEP_TYPES = new Set(["hackathon", "competitive"]);

const toIsoNaive = (v) => {
  if (!v) return null;
  const s = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export async function fetchHackerEarth() {
  let items = [];
  try {
    const r = await fetch(ENDPOINT, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (compatible; event-radar)",
        referer: "https://www.hackerearth.com/challenges/hackathon/",
      },
    });
    if (!r.ok) {
      console.error("hackerearth fail:", r.status);
      return [];
    }
    items = (await r.json())?.data || [];
  } catch (e) {
    console.error("hackerearth fail:", e.message);
    return [];
  }

  const now = Date.now();
  const out = [];
  for (const c of items) {
    if (!KEEP_TYPES.has(String(c.type || "").toLowerCase())) continue;
    const end = toIsoNaive(c.end);
    if (end && Date.parse(end) < now) continue;

    const url = c.url?.startsWith("http") ? c.url : `https://www.hackerearth.com${c.url || ""}`;
    // Start is the actionable date (registration shuts then), but an already-running
    // challenge has a start in the past — fall back to its end so the reminder means something.
    const start = toIsoNaive(c.start);
    const deadline = start && Date.parse(start) > now ? start : end;
    out.push(
      normalize(
        {
          title: c.title,
          deadline,
          url,
          location: "Online", // HackerEarth challenges are remote by default
          description: c.company_name || "",
          tags: `hackerearth ${c.type || ""}`,
        },
        "hackerearth"
      )
    );
  }
  return out;
}
