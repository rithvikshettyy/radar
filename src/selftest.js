// Offline sanity test: no network, no secrets. Validates filter + dedupe + reminder logic.
import { normalize, idFor, isRelevant, deadlineDueSoon } from "./filter.js";
import { toIso } from "./sources/devfolio.js";

let fail = 0;
const ok = (cond, msg) => {
  if (!cond) {
    fail++;
    console.error("FAIL:", msg);
  } else console.log("pass:", msg);
};

const inFuture = (h) => new Date(Date.now() + h * 3.6e6).toISOString();

const aiIndia = normalize(
  { title: "GenAI Buildathon Bengaluru", url: "https://x.com/a", location: "Bengaluru, India" },
  "devpost"
);
const aiRemote = normalize(
  { title: "LLM Agent Hackathon", url: "https://x.com/b", location: "Online" },
  "devpost"
);
const aiUsOnly = normalize(
  { title: "AI Hackathon", url: "https://x.com/c", location: "Redmond, WA" },
  "devpost"
);
const nonAi = normalize(
  { title: "Baking contest", url: "https://x.com/d", location: "Mumbai" },
  "mlh"
);
const schoolAi = normalize(
  { title: "AI hackathon for high school students", url: "https://x.com/e", location: "Online" },
  "mlh"
);

ok(isRelevant(aiIndia), "AI + India passes");
ok(isRelevant(aiRemote), "AI + remote passes");
ok(!isRelevant(aiUsOnly), "AI + US-only rejected (indiaOrRemoteOnly)");
ok(!isRelevant(nonAi), "non-AI rejected");
ok(!isRelevant(schoolAi), "school-tagged rejected via exclude");

// precurated (Luma ai/tech sweep): no AI keyword needed, but India/remote + exclude still apply
const hackerHouseGoa = normalize(
  { title: "Hacker House Goa 2026", url: "https://luma.com/hhgoa", location: "Goa · 12 spots left" },
  "luma-discover",
  { precurated: true }
);
const sarvamEpoch = normalize(
  { title: "Sarvam Epoch", url: "https://luma.com/epoch", location: "Bengaluru" },
  "luma-discover",
  { precurated: true }
);
const precuratedUsParty = normalize(
  { title: "Founder Mixer", url: "https://luma.com/x", location: "San Francisco" },
  "luma-discover",
  { precurated: true }
);
const precuratedSchool = normalize(
  { title: "Kids coding day for high school students", url: "https://luma.com/y", location: "Online" },
  "luma-discover",
  { precurated: true }
);
ok(isRelevant(hackerHouseGoa), "precurated Hacker House Goa passes (no AI word needed)");
ok(isRelevant(sarvamEpoch), "precurated Sarvam Epoch passes");
ok(!isRelevant(precuratedUsParty), "precurated US event still rejected (not India/remote)");
ok(!isRelevant(precuratedSchool), "precurated school event still excluded");

// dedupe: same url -> same id; different url -> different id
ok(idFor({ ...aiIndia, id: "" }) === idFor({ ...aiIndia, id: "" }), "stable id for same event");
ok(idFor(aiIndia) !== idFor(aiRemote), "different url -> different id");

// deadline reminder window
ok(deadlineDueSoon({ deadline: inFuture(10) }), "10h out -> due soon");
ok(!deadlineDueSoon({ deadline: inFuture(200) }), "200h out -> not yet");
ok(!deadlineDueSoon({ deadline: inFuture(-5) }), "past deadline -> no");
ok(!deadlineDueSoon({ deadline: null }), "no deadline -> no");

// devfolio timestamp normalization (unix seconds, unix ms, ISO string, null)
const isoSec = toIso(1893456000); // 2030-ish unix seconds
const isoMs = toIso(1893456000000); // same in ms
ok(isoSec === isoMs, "toIso: unix seconds and ms resolve equal");
ok(toIso("2026-09-01T10:00:00Z") === "2026-09-01T10:00:00.000Z", "toIso: ISO string ok");
ok(toIso(null) === null && toIso("garbage") === null, "toIso: bad input -> null");

// a devfolio-shaped hackathon (no AI word, offline India) still passes via precurated
const devfolioGoa = normalize(
  { title: "Hacker House Goa", url: "https://hhgoa.devfolio.co", location: "Goa", tags: "hackathon devfolio" },
  "devfolio",
  { precurated: true }
);
ok(isRelevant(devfolioGoa), "devfolio Hacker House Goa passes");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);