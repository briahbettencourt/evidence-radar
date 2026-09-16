"use strict";

const { TOPICS, buildQuery, gradeOf } = require("./topics");

const API = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const UA = "EvidenceRadar/0.1 (+https://github.com/briahbettencourt/evidence-radar)";

/**
 * Europe PMC is used rather than PubMed's E-utilities because it needs no API key,
 * returns publication type (which is what makes evidence grading possible), and
 * flags open access so a brief can say whether the full paper is actually readable.
 */
async function search(query, { limit = 25 } = {}) {
  const url = `${API}?${new URLSearchParams({
    query,
    format: "json",
    pageSize: String(Math.min(limit, 100)),
    resultType: "core",
    sort: "P_PDATE_D desc",
  })}`;

  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`Europe PMC returned ${res.status}`);
  const json = await res.json();
  return {
    total: json.hitCount || 0,
    results: (json.resultList && json.resultList.result) || [],
  };
}

function toFinding(raw) {
  const pubTypes = (raw.pubTypeList && raw.pubTypeList.pubType) || [];
  const grade = gradeOf(pubTypes);
  const journal = ((raw.journalInfo || {}).journal || {}).title || null;
  const doi = raw.doi || null;

  return {
    title: (raw.title || "").replace(/\s+/g, " ").replace(/\.$/, "").trim(),
    journal,
    date: raw.firstPublicationDate || null,
    tier: grade.tier,
    evidence: grade.label,
    openAccess: raw.isOpenAccess === "Y",
    doi,
    url: doi
      ? `https://doi.org/${doi}`
      : `https://europepmc.org/article/${raw.source}/${raw.id}`,
    abstract: raw.abstractText
      ? raw.abstractText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      : null,
  };
}

/**
 * Relevance filter.
 *
 * Europe PMC matches TITLE_ABS, so a cardiology trial that mentions sleep once in
 * its abstract ranks alongside an actual sleep study. Testing this returned
 * "aromatherapy for menopausal symptoms" under the sleep topic.
 *
 * The fix that works without a scoring black box: require a topic term in the
 * *title*. A paper about X almost always says X in its title; a paper that merely
 * mentions X usually does not. `--loose` disables this when you want recall over
 * precision.
 */
function distinctiveHeads(topic) {
  // A head word shared by several terms is the topic's generic stem, not evidence
  // of relevance: every one of "sleep duration", "sleep quality" and "sleep hygiene"
  // reduces to "sleep", which then matches any paper with "sleep" in the title.
  // That is how apnoea screening and EEG papers kept ranking as sleep-hygiene
  // research. Shared heads require the full phrase; unique heads keep the shortcut.
  if (topic._heads) return topic._heads;
  const counts = new Map();
  for (const t of topic.include) {
    const h = t.toLowerCase().split(" ")[0];
    counts.set(h, (counts.get(h) || 0) + 1);
  }
  topic._heads = new Set([...counts].filter(([h, n]) => n === 1 && h.length > 4).map(([h]) => h));
  return topic._heads;
}

function termInTitle(title, term, heads) {
  const t = term.toLowerCase();
  if (title.includes(t)) return true;
  const head = t.split(" ")[0];
  return heads.has(head) && title.includes(head);
}

function titleMatches(finding, topic) {
  const title = (finding.title || "").toLowerCase();
  const heads = distinctiveHeads(topic);
  return topic.include.some((term) => termInTitle(title, term, heads));
}

/**
 * Clinical-population filter, applied to titles.
 *
 * Keyword exclusion in the query is whack-a-mole: it caught "cancer patients" but
 * not "Melatonin for Sleep Disorders in Cancer", and every miss needs a new string.
 * These patterns instead match the *grammar* of a population claim — "in X with Y",
 * "patients with", "survivors" — which is how titles actually name their cohort.
 *
 * Deliberately narrow: "cancer risk" and "cancer prevention" are outcomes in a
 * general population and must survive, so only positional uses of the disease are
 * matched. Disable with --include-clinical.
 */
const POPULATION_PATTERNS = [
  /\bpatients with\b/,
  /\b(in|among|for|with) (adults|people|patients|individuals|women|men|children|veterans|survivors)\b[^.]*\bwith\b/,
  /\b(neonates|infants|preterm|pregnant women|nursing home|care home|p[ae]diatric)\b/,
  /\b(in|among|with|for) (advanced |metastatic )?(cancer|dementia|schizophrenia|cirrhosis|copd|hiv|parkinson|alzheimer|epilepsy)\b/,
  /\b(cancer|stroke|covid|icu) survivors\b/,
  /\b(critically ill|hospitalised|hospitalized|institutionalised|institutionalized)\b/,
  /\bundergoing (surgery|chemotherapy|dialysis|transplantation)\b/,
];

/**
 * Animal and in-vitro work.
 *
 * Topic-level excludes caught some of this, but unevenly — a creatine scan still
 * returned "Creatine and cognitive function in rodents". A rodent finding presented
 * to a general reader is the single most common way wellness media misleads, so
 * this is checked centrally rather than per topic.
 */
const NON_HUMAN_PATTERNS = [
  /\b(rodents?|mice|murine|rats?|zebrafish|drosophila|c\. ?elegans|canine|porcine|bovine)\b/,
  /\bin (vitro|vivo)\b/,
  /\banimal (model|study|studies)\b/,
];

/**
 * Papers about measuring or predicting rather than about doing something.
 *
 * Device-validation, diagnostic-accuracy, prognostic-model and prevalence papers
 * are legitimate science and completely unusable to a reader deciding what to do
 * on Monday — "Accuracy of Photoplethysmography-Derived Pulse Rate Variability
 * Compared with Electrocardiography" is not a recovery tip. Disable with
 * --include-methods if you want them.
 */
