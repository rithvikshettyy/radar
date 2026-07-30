import { config } from "../../config.js";
import { normalize } from "../filter.js";

// Unstop (ex-Dare2Compete) — the other big Indian hackathon host, heavy on
// college events. Its public listing API needs no key:
//   GET /api/public/opportunity/search-result?opportunity=hackathons&oppstatus=open
// Shape: { data: { data: [...], total: n } }
//
// Unstop lists ~110 open hackathons at any moment, mostly non-AI college events,
// so this source gates itself BEFORE filter.js: the generic event words in
// config.include ("hackathon", "buildathon", ...) match almost every listing via
// its blurb, which would let ~80 through. Here we require a genuinely AI-ish
// keyword — config.include minus those generic words — matched against the title
// and skills only, not the marketing copy.

const ENDPOINT = "https://unstop.com/api/public/opportunity/search-result";
const PER_PAGE = 100;
const MAX_PAGES = 4; // 400 listings — well past the ~110 that are ever open

// Words that say "this is an event", not "this is about AI".
const GENERIC = new Set(["hackathon", "buildathon", "devpost", "devfolio"]);
const aiWords = () => (config.include || []).filter((k) => !GENERIC.has(k.toLowerCase()));

function looksAi(text) {
  const t = ` ${String(text).toLowerCase()} `;
  return aiWords().some((k) => {
    const esc = k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(t);
  });
}

const strip = (html) =>
  String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function fetchPage(page) {
  const u = new URL(ENDPOINT);
  u.searchParams.set("opportunity", "hackathons");
  u.searchParams.set("oppstatus", "open");
  u.searchParams.set("page", String(page));
  u.searchParams.set("per_page", String(PER_PAGE));
  const r = await fetch(u, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (compatible; event-radar)",
      referer: "https://unstop.com/hackathons",
    },
  });
  if (!r.ok) {
    console.error("unstop fail:", r.status);
    return { items: [], total: 0 };
  }
  const d = await r.json();
  return { items: d?.data?.data || [], total: d?.data?.total || 0 };
}

export async function fetchUnstop() {
  const items = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { items: got, total } = await fetchPage(page);
      items.push(...got);
      if (got.length < PER_PAGE || items.length >= total) break;
    }
  } catch (e) {
    console.error("unstop fail:", e.message);
  }

  const now = Date.now();
  const out = [];
  for (const it of items) {
    if (it.regn_open === 0) continue; // registration already shut
    const reg = it.regnRequirements || {};
    const deadline = reg.end_regn_dt || it.end_date || null;
    if (deadline && Date.parse(deadline) < now) continue;

    const skills = (it.required_skills || []).map((s) => s?.name || s).join(" ");
    if (!looksAi(`${it.title} ${skills}`)) continue;

    const addr = it.address_with_country_logo || {};
    const online = it.region === "online";
    const place = online
      ? "Online"
      : [addr.city, addr.state, addr.country?.name].filter(Boolean).join(", ") || "India";

    out.push(
      normalize(
        {
          title: it.title,
          url: it.seo_url || (it.public_url ? `https://unstop.com/${it.public_url}` : ""),
          deadline: deadline ? new Date(deadline).toISOString() : null,
          location: place,
          description: [it.organisation?.name, strip(it.details).slice(0, 400)]
            .filter(Boolean)
            .join(" — "),
          tags: `unstop hackathon ${skills}`,
        },
        "unstop"
      )
    );
  }
  return out;
}
