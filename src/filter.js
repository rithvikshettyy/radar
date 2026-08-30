import { config } from "../config.js";

const lc = (s) => (s || "").toLowerCase();

const reCache = new Map();
// Whole-word match so "ai" hits "AI hackathon" but not "Mumbai" / "email".
function hasWord(text, word) {
  let re = reCache.get(word);
  if (!re) {
    const esc = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, "i");
    reCache.set(word, re);
  }
  return re.test(text);
}

// Stable id from url (fallback title). Used for dedupe.
export function idFor(ev) {
  const key = ev.url || ev.title || JSON.stringify(ev);
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return `${ev.source}:${(h >>> 0).toString(36)}`;
}

export function normalize(raw, source, opts = {}) {
  return {
    id: "",
    source,
    precurated: !!opts.precurated, // came from an already-scoped feed (e.g. Luma ai/tech) -> skip keyword gate
    title: (raw.title || "").trim(),
    url: (raw.url || "").trim(),
    deadline: raw.deadline || null, // ISO string or null
    // When the source published it. Only a few feeds expose this (Sarvam's CMS
    // _createdAt, Luma's ICS CREATED); for the rest radar.js fills in the day it
    // first saw the event, which is the closest honest answer.
    posted: raw.posted || null,
    location: (raw.location || "").trim(),
    blob: lc([raw.title, raw.location, raw.description, raw.tags].join(" ")),
    // What isExpired() reads dates out of when there's no deadline field.
    // Deliberately EXCLUDES tags: for a search hit tags is the query string
    // ("AI hackathon India 2026 apply"), which would stamp the current year onto
    // every hit and make the year check below pass no matter what the page says.
    dateText: [raw.title, raw.location, raw.description].filter(Boolean).join(" "),
  };
}

export function isRelevant(ev) {
  const t = ev.blob;
  // Precurated events (from a city+category-scoped Luma sweep) skip the keyword gate,
  // so a "Hacker House Goa" with no literal AI word still gets through.
  if (!ev.precurated && !config.include.some((k) => hasWord(t, k))) return false;
  if (config.exclude.some((k) => hasWord(t, k))) return false;
  if (config.indiaOrRemoteOnly) {
    if (!config.indiaOrRemoteHints.some((k) => hasWord(t, k))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Dates written in prose.
//
// Most feeds hand us a real deadline. Web-search hits hand us nothing — and an
// event with no deadline could never expire, which is how a page about a
// hackathon that ended in May still landed as a "NEW EVENT" in August. When
// there's no usable deadline field, read the dates out of the event's own
// title/description instead and treat the LATEST one as its effective end.
//
// Tiered by precision, most precise wins: a full date beats a month+year beats a
// bare year. Mixing tiers is worse than either — a page reading "12 Aug 2026 …
// © 2026" would inherit end-of-December from the bare year and sit in the feed
// four months after the event finished.
// ---------------------------------------------------------------------------

// Explicit alternation, not `(jan|feb|…)[a-z]*`: the loose form reads "Marathon
// 2026" as March 2026 and expires a live event five months early.
const MONTH_RE =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|" +
  "aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const MONTH_NUM = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// End of the named period, never its start: a partial date must not expire an
// event early. "Aug 2026" stays live through 31 Aug, a bare "2026" through 31 Dec.
const endOfDay = (y, m, d) => Date.UTC(y, m, d, 23, 59, 59);
const endOfMonth = (y, m) => Date.UTC(y, m + 1, 0, 23, 59, 59);
const endOfYear = (y) => Date.UTC(y, 11, 31, 23, 59, 59);

const RE_ISO = /(?<!\d)(20\d\d)-(\d{1,2})-(\d{1,2})(?!\d)/g;
const RE_DMY = new RegExp(
  `(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b\\.?,?\\s*(20\\d\\d)(?!\\d)`,
  "gi"
);
const RE_MDY = new RegExp(
  `\\b${MONTH_RE}\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(20\\d\\d)(?!\\d)`,
  "gi"
);
const RE_MY = new RegExp(`\\b${MONTH_RE}\\b\\.?,?\\s*(20\\d\\d)(?!\\d)`, "gi");
// A year has to stand alone. Without the digit guards the tweet id in
// x.com/SarvamAI/status/2084578727158317435 reads as the year 2084 and keeps a
// months-old post alive forever.
const RE_YEAR = /(?<!\d)(20\d\d)(?!\d)/g;

const monthNum = (word) => MONTH_NUM[word.slice(0, 3).toLowerCase()];

function scan(re, text, build) {
  const out = [];
  re.lastIndex = 0;
  for (let m; (m = re.exec(text)); ) {
    const t = build(m);
    if (t != null && !Number.isNaN(t)) out.push(t);
  }
  return out;
}

// Latest date named anywhere in `text`, as epoch ms. Null when it names none.
// Exported for selftest — this is what decides "finished".
export function extractLatestDate(text) {
  const s = String(text || "");
  if (!s) return null;

  const full = [
    ...scan(RE_ISO, s, (m) => {
      const [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
      return mo >= 0 && mo <= 11 && d >= 1 && d <= 31 ? endOfDay(y, mo, d) : null;
    }),
    ...scan(RE_DMY, s, (m) => {
      const d = +m[1];
      return d >= 1 && d <= 31 ? endOfDay(+m[3], monthNum(m[2]), d) : null;
    }),
    ...scan(RE_MDY, s, (m) => {
      const d = +m[2];
      return d >= 1 && d <= 31 ? endOfDay(+m[3], monthNum(m[1]), d) : null;
    }),
  ];
  if (full.length) return Math.max(...full);

  const monthYear = scan(RE_MY, s, (m) => endOfMonth(+m[2], monthNum(m[1])));
  if (monthYear.length) return Math.max(...monthYear);

  const years = scan(RE_YEAR, s, (m) => endOfYear(+m[1]));
  return years.length ? Math.max(...years) : null;
}

// Deadline already gone -> you can't enter, so it's not news. Sources set deadline to
// the actionable date (registration close), which can pass while the event still runs,
// so a source's own "is it over" check doesn't cover this.
//
// No deadline -> fall back to the dates written in the event's own text. Only a hit
// that names NO date at all survives; there is genuinely nothing to check there, and
// dropping those would gut the search net.
export function isExpired(ev, now = Date.now()) {
  if (ev.deadline) {
    const dl = Date.parse(ev.deadline);
    if (!Number.isNaN(dl)) return dl < now;
    // Unparseable ("sometime in spring") — fall through to the text scan.
  }
  const named = extractLatestDate(ev.dateText ?? ev.blob ?? ev.title);
  return named != null && named < now;
}

// Should we re-alert an already-seen event because a deadline is near?
export function deadlineDueSoon(ev, now = Date.now()) {
  if (!ev.deadline) return false;
  const dl = Date.parse(ev.deadline);
  if (Number.isNaN(dl)) return false;
  const hrs = (dl - now) / 3.6e6;
  return hrs > 0 && hrs <= config.deadlineReminderHours;
}