const METHODS_PATTERNS = [
  /\b(accuracy|validity|reliability|validation|diagnostic performance|diagnostic variability)\b/,
  /\b(prognostic value|risk prediction model|prediction models?|screening tools?)\b/,
  /\b(prevalence|epidemiology) (and|of)\b/,
  /\bcompared with electrocardiograph/,
  /\b(bibliometric|knowledge mapping|scoping review)\b/,
];

function isNonHuman(finding) {
  const title = (finding.title || "").toLowerCase();
  return NON_HUMAN_PATTERNS.some((re) => re.test(title));
}

function isMethodsPaper(finding) {
  const title = (finding.title || "").toLowerCase();
  return METHODS_PATTERNS.some((re) => re.test(title));
}

function isClinicalPopulation(finding) {
  const title = (finding.title || "").toLowerCase();
  return POPULATION_PATTERNS.some((re) => re.test(title));
}

/**
 * Ranking is deliberately simple and explainable: evidence tier first, then
 * recency. No opaque relevance score — if a weaker study outranks a stronger one
 * you should be able to see why.
 */
function rank(findings) {
  return findings.sort((a, b) => (a.tier - b.tier) || String(b.date).localeCompare(String(a.date)));
}

/**
 * Which topic term a finding matched. Used for diversity, and worth surfacing so
 * a reader can see why a paper was returned.
 */
function matchedTerm(finding, topic) {
  const title = (finding.title || "").toLowerCase();
  const heads = distinctiveHeads(topic);
  return topic.include.find((t) => title.includes(t.toLowerCase())) ||
    topic.include.find((t) => termInTitle(title, t, heads)) || null;
}

/**
 * Cap how many results any single term can claim.
 *
 * Without this, the most-published term swamps the topic: a nutrition scan
 * returned 6 of 10 results on Mediterranean diet alone, burying time-restricted
 * eating, fibre and ultra-processed food entirely. Same problem the Marshal
 * scanner had with document types, same fix — quota, then round-robin.
 */
function diversify(findings, topic, perTerm) {
  const buckets = new Map();
  for (const f of findings) {
    const key = matchedTerm(f, topic) || "_other";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(f);
  }
  const out = [];
  let drew = true;
  while (drew) {
    drew = false;
    for (const [key, list] of buckets) {
      if (!list.length) continue;
      if (out.filter((f) => (matchedTerm(f, topic) || "_other") === key).length >= perTerm) continue;
      out.push(list.shift());
      drew = true;
    }
  }
  return out;
}

async function scanTopic(topicKey, opts = {}) {
  const {
    days = 90, tiers = [1, 2], limit = 25,
    loose = false, perTerm = 2, includeClinical = false, includeMethods = false,
  } = opts;
  const topic = TOPICS[topicKey];
  const query = buildQuery(topicKey, { days, tiers });

  // Over-fetch, because title filtering discards a large share of abstract-only matches.
  const { total, results } = await search(query, { limit: loose ? limit : Math.min(limit * 5, 100) });

  const all = results.map(toFinding);
  const relevant = loose ? all : all.filter((f) => titleMatches(f, topic));
  const onTopic = relevant.filter((f) =>
    (includeClinical || !isClinicalPopulation(f)) &&
    (includeMethods || !isMethodsPaper(f)) &&
    !isNonHuman(f));
  const spread = loose ? onTopic : diversify(rank(onTopic), topic, perTerm);

  const findings = rank(spread).slice(0, limit).map((f) => ({ ...f, matched: matchedTerm(f, topic) }));

  return {
    topic: topicKey,
    label: topic.label,
    windowDays: days,
    totalMatches: total,
    scanned: all.length,
    filteredOut: all.length - relevant.length,
    clinicalDropped: relevant.length - onTopic.length,  // clinical + methods + non-human
    crowdedOut: onTopic.length - spread.length,
    loose,
    findings,
    query,
  };
}

function toMarkdown(report, { abstracts = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `# Evidence Radar — ${report.label}`,
    "",
    `Window: last ${report.windowDays} days · Generated ${today}`,
    `Matches: ${report.totalMatches} · Showing ${report.findings.length}`,
    "",
    "> Findings are ranked by study design first, then recency. A high tier means a",
    "> stronger design, not that the conclusion is correct. Read the source before",
    "> citing it.",
    "",
  ];

  let currentTier = null;
  for (const f of report.findings) {
    if (f.tier !== currentTier) {
      currentTier = f.tier;
      lines.push(`## ${f.evidence}`, "");
    }
    lines.push(`### ${f.title}`);
    lines.push("");
    if (f.matched) lines.push(`- **Matched on:** ${f.matched}`);
    lines.push(`- **Journal:** ${f.journal || "not stated"}`);
    lines.push(`- **Published:** ${f.date || "unknown"}`);
    lines.push(`- **Full text:** ${f.openAccess ? "open access" : "paywalled"}`);
    lines.push(`- **Source:** ${f.url}`);
    if (abstracts && f.abstract) {
      lines.push("");
      lines.push(`> ${f.abstract.slice(0, 600)}${f.abstract.length > 600 ? "…" : ""}`);
    }
    lines.push("");
  }

  if (!report.findings.length) {
    lines.push("_No results in this window. Try a longer `--days`, or widen `--tiers`._", "");
  }

  lines.push("---", "", `<sub>Query used: \`${report.query}\`</sub>`, "");
  return lines.join("\n");
}

module.exports = { search, scanTopic, toMarkdown, toFinding, rank, isClinicalPopulation, isNonHuman, isMethodsPaper };
