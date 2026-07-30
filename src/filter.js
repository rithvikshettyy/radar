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

// Deadline already gone -> you can't enter, so it's not news. Sources set deadline to
// the actionable date (registration close), which can pass while the event still runs,
// so a source's own "is it over" check doesn't cover this. No deadline -> keep: most
// search hits and Luma entries never carry one, and dropping them would gut the feed.
export function isExpired(ev, now = Date.now()) {
  if (!ev.deadline) return false;
  const dl = Date.parse(ev.deadline);
  return !Number.isNaN(dl) && dl < now;
}

// Should we re-alert an already-seen event because a deadline is near?
export function deadlineDueSoon(ev, now = Date.now()) {
  if (!ev.deadline) return false;
  const dl = Date.parse(ev.deadline);
  if (Number.isNaN(dl)) return false;
  const hrs = (dl - now) / 3.6e6;
  return hrs > 0 && hrs <= config.deadlineReminderHours;
}
