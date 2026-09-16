"use strict";

/**
 * Filter tests. No network — these check the two filters that decide what a
 * reader actually sees, because both have failed silently before: the title
 * filter once returned aromatherapy research under sleep, and the clinical
 * filter was first written with corrupted escapes that matched nothing at all
 * while appearing to work.
 *
 * Run: node test/filters.test.js
 */

const assert = require("assert");
const { isClinicalPopulation, isNonHuman, isMethodsPaper } = require("../src/radar");
const { TOPICS, buildQuery, gradeOf } = require("../src/topics");

let pass = 0;
const check = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

// --- clinical population filter -------------------------------------------
// Titles that name a patient cohort. A finding in these populations does not
// transfer to a general reader.
const CLINICAL = [
  "Melatonin for Sleep Disorders in Cancer: A Systematic Review",
  "Blue light therapy improves sleep quality in Parkinson's disease",
  "Time-Restricted Eating is Feasible in Veterans with Spinal Cord Injury",
  "Efficacy of exercise in patients with chronic kidney disease",
  "Nutrition support in critically ill adults",
  "Protein intake in cancer survivors: a meta-analysis",
  "Outcomes in adults undergoing dialysis",
  "Cardiorespiratory training for people with stroke",
  "Efficacy of probiotics in preventing atopic dermatitis in infants",
  "Probiotics in pediatric functional abdominal pain disorders",
];

// Titles where the disease is an OUTCOME in a general population. These must
// survive — filtering them would gut the most useful findings the tool returns.
const GENERAL = [
  "Ultra-Processed Food Consumption and Cancer Risk: An Umbrella Review",
  "Mediterranean Diet Reduces Inflammation in Adults: A Systematic Review",
  "Dietary fibre and cancer prevention: a meta-analysis",
  "A systematic review of sleep hygiene interventions in demanding occupations",
  "Resistance training and all-cause mortality in older adults",
];

for (const title of CLINICAL) {
  check(`clinical: ${title.slice(0, 45)}`, () =>
    assert.strictEqual(isClinicalPopulation({ title }), true));
}
for (const title of GENERAL) {
  check(`general: ${title.slice(0, 45)}`, () =>
    assert.strictEqual(isClinicalPopulation({ title }), false));
}

// --- non-human work ------------------------------------------------------
// Presenting a rodent finding to a general reader is the most common way
// wellness media misleads. This must never leak through.
for (const title of [
  "Creatine and cognitive function in rodents: A systematic review",
  "Effects of NMN on lifespan in mice",
  "Polyphenol bioavailability in vitro",
  "Probiotics and Their Functional Role in Mitigating Antinutrient Effects In Vivo",
]) {
  check(`non-human: ${title.slice(0, 40)}`, () =>
    assert.strictEqual(isNonHuman({ title }), true));
}
check("human trials are not flagged as non-human", () => {
  assert.strictEqual(isNonHuman({ title: "Creatine supplementation and cognition in older adults" }), false);
});

// --- measurement papers ---------------------------------------------------
// Real science, useless to a reader deciding what to do on Monday.
for (const title of [
  "Accuracy of Photoplethysmography-Derived Pulse Rate Variability Compared with Electrocardiography",
  "Prognostic Value of Frailty in Aortic Surgery",
  "Prevalence and diagnostic variability of sarcopenia in India",
  "Performance of AI-Based Screening Tools for Sleep Apnea",
  "Hypertension and frailty in older adults: a bibliometric analysis and knowledge mapping",
]) {
  check(`methods: ${title.slice(0, 40)}`, () =>
    assert.strictEqual(isMethodsPaper({ title }), true));
}
check("intervention trials are not flagged as methods papers", () => {
  assert.strictEqual(isMethodsPaper({ title: "Effect of 8-Hour Time-Restricted Eating on Glucose Metabolism in Adults" }), false);
  assert.strictEqual(isMethodsPaper({ title: "Mediterranean Diet Reduces Inflammation in Adults" }), false);
});

// --- regexes are not silently corrupt -------------------------------------
// A mangled escape sequence is invisible on screen and silently breaks a regex:
// `\b` written through a careless tool becomes a literal backspace byte, and the
// pattern then matches nothing while still looking correct in a diff. ESC (0x1b)
// is allowed — the CLI uses it for ANSI colour.
check("no mangled escape bytes in source", () => {
  const fs = require("fs");
  const path = require("path");
  for (const f of ["src/radar.js", "src/topics.js", "bin/cli.js", "test/filters.test.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    const hit = src.match(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]/);
    assert.ok(!hit, `${f} contains a stray control byte (0x${hit && hit[0].charCodeAt(0).toString(16)})`);
  }
});

// --- query construction ----------------------------------------------------
check("clinical exclusions applied by default", () => {
  assert.ok(buildQuery("nutrition").includes('NOT TITLE_ABS:"dialysis"'));
});
check("clinical exclusions can be disabled", () => {
  assert.ok(!buildQuery("nutrition", { clinical: false }).includes('NOT TITLE_ABS:"dialysis"'));
});
check("unknown topic throws with a useful message", () => {
  assert.throws(() => buildQuery("nope"), /Known:/);
});
check("sleep excludes apnoea rather than including it", () => {
  assert.ok(!TOPICS.sleep.include.some((t) => /apn/i.test(t)));
  assert.ok(TOPICS.sleep.exclude.some((t) => /apn/i.test(t)));
});

// --- evidence grading ------------------------------------------------------
check("meta-analysis outranks review", () => {
  assert.strictEqual(gradeOf(["Meta-Analysis"]).tier, 1);
  assert.strictEqual(gradeOf(["Review"]).tier, 4);
});
check("unknown publication type falls back, never crashes", () => {
  assert.strictEqual(gradeOf([]).tier, 4);
  assert.strictEqual(gradeOf(["Nonsense"]).tier, 4);
});

console.log(`${pass} checks passed${process.exitCode ? " (with failures above)" : ""}`);
