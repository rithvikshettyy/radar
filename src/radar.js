import { readFile, writeFile } from "node:fs/promises";
import { fetchDevpost } from "./sources/devpost.js";
import { fetchDevfolio } from "./sources/devfolio.js";
import { fetchLuma } from "./sources/luma.js";
import { fetchLumaDiscover } from "./sources/luma-discover.js";
import { fetchMLH } from "./sources/mlh.js";
import { fetchHackerEarth } from "./sources/hackerearth.js";
import { fetchHackCulture } from "./sources/hackculture.js";
import { fetchSarvam } from "./sources/sarvam.js";
import { fetchBasecamp } from "./sources/basecamp.js";
import { fetchWebSearch } from "./sources/websearch.js";
import { idFor, isRelevant, isExpired, deadlineDueSoon } from "./filter.js";
import { push, preview } from "./telegram.js";

const SEEN_PATH = new URL("../data/seen.json", import.meta.url);
const DRY = process.argv.includes("--dry");
// Record everything as already-seen without notifying. Run this once after
// switching on a new source (devfolio key, a new Luma calendar) so its whole
// existing backlog doesn't land as one flood — you then only get what's posted after.
const SEED = process.argv.includes("--seed");

async function loadSeen() {
  try {
    return JSON.parse(await readFile(SEEN_PATH, "utf8"));
  } catch {
    return {}; // { id: { remindedForDeadline: bool } }
  }
}

async function main() {
  const seen = await loadSeen();

  const results = await Promise.allSettled([
    fetchDevpost(),
    fetchDevfolio(),
    fetchLuma(),
    fetchLumaDiscover(),
    fetchMLH(),
    fetchHackerEarth(),
    fetchHackCulture(),
    fetchSarvam(),
    fetchBasecamp(),
    fetchWebSearch(),
  ]);
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  // Dedupe by id: one event can arrive twice in a run (devpost queries two listings,
  // Luma calendars overlap). Without this the second copy sees the state the first
  // copy just wrote and fires a deadline reminder seconds after the NEW alert.
  const byId = new Map();
  const live = all
    .map((e) => ({ ...e, id: idFor(e) }))
    .filter((e) => isRelevant(e) && !isExpired(e));
  for (const e of live) {
    const prev = byId.get(e.id);
    // Prefer the copy that carries a deadline; feeds differ in what they fill in.
    if (!prev || (!prev.deadline && e.deadline)) byId.set(e.id, e);
  }
  const events = [...byId.values()];

  let newCount = 0;
  let remindCount = 0;
  let sentCount = 0;

  // SEED records state only; DRY prints instead of sending. Both leave Telegram alone.
  const deliver = async (ev, reminder) => {
    if (SEED) return;
    if (DRY) return void preview(ev, reminder);
    if (await push(ev, reminder)) sentCount++;
  };

  // Most feeds expose no publish date, so the run that first sees an event stands in
  // for one. Recorded per event so a later deadline reminder can show it too.
  const nowIso = new Date().toISOString();

  for (const ev of events) {
    const rec = seen[ev.id];
    if (!rec) {
      // A seeded event is pre-existing backlog, not something posted today — leave
      // firstSeen unset there so the message omits the date instead of lying.
      if (!SEED) ev.posted = ev.posted || nowIso;
      await deliver(ev, false);
      // If it's already inside the reminder window, the NEW alert just showed that
      // deadline — burn the reminder now instead of re-pinging the same event next hour.
      const alreadyDue = deadlineDueSoon(ev);
      seen[ev.id] = SEED
        ? { remindedForDeadline: false }
        : { remindedForDeadline: alreadyDue, firstSeen: nowIso };
      newCount++;
    } else if (!rec.remindedForDeadline && deadlineDueSoon(ev)) {
      ev.posted = ev.posted || rec.firstSeen || null;
      await deliver(ev, true);
      rec.remindedForDeadline = true;
      remindCount++;
    }
  }

  await writeFile(SEEN_PATH, JSON.stringify(seen, null, 2));
  console.log(
    `scanned=${all.length} relevant=${events.length} new=${newCount} ` +
      `reminders=${remindCount} sent=${sentCount} dry=${DRY} seed=${SEED}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
