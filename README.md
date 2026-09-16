# Evidence Radar

Tracks new research in health, wellness and longevity, graded by study design.

It returns **evidence to read**, not conclusions to repeat. There is no AI summarisation, no "key takeaway" generation, and no attempt to tell you what a study means. Those are the parts that go wrong, and in health writing they go wrong expensively.

```bash
node bin/cli.js sleep --days 120
```

```
EVIDENCE RADAR — SLEEP
Window: last 120 days
Matches: 402   Showing: 8   (13 filtered as off-topic)

— Meta-analysis / systematic review —
  Effectiveness of homeopathic interventions for insomnia and sleep disorders: A systematic review and meta-analysis
    Complementary therapies in medicine · 2026-08-04 · paywalled
    https://doi.org/10.1016/j.ctim.2026.103413
  Electroencephalographic correlates of sleepiness: A meta-analysis and narrative review
    Sleep medicine · 2026-07-28 · paywalled
    https://doi.org/10.1016/j.sleep.2026.109180
```

---

## Why this exists

Searching a literature database is easy. Searching it so it returns something a wellness writer can actually use is not.

Two things make the difference, and they are the whole project:

**1. Study design is reported, never hidden.** Every finding is labelled meta-analysis, RCT, observational, or review, and results are ranked by that first. A newsletter that treats a mouse study and a meta-analysis as equivalent is worse than no newsletter.

**2. Topic queries are curated, not generic.** Broad terms return clinical noise. Searching "all-cause mortality" gives you cardiology trials; searching "sleep" gives you anaesthesia papers. Each topic in [`src/topics.js`](src/topics.js) pairs behaviour terms with outcome terms and excludes recurring false positives found during testing.

---

## Topics

`sleep` · `recovery` · `nutrition` · `fitness` · `longevity` · `supplements`

Each is a hand-tuned query, not a keyword. The queries are the substance of this repo and they are meant to be argued with.

## Evidence tiers

| Tier | Design | Ranked |
|---|---|---|
| 1 | Meta-analysis / systematic review | first |
| 2 | Randomised controlled trial | second |
| 3 | Observational / cohort | third |
| 4 | Review / other | last |

A high tier means a **stronger design**, not a correct conclusion. A well-conducted meta-analysis of weak studies is still weak.

---

## Honest limitations

**Results still skew clinical, and the fix is partial.** The literature is written by clinicians, so a general-wellness query returns studies in disease populations — dialysis cohorts, diabetic nephropathy, post-transplant. A finding in patients with type 1 diabetes does not transfer to a general reader, and implying it does is the failure mode this project exists to avoid. `CLINICAL_EXCLUSIONS` in `topics.js` now filters the recurring ones, but it is a hand-maintained list, which means it is whack-a-mole: measured on a nutrition scan it lifted usable results from roughly 2–3 in 10 to 6 in 10, while a sleep scan is still only about 3 in 8. Refining `topics.js` is the most useful contribution anyone could make here.

**One term can monopolise a topic.** Search volume is wildly uneven — an early nutrition scan gave 6 of 10 slots to Mediterranean diet alone, burying fibre, time-restricted eating and ultra-processed food. Results are now capped per matched term (`--per-term`, default 2) and drawn round-robin, and each finding reports which term it matched so you can see why it was returned. Set `--per-term 99` for the old behaviour.

**Title filtering trades recall for precision.** Europe PMC matches title *and* abstract, so a cardiology trial mentioning sleep once ranks alongside a real sleep study. Testing returned "aromatherapy for menopausal symptoms" under sleep. The filter requires a topic term in the **title**, which cuts noise sharply but will occasionally drop a relevant paper whose title is oblique. Use `--loose` to disable it.

**It finds papers, it does not read them.** Roughly half are paywalled. Open access is flagged so you know what you can actually verify before citing.

**Recency is not importance.** A 90-day window surfaces what is new, which is not the same as what matters. Most durable health advice is decades old.

---

## Usage

Node 18+ (needs built-in `fetch`). No dependencies. No API key — [Europe PMC](https://europepmc.org/) is free and open.

```bash
node bin/cli.js sleep                         # last 90 days, meta-analyses + RCTs
node bin/cli.js nutrition --days 30 --md      # markdown, last month
node bin/cli.js longevity --tiers 1 --limit 10  # meta-analyses only
node bin/cli.js fitness --md --abstracts > fitness.md
node bin/cli.js recovery --loose              # no title filter, more noise
node bin/cli.js nutrition --per-term 1        # maximum topic spread, one paper per term
```

As a library:

```js
const { scanTopic, toMarkdown } = require("./src/radar");
const report = await scanTopic("sleep", { days: 60, tiers: [1, 2] });
console.log(toMarkdown(report));
```

---

## Adding a topic

Add an entry to `TOPICS` in [`src/topics.js`](src/topics.js):

```js
mytopic: {
  label: "My topic",
  include: ["specific phrase", "another phrase"],
  exclude: ["false positive you keep seeing"],
}
```

Pair the intervention with its outcome. Single broad words return noise.

## Contributing

The queries are judgment calls, not a standard. If a topic returns junk, or misses obvious work, open an issue with the query and what it returned. Arguing about the search terms in public is more valuable to this project than quietly shipping results nobody can audit.

## License

MIT. Built for [The Sanctuary Collective](https://sanctuarycollective.site), an evidence-led health and longevity publication.

Not medical advice. This tool surfaces research; interpreting it is a job for you and, where it matters, a qualified clinician.
