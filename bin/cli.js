#!/usr/bin/env node
"use strict";

const { scanTopic, toMarkdown } = require("../src/radar");
const { TOPICS } = require("../src/topics");

const C = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (n, s) => (C ? `[${n}m${s}[0m` : s);
const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const green = (s) => c("32", s);
const yellow = (s) => c("33", s);

function usage() {
  console.log(`
${bold("Evidence Radar")}

  Tracks new research in health, wellness and longevity, graded by study design.
  Returns evidence to read, not conclusions to repeat.

${bold("Usage")}
  node bin/cli.js <topic> [options]

${bold("Topics")}
${Object.entries(TOPICS).map(([k, v]) => `  ${k.padEnd(13)} ${v.label}`).join("\n")}

${bold("Options")}
  --days N       Look back N days (default 90)
  --tiers 1,2    Study designs: 1 meta-analysis/SR, 2 RCT, 3 observational, 4 review
  --limit N      Max findings (default 25)
  --md           Markdown output
  --abstracts    Include abstracts (markdown only)
  --loose        Skip the title-relevance filter (more results, more noise)

${bold("Examples")}
  node bin/cli.js sleep
  node bin/cli.js nutrition --days 30 --md > nutrition.md
  node bin/cli.js longevity --tiers 1 --limit 10
`);
}

function parse(argv) {
  const o = { days: 90, tiers: [1, 2], limit: 25, md: false, abstracts: false, loose: false };
  const topic = argv.find((a) => !a.startsWith("-"));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") o.days = parseInt(argv[++i], 10) || o.days;
    else if (a === "--limit") o.limit = parseInt(argv[++i], 10) || o.limit;
    else if (a === "--tiers") o.tiers = argv[++i].split(",").map(Number).filter(Boolean);
    else if (a === "--md") o.md = true;
    else if (a === "--abstracts") o.abstracts = true;
    else if (a === "--loose") o.loose = true;
  }
  return { topic, o };
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(argv.length ? 0 : 1);
  }

  const { topic, o } = parse(argv);
  if (!topic || !TOPICS[topic]) {
    console.error(`Unknown topic${topic ? ` "${topic}"` : ""}. Known: ${Object.keys(TOPICS).join(", ")}`);
    process.exit(1);
  }

  if (!o.md) console.error(dim(`Scanning ${topic}, last ${o.days} days…`));

  const report = await scanTopic(topic, o);

  if (o.md) {
    process.stdout.write(toMarkdown(report, { abstracts: o.abstracts }));
    return;
  }

  console.log("");
  console.log(bold(`EVIDENCE RADAR — ${report.label.toUpperCase()}`));
  console.log(`Window: last ${report.windowDays} days`);
  console.log(`Matches: ${bold(String(report.totalMatches))}   Showing: ${report.findings.length}` + (report.filteredOut ? dim(`   (${report.filteredOut} filtered as off-topic)`) : ""));
  console.log("");

  let tier = null;
  for (const f of report.findings) {
    if (f.tier !== tier) {
      tier = f.tier;
      console.log(bold(`— ${f.evidence} —`));
    }
    console.log(`  ${f.title}`);
    console.log(dim(`    ${f.journal || "journal not stated"} · ${f.date || "date unknown"} · ${f.openAccess ? green("open access") : yellow("paywalled")}`));
    console.log(dim(`    ${f.url}`));
  }

  if (!report.findings.length) {
    console.log(dim("  Nothing in this window. Try --days 180 or --tiers 1,2,3"));
  }

  console.log("");
  console.log(dim("Ranked by study design, then recency. A strong design does not mean"));
  console.log(dim("a correct conclusion. Read the source before citing it."));
  console.log("");
}

main().catch((e) => {
  console.error("Failed: " + e.message);
  process.exit(1);
});
