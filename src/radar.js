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
function titleMatches(finding, topic) {
  const title = (finding.title || "").toLowerCase();
  return topic.include.some((term) => {
    const t = term.toLowerCase();
    // Match the distinctive word in multi-word terms too ("sleep duration" → "sleep").
    const head = t.split(" ")[0];
    return title.includes(t) || (head.length > 4 && title.includes(head));
  });
}

/**
 * Ranking is deliberately simple and explainable: evidence tier first, then
 * recency. No opaque relevance score — if a weaker study outranks a stronger one
 * you should be able to see why.
 */
function rank(findings) {
  return findings.sort((a, b) => (a.tier - b.tier) || String(b.date).localeCompare(String(a.date)));
}

async function scanTopic(topicKey, opts = {}) {
  const { days = 90, tiers = [1, 2], limit = 25, loose = false } = opts;
  const topic = TOPICS[topicKey];
  const query = buildQuery(topicKey, { days, tiers });

  // Over-fetch, because title filtering discards a large share of abstract-only matches.
  const { total, results } = await search(query, { limit: loose ? limit : Math.min(limit * 4, 100) });

  const all = results.map(toFinding);
  const kept = loose ? all : all.filter((f) => titleMatches(f, topic));

  return {
    topic: topicKey,
    label: topic.label,
    windowDays: days,
    totalMatches: total,
    scanned: all.length,
    filteredOut: all.length - kept.length,
    loose,
    findings: rank(kept).slice(0, limit),
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

module.exports = { search, scanTopic, toMarkdown, toFinding, rank };
