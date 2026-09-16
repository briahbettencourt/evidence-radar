"use strict";

/**
 * Curated topic queries.
 *
 * This file is the substance of the project. Searching a literature database is
 * easy; searching it in a way that returns consumer-relevant evidence instead of
 * clinical noise is the hard part.
 *
 * Each topic is a hand-tuned set of terms matched against title and abstract.
 * Broad terms like "all-cause mortality" alone pull in cardiology trials that are
 * real research but useless to someone writing about sleep or protein intake, so
 * every topic pairs an intervention/behaviour term with its outcome term.
 *
 * `exclude` removes recurring false positives observed during testing.
 *
 * Disagree with a query? That is the useful kind of contribution. Open an issue.
 */

const TOPICS = {
  // Behaviour-first, deliberately. Sleep medicine is dominated by apnoea and CPAP
  // research, which crowded out everything a reader can actually act on. Apnoea is
  // now excluded rather than included: it is a diagnosis that belongs with a doctor,
  // not a habit anyone changes after reading a newsletter.
  sleep: {
    label: "Sleep",
    include: [
      "sleep duration", "sleep quality", "sleep hygiene", "sleep regularity",
      "sleep timing", "sleep efficiency", "sleep extension", "sleep restriction",
      "insomnia", "CBT-I", "circadian rhythm", "chronotype",
      "social jetlag", "social jet lag", "daytime napping", "bright light therapy",
    ],
    exclude: [
      "anaesthesia", "anesthesia", "sedation", "intensive care", "ventilator",
      "obstructive sleep apnoea", "obstructive sleep apnea",
      "continuous positive airway pressure", "CPAP",
      "transcranial", "electroencephalographic",
    ],
  },

  recovery: {
    label: "Recovery & stress",
    include: [
      "heart rate variability", "cortisol awakening", "allostatic load",
      "perceived stress", "overtraining", "recovery from exercise",
      "cold water immersion", "sauna bathing", "mindfulness intervention",
    ],
    exclude: ["postoperative", "post-surgical", "rehabilitation after stroke"],
  },

  nutrition: {
    label: "Nutrition",
    include: [
      "dietary fibre", "dietary fiber", "protein intake", "dietary pattern",
      "mediterranean diet", "ultra-processed food", "time-restricted eating",
      "intermittent fasting", "gut microbiome diet", "added sugar",
    ],
    exclude: ["parenteral nutrition", "enteral feeding", "infant formula", "livestock"],
  },

  fitness: {
    label: "Fitness & strength",
    include: [
      "resistance training", "grip strength", "muscle strength", "sarcopenia",
      "VO2max", "cardiorespiratory fitness", "zone 2", "aerobic training",
      "physical activity guidelines", "sedentary behaviour", "sedentary behavior",
    ],
    exclude: ["elite athletes", "professional football", "rehabilitation protocol"],
  },

  longevity: {
    label: "Longevity & healthspan",
    include: [
      "healthspan", "biological aging", "biological ageing", "epigenetic clock",
      "frailty index", "successful aging", "successful ageing", "centenarian",
      "age-related decline",
    ],
    exclude: ["caenorhabditis", "drosophila", "mouse model", "in vitro", "zebrafish"],
  },

  supplements: {
    label: "Supplements",
    include: [
      "creatine supplementation", "vitamin D supplementation", "omega-3 supplementation",
      "magnesium supplementation", "nicotinamide riboside", "NMN supplementation",
      "collagen supplementation", "probiotic supplementation",
    ],
    exclude: ["livestock", "poultry", "aquaculture", "in vitro"],
  },
};

/**
 * Clinical-population exclusions, applied to every topic.
 *
 * The literature is written by clinicians, so a general-wellness query returns
 * studies in disease populations: diabetic nephropathy, coronary heart disease,
 * dialysis cohorts. That research is real and often excellent, but a finding in
 * patients with type 1 diabetes does not transfer to a general reader, and
 * implying it does is exactly the failure mode this project exists to avoid.
 *
 * Testing "nutrition" without these returned 6 of 10 results in clinical
 * populations.
 */
const CLINICAL_EXCLUSIONS = [
  "type 1 diabetes", "type 2 diabetes", "diabetic nephropathy", "diabetic retinopathy",
  "coronary heart disease", "heart failure", "dialysis", "chronic kidney disease",
  "cancer patients", "chemotherapy", "post-transplant", "critically ill",
  "cirrhosis", "COPD", "rheumatoid arthritis", "multiple sclerosis",
  "bariatric surgery", "schizophrenia",
  "spinal cord injury", "steatotic liver disease", "NAFLD", "stroke survivors",
];

/**
 * Study designs, best evidence first. A newsletter that treats a mouse study and
 * a meta-analysis as equivalent is worse than no newsletter, so grade is reported
 * alongside every finding rather than hidden behind a relevance score.
 */
const EVIDENCE_TIERS = [
  { tier: 1, label: "Meta-analysis / systematic review", match: ["Meta-Analysis", "Systematic Review"] },
  { tier: 2, label: "Randomised controlled trial", match: ["Randomized Controlled Trial", "Clinical Trial"] },
  { tier: 3, label: "Observational / cohort", match: ["Observational Study", "Comparative Study"] },
  { tier: 4, label: "Review / other", match: ["Review", "Journal Article", "research-article"] },
];

function buildQuery(topicKey, { days = 90, tiers = [1, 2], clinical = true } = {}) {
  const topic = TOPICS[topicKey];
  if (!topic) throw new Error(`Unknown topic "${topicKey}". Known: ${Object.keys(TOPICS).join(", ")}`);

  const inc = topic.include.map((t) => `TITLE_ABS:"${t}"`).join(" OR ");
  const excludeTerms = [...(topic.exclude || []), ...(clinical ? CLINICAL_EXCLUSIONS : [])];
  const exc = excludeTerms.map((t) => `NOT TITLE_ABS:"${t}"`).join(" ");

  const types = EVIDENCE_TIERS.filter((t) => tiers.includes(t.tier))
    .flatMap((t) => t.match)
    .map((m) => `PUB_TYPE:"${m}"`)
    .join(" OR ");

  const to = new Date();
  const from = new Date(Date.now() - days * 864e5);
  const fmt = (d) => d.toISOString().slice(0, 10);

  return `(${inc}) AND (${types}) AND (FIRST_PDATE:[${fmt(from)} TO ${fmt(to)}]) ${exc}`.trim();
}

function gradeOf(pubTypes = []) {
  for (const tier of EVIDENCE_TIERS) {
    if (pubTypes.some((p) => tier.match.some((m) => p.toLowerCase() === m.toLowerCase()))) {
      return tier;
    }
  }
  return EVIDENCE_TIERS[EVIDENCE_TIERS.length - 1];
}

module.exports = { TOPICS, EVIDENCE_TIERS, CLINICAL_EXCLUSIONS, buildQuery, gradeOf };
