/* SupplementCheck static site generator
   Reads data/raw/*.json (openFDA enforcement) -> writes /docs (GitHub Pages).
   Zero dependencies. Run: node build.js */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DOCS = path.join(ROOT, "docs");
const DATA = path.join(ROOT, "data", "raw");

const CFG = { name: "SupplementCheck", origin: "https://anmtal.github.io", base: "/supplementcheck", newsletter: "" };
// CFG.newsletter: paste your email provider's form POST action URL to activate signups,
// e.g. Kit/ConvertKit: https://app.kit.com/forms/<FORM_ID>/subscriptions — then rebuild.
const SITE = CFG.origin + CFG.base;        // absolute site root
const BP = CFG.base;                        // path prefix for internal links
const BUILD = new Date().toISOString().slice(0, 10);

/* ---------------- helpers ---------------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const url = (p) => BP + p;
const abs = (p) => SITE + p;
const truncate = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1).trim() + "…" : s; };
function slugify(s) {
  return String(s || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "item";
}
function fmtDate(yyyymmdd) {
  if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return { iso: "", human: "Date not reported" };
  const y = yyyymmdd.slice(0, 4), m = yyyymmdd.slice(4, 6), d = yyyymmdd.slice(6, 8);
  const iso = `${y}-${m}-${d}`;
  const human = new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  return { iso, human };
}
function cleanName(desc) {
  let s = String(desc || "").replace(/\s+/g, " ").trim();
  const cuts = [/ dietary supplement/i, /,/, / ndc/i, / upc/i, / net wt/i, / net weight/i, / \d+ (count|ct|capsule|tablet|softgel|caplet|veg|bottle)/i, / lot/i, / distributed/i, / manufactured/i, / packaged/i, /;/, / \(/];
  let cut = s.length;
  for (const re of cuts) { const m = s.search(re); if (m > 8 && m < cut) cut = m; }
  s = s.slice(0, cut).trim();
  if (s.length > 88) s = s.slice(0, 88).trim() + "…";
  if (!s || s.length < 3) s = truncate(String(desc || "Dietary supplement"), 60);
  return s;
}

/* ---------------- categorize + tag ---------------- */
const CATS = {
  "weight-loss": { name: "Weight-loss supplements", emoji: "🔥", blurb: "Fat-burners, diet pills and detox teas — the category most often caught with hidden drugs." },
  "sexual-enhancement": { name: "Sexual-enhancement supplements", emoji: "💊", blurb: "‘Male enhancement’ products frequently spiked with undeclared prescription ED drugs." },
  "sports-bodybuilding": { name: "Sports & bodybuilding", emoji: "🏋️", blurb: "Pre-workouts, test boosters, protein and muscle-builders." },
  "vitamins-minerals": { name: "Vitamins & minerals", emoji: "🧬", blurb: "Everyday vitamins and mineral supplements." },
  "herbal-botanical": { name: "Herbal & botanical", emoji: "🌿", blurb: "Herbal extracts, roots, teas and botanicals." },
  "other": { name: "Other supplements", emoji: "📦", blurb: "General and uncategorized dietary supplements." }
};
function categorize(name) {
  const s = name.toLowerCase();
  if (/(weight|slim|burn|keto|fat\b|diet|thermogenic|lean|detox|garcinia)/.test(s)) return "weight-loss";
  if (/(male|sexual|erection|libido|stamina|rhino|stiff|enhance|virility|testosterone booster)/.test(s)) return "sexual-enhancement";
  if (/(pre.?workout|muscle|creatine|protein|mass\b|anabolic|bodybuild|\bsport|pump|whey|bcaa|test\b)/.test(s)) return "sports-bodybuilding";
  if (/(vitamin|mineral|\biron\b|calcium|magnesium|zinc|b12|b-12|multivitamin|folic|biotin|omega)/.test(s)) return "vitamins-minerals";
  if (/(herbal|botanical|extract|root|ginseng|turmeric|ashwagandha|kratom|\btea\b|ginkgo|echinacea|elderberry)/.test(s)) return "herbal-botanical";
  return "other";
}
const TAGS = {
  hiddenDrug: { label: "Hidden drug ingredient", verdict: "Flagged — hidden drug ingredient", level: "flag",
    guidance: "Stop using this product. The FDA found an undeclared active pharmaceutical ingredient, which can be dangerous and interact with prescription medicines. Report any reaction to FDA MedWatch and speak with your doctor." },
  contamination: { label: "Contamination", verdict: "Recalled — contamination", level: "flag",
    guidance: "Stop using the affected lots. Contamination (bacteria, mold or heavy metals) can cause illness. Check the recall lot numbers, contact the firm for a refund, and report any reaction to FDA MedWatch." },
  allergen: { label: "Undeclared allergen", verdict: "Recalled — undeclared allergen", level: "caution",
    guidance: "If you have the allergy named in the recall, do not consume this product — an undeclared allergen can trigger a serious reaction. If you don’t have that allergy, the specific risk from this recall is low." },
  other: { label: "Labeling / quality issue", verdict: "Recalled by the FDA", level: "caution",
    guidance: "Review the recall details and lot numbers below. Contact the recalling firm for a refund or replacement, and when in doubt, stop use and consult your doctor." }
};
function tagFor(reason, classification) {
  const s = String(reason || "").toLowerCase();
  if (/(sildenafil|tadalafil|vardenafil|sibutramine|fluoxetine|phenolphthalein|dexamethasone|analog|active pharmaceutical|drug ingredient|unapproved.*drug|\bdmaa\b|\bdmha\b|anabolic|\bsteroid|prescription drug|hydroxythiohomosildenafil|desmethyl)/.test(s)) return "hiddenDrug";
  if (/(salmonella|listeria|e\.? ?coli|microbial|bacteria|\bmold\b|yeast|\blead\b|arsenic|cadmium|mercury|heavy metal|contaminat|pathogen|botulism|coliform|foreign material)/.test(s)) return "contamination";
  if (/(allergen|undeclared (milk|egg|soy|peanut|wheat|tree ?nut|fish|shellfish|sesame|almond|cashew|walnut|hazelnut|coconut|gluten|sulfite)|contains (milk|egg|soy|peanut|wheat|sesame))/.test(s)) return "allergen";
  return "other";
}
function classMeaning(c) {
  if (/I{3}/.test(c) || /III/.test(c)) return "Class III — unlikely to cause harm, usually a labeling issue.";
  if (/II/.test(c)) return "Class II — may cause temporary or medically reversible harm.";
  if (/\bI\b|Class I/.test(c)) return "Class I — the most serious: reasonable probability of serious harm or death.";
  return "FDA recall classification.";
}

/* ---------------- load + normalize ---------------- */
function loadSet(file, source) {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) { console.warn("Missing " + file); return []; }
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  return (j.results || []).map((r) => ({ ...r, __source: source }));
}
const raw = [...loadSet("food_enforcement.json", "food"), ...loadSet("drug_enforcement.json", "drug")];

const seenSlug = new Set();
const items = [];
for (const r of raw) {
  if (!r.product_description) continue;
  const name = cleanName(r.product_description);
  const tag = tagFor(r.reason_for_recall, r.classification);
  const meta = TAGS[tag];
  const cat = categorize(name);
  const initiated = fmtDate(r.recall_initiation_date);
  const reported = fmtDate(r.report_date);
  let slug = slugify(name);
  const suffix = "-" + String(r.recall_number || Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/gi, "").slice(-5).toLowerCase();
  slug = (slug + suffix).slice(0, 80);
  while (seenSlug.has(slug)) slug += "x";
  seenSlug.add(slug);
  items.push({
    slug, name, firm: r.recalling_firm || "Unknown firm", cat, tag,
    verdict: meta.verdict, level: meta.level, guidance: meta.guidance, tagLabel: meta.label,
    reason: (r.reason_for_recall || "No reason on file.").replace(/\s+/g, " ").trim(),
    classification: r.classification || "", classMeaning: classMeaning(r.classification || ""),
    status: r.status || "", recall_number: r.recall_number || "", source: r.__source,
    origin: [r.city, r.state].filter(Boolean).join(", "),
    distribution: (r.distribution_pattern || "").replace(/\s+/g, " ").trim(),
    initiated, reported, sortDate: initiated.iso || reported.iso || "0000-00-00",
    productType: r.product_type || ""
  });
}
items.sort((a, b) => (b.sortDate < a.sortDate ? -1 : b.sortDate > a.sortDate ? 1 : 0));

const byCat = {}; Object.keys(CATS).forEach((k) => (byCat[k] = []));
items.forEach((it) => byCat[it.cat].push(it));
const LISTS = {
  "supplements-recalled-for-hidden-drug-ingredients": { title: "Supplements recalled for hidden drug ingredients", tag: "hiddenDrug",
    intro: "These dietary supplements were recalled or flagged by the U.S. FDA after testing revealed <strong>undeclared, active pharmaceutical drugs</strong> hidden inside them — things like sibutramine (a withdrawn weight-loss drug) or sildenafil (the active ingredient in Viagra). None of these were listed on the label. Every entry links to its official FDA recall record." },
  "supplements-recalled-for-contamination": { title: "Supplements recalled for contamination", tag: "contamination",
    intro: "These supplements were recalled after the FDA or the manufacturer found <strong>contamination</strong> — bacteria such as Salmonella or Listeria, mold, or heavy metals like lead. Check the affected lot numbers on each record." },
  "supplements-recalled-for-undeclared-allergens": { title: "Supplements recalled for undeclared allergens", tag: "allergen",
    intro: "These supplements were recalled because they contained an <strong>allergen that was not declared on the label</strong> — such as milk, soy, egg, peanuts or tree nuts. If you have one of the listed allergies, these are worth checking." }
};
const stats = {
  total: items.length,
  hidden: items.filter((i) => i.tag === "hiddenDrug").length,
  recentYear: items.filter((i) => i.sortDate >= (new Date().getFullYear() - 1) + "-01-01").length
};

/* ---------------- chrome ---------------- */
const icon = (lvl) => (lvl === "flag" ? "🔴" : lvl === "caution" ? "🟡" : "🟢");
const LOGO = '<span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg></span>';

function head({ title, desc, pathname, jsonld, ogtype }) {
  const canonical = abs(pathname);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="${ogtype || "website"}">
<meta property="og:site_name" content="${CFG.name}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${abs("/assets/og.svg")}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${url("/assets/favicon.svg")}" type="image/svg+xml">
<link rel="stylesheet" href="${url("/assets/style.css")}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ""}
<script>window.SC_BASE=${JSON.stringify(BP)};</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="ribbon">We mirror official FDA recall records — informational only, not medical advice. Every result links to its FDA source.</div>
<header class="topbar"><div class="wrap row">
  <a class="brand" href="${url("/")}">${LOGO}Supplement<b>Check</b></a>
  <div class="nav-search"><input class="js-search" type="search" placeholder="Search a supplement or brand…" aria-label="Search supplements"></div>
  <span class="spacer"></span>
  <a class="navlink" href="${url("/guides/")}">Guides</a>
  <a class="navlink" href="${url("/recalls/")}">All recalls</a>
  <a class="navlink" href="${url("/methodology/")}">Methodology</a>
  <button class="toggle" type="button" aria-label="Toggle dark mode">◐ Theme</button>
</div></header>
<main id="main">`;
}
function crumbs(arr) {
  return `<nav class="crumbs" aria-label="Breadcrumb">` +
    arr.map((c, i) => (c.href ? `<a href="${url(c.href)}">${esc(c.name)}</a>` : `<span>${esc(c.name)}</span>`) + (i < arr.length - 1 ? " ›" : "")).join(" ") +
    `</nav>`;
}
function breadcrumbLD(arr) {
  return { "@type": "BreadcrumbList", itemListElement: arr.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: abs(c.href || "/") })) };
}
function foot() {
  return `</main>
<footer><div class="wrap cols">
  <div>
    <a class="brand" href="${url("/")}" style="font-size:1rem">${LOGO}Supplement<b>Check</b></a>
    <p class="disclaim">We mirror public U.S. FDA recall records so you can check them in one place. We don’t test products or give medical advice, and we’re not affiliated with the FDA or NIH. Every result links to its official source and date. Not a substitute for your doctor.</p>
  </div>
  <div><h4>Browse</h4>
    <a href="${url("/recalls/")}">All FDA recalls</a>
    <a href="${url("/guides/")}">Safety guides</a>
    <a href="${url("/list/supplements-recalled-for-hidden-drug-ingredients/")}">Hidden-drug recalls</a>
    <a href="${url("/list/supplements-recalled-for-contamination/")}">Contamination recalls</a>
    <a href="${url("/list/supplements-recalled-for-undeclared-allergens/")}">Allergen recalls</a>
  </div>
  <div><h4>About</h4>
    <a href="${url("/about/")}">About</a>
    <a href="${url("/methodology/")}">Methodology & data</a>
    <a href="${url("/privacy/")}">Privacy policy</a>
    <a href="https://open.fda.gov/" rel="noopener">openFDA data</a>
    <a href="https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" rel="noopener nofollow">FDA recalls</a>
  </div>
</div></footer>
<script src="${url("/assets/app.js")}" defer></script>
</body></html>`;
}
function page(opts, body) { const inner = opts.full ? body : `<div class="wrap">${body}</div>`; return head(opts) + inner + foot(); }
function newsletterForm() {
  return CFG.newsletter
    ? `<form class="emailrow" action="${CFG.newsletter}" method="post" target="_blank"><input type="email" name="email_address" placeholder="you@email.com" aria-label="Email for recall alerts" required><button class="btn" type="submit">Get alerts</button></form>`
    : `<form class="emailrow" onsubmit="return false"><input type="email" placeholder="you@email.com" aria-label="Email for recall alerts"><button class="btn" type="submit">Get alerts</button></form><p class="faint" style="font-size:.72rem;margin-top:.4rem">Alerts activate once the email provider is connected.</p>`;
}

/* ---------------- write util ---------------- */
function write(rel, content) {
  const fp = path.join(DOCS, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content);
}

/* ---------------- page bodies ---------------- */
function feedItem(it) {
  return `<li><a href="${url("/product/" + it.slug + "/")}"><span class="fname">${icon(it.level)} ${esc(it.name)}</span><span class="fmeta">${esc(it.tagLabel)} · ${esc(it.firm)} · ${esc(it.initiated.human)}</span></a></li>`;
}
function homePage() {
  const recent = listRows(items.slice(0, 6), false);
  const catCards = Object.keys(CATS).map((k) => `<a class="card" href="${url("/category/" + k + "/")}"><div class="cn">${CATS[k].emoji} ${byCat[k].length} recalls</div><div class="ct">${esc(CATS[k].name)}</div><div class="cd">${esc(CATS[k].blurb)}</div></a>`).join("");
  const jsonld = { "@context": "https://schema.org", "@graph": [
    { "@type": "Organization", name: CFG.name, url: abs("/"), logo: abs("/assets/favicon.svg") },
    { "@type": "WebSite", name: CFG.name, url: abs("/"), potentialAction: { "@type": "SearchAction", target: abs("/recalls/?q={search_term_string}"), "query-input": "required name=search_term_string" } }
  ] };
  const body = `
<section class="hero"><div class="wrap">
  <span class="eyebrow">Free FDA safety lookup</span>
  <h1 class="h-xl serif">Is your supplement hiding something?</h1>
  <p class="lede">Search <strong>${stats.total.toLocaleString()}</strong> official U.S. FDA supplement recalls — including <strong>${stats.hidden}</strong> caught with hidden drug ingredients. Free, in ten seconds.</p>
  <div class="bigsearch"><input class="js-search" type="search" placeholder="Search a supplement or brand…" aria-label="Search supplements"><a class="btn" href="${url("/recalls/")}">Browse all</a></div>
  <div class="trustline"><span class="dot"></span> <span class="mono">SOURCE: openFDA · FDA enforcement reports</span> · updated ${BUILD}</div>
</div></section>
<section class="band alt"><div class="wrap">
  <div class="sec-head"><span class="pulse" aria-hidden="true"></span> <span class="eyebrow">Recently flagged</span></div>
  <div class="rows">${recent}</div>
  <p style="margin-top:1.2rem"><a href="${url("/recalls/")}">See all ${stats.total.toLocaleString()} recalls ›</a></p>
</div></section>
<section class="band"><div class="wrap">
  <span class="eyebrow">Browse by category</span>
  <h2 class="h-lg serif" style="margin:.5rem 0 1.4rem">Where the recalls cluster</h2>
  <div class="grid g-3">${catCards}</div>
</div></section>
<section class="band alt"><div class="wrap">
  <h2 class="h-lg serif" style="margin-bottom:1.4rem">Most-read lists</h2>
  <div class="grid g-3">
    <a class="card" href="${url("/list/supplements-recalled-for-hidden-drug-ingredients/")}"><div class="ct">🔴 Hidden drug ingredients</div><div class="cd">${stats.hidden} supplements the FDA caught spiked with undeclared drugs.</div></a>
    <a class="card" href="${url("/list/supplements-recalled-for-contamination/")}"><div class="ct">🧫 Contamination</div><div class="cd">Recalls for Salmonella, Listeria, mold and heavy metals.</div></a>
    <a class="card" href="${url("/list/supplements-recalled-for-undeclared-allergens/")}"><div class="ct">⚠️ Undeclared allergens</div><div class="cd">Hidden milk, soy, egg, peanut and tree-nut recalls.</div></a>
  </div>
</div></section>
<section class="band"><div class="wrap">
  <span class="eyebrow">Safety guides</span>
  <h2 class="h-lg serif" style="margin:.5rem 0 1.4rem">Learn the risks</h2>
  <div class="grid g-3">
    <a class="card" href="${url("/guides/lead-in-protein-powder/")}"><div class="ct">Lead in protein powder</div><div class="cd">What independent testing found &mdash; and how to pick a cleaner powder.</div></a>
    <a class="card" href="${url("/guides/banned-supplements/")}"><div class="ct">Banned supplement ingredients</div><div class="cd">Ephedra, DMAA, sibutramine and the ingredients the FDA restricts.</div></a>
    <a class="card" href="${url("/guides/third-party-tested-supplements/")}"><div class="ct">Third-party tested?</div><div class="cd">What NSF, USP and Informed Sport actually verify.</div></a>
  </div>
  <p style="margin-top:1.2rem"><a href="${url("/guides/")}">All safety guides &rsaquo;</a></p>
</div></section>`;
  write("index.html", page({ full: true, title: "SupplementCheck — Check any supplement’s FDA recall & safety record", desc: `Search ${stats.total.toLocaleString()} official FDA dietary-supplement recalls by product or brand — including ${stats.hidden} with hidden drug ingredients. Free and sourced.`, pathname: "/", jsonld }, body));
}

function productPage(it) {
  const related = byCat[it.cat].filter((x) => x.slug !== it.slug).slice(0, 6);
  const vclass = it.level === "flag" ? "v-flag" : "v-caution";
  const listSlug = it.tag === "hiddenDrug" ? "supplements-recalled-for-hidden-drug-ingredients" : it.tag === "contamination" ? "supplements-recalled-for-contamination" : it.tag === "allergen" ? "supplements-recalled-for-undeclared-allergens" : null;
  const crumbArr = [{ name: "Home", href: "/" }, { name: CATS[it.cat].name, href: "/category/" + it.cat + "/" }, { name: it.name }];
  const faqs = [
    { q: `Was ${it.name} recalled by the FDA?`, a: `Yes. ${it.name}, distributed by ${it.firm}, is listed in the FDA enforcement database under recall ${it.recall_number} (${it.classification || "classification on file"}), status: ${it.status || "on file"}.` },
    { q: `Why was ${it.name} recalled?`, a: it.reason },
    { q: `What should I do if I have it?`, a: it.guidance }
  ];
  const jsonld = { "@context": "https://schema.org", "@graph": [
    breadcrumbLD(crumbArr.map((c) => ({ name: c.name, href: c.href || ("/product/" + it.slug + "/") }))),
    { "@type": "Article", headline: truncate(it.name + " — FDA recall record", 110), description: truncate(it.reason, 200), datePublished: it.initiated.iso || it.reported.iso || undefined, dateModified: BUILD, image: abs("/assets/og.svg"), author: { "@type": "Organization", name: CFG.name }, publisher: { "@type": "Organization", name: CFG.name, logo: { "@type": "ImageObject", url: abs("/assets/favicon.svg") } }, mainEntityOfPage: abs("/product/" + it.slug + "/") },
    { "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }
  ] };
  const body = `${crumbs(crumbArr)}
<section>
<article class="report">
  <div class="rp-top"><div class="rp-img" aria-hidden="true">💊</div><div><h1 class="rp-title">${esc(it.name)}</h1><div class="rp-sub">${esc(it.firm)} · ${esc(CATS[it.cat].name)}</div></div></div>
  <div class="verdict ${vclass}"><div class="ring" aria-hidden="true">${it.level === "flag" ? "✕" : "!"}</div><div>
    <div class="vlabel">${icon(it.level)} ${esc(it.verdict.toUpperCase())}</div>
    <p class="vwhy">${esc(it.reason)}</p>
    <div class="stamp mono">SOURCE: openFDA / FDA enforcement · recall ${esc(it.recall_number)} · ${esc(it.initiated.human)} · <a href="https://api.fda.gov/${it.source}/enforcement.json?search=recall_number:%22${encodeURIComponent(it.recall_number)}%22" rel="noopener nofollow">view record ↗</a></div>
  </div></div>
  <div class="cells">
    <div class="cell"><div class="k">Recall classification</div><div class="v">${esc(it.classification || "On file")}</div><div class="d">${esc(it.classMeaning)}</div></div>
    <div class="cell"><div class="k">Issue type</div><div class="v">${esc(it.tagLabel)}</div><div class="d">Recall status: ${esc(it.status || "on file")}.</div></div>
    <div class="cell"><div class="k">Recalling firm</div><div class="v">${esc(it.firm)}</div><div class="d">Origin: ${esc(it.origin || "not reported")}.</div></div>
    <div class="cell"><div class="k">Where it was distributed</div><div class="v" style="font-size:.9rem;font-weight:600">${esc(truncate(it.distribution || "Not reported", 90))}</div><div class="d">Recall initiated ${esc(it.initiated.human)}.</div></div>
  </div>
  <div class="block"><h3>What this means &amp; what to do</h3><p class="sub" style="margin-bottom:0">${esc(it.guidance)}</p></div>
  <div class="block"><h3>Safer, third-party-tested alternatives <span class="spon">Sponsored</span></h3><p class="sub">Same category, independently lab-verified for purity. (Affiliate placeholders — wire to real programs.)</p>
    <div class="alt"><div class="ai" aria-hidden="true">✅</div><div><div class="an">NSF Certified alternative <span class="badge clean">NSF</span></div><div class="am">No proprietary blends · tested for heavy metals</div></div><span class="spacer" style="flex:1"></span><a class="btn ghost" href="#" rel="nofollow sponsored">View →</a></div>
    <div class="alt"><div class="ai" aria-hidden="true">✅</div><div><div class="an">USP Verified alternative <span class="badge clean">USP</span></div><div class="am">Full label transparency · third-party assay on file</div></div><span class="spacer" style="flex:1"></span><a class="btn ghost" href="#" rel="nofollow sponsored">View →</a></div>
  </div>
  <div class="block"><h3>Test what you already own <span class="spon">Sponsored</span></h3><p class="sub">Mail-in kits screen supplements for lead, arsenic, cadmium and mercury.</p><a class="btn full" href="#" rel="nofollow sponsored">Get an at-home heavy-metal test kit →</a></div>
  <div class="block"><h3>🔔 Get new FDA recall alerts</h3><p class="sub">We email you when the FDA flags new supplement recalls. Free — unsubscribe anytime.</p>${newsletterForm()}</div>
  <div class="block"><h3>Frequently asked</h3>${faqs.map((f) => `<div class="faqq">${esc(f.q)}</div><div class="faqa">${esc(f.a)}</div>`).join("")}</div>
</article>
<div class="srcbar mono"><span>SOURCE ↗</span><span>openFDA ${esc(it.source)}/enforcement</span><span>Recall ${esc(it.recall_number)}</span><span>Reported ${esc(it.reported.human)}</span></div>
</section>
${related.length ? `<section><h2 class="h-md" style="margin-bottom:.8rem">More ${esc(CATS[it.cat].name.toLowerCase())} recalls</h2><div class="rows">${related.map((r) => `<a class="lrow" href="${url("/product/" + r.slug + "/")}"><span class="rank">${icon(r.level)}</span><span class="grow"><span class="ln">${esc(r.name)}</span><span class="lm">${esc(r.tagLabel)} · ${esc(r.firm)}</span></span><span class="badge ${r.level === "flag" ? "flag" : "caution"}">${esc(r.classification || "Recall")}</span></a>`).join("")}</div></section>` : ""}`;
  const title = truncate(`${it.name} recall — FDA safety record | ${CFG.name}`, 65);
  const desc = truncate(`${it.name} by ${it.firm}: ${it.verdict}. FDA recall ${it.recall_number} (${it.classification}). Reason: ${it.reason}`, 155);
  write("product/" + it.slug + "/index.html", page({ title, desc, pathname: "/product/" + it.slug + "/", jsonld, ogtype: "article" }, body));
}

function listRows(list, withRank) {
  return list.map((r, i) => `<a class="lrow" href="${url("/product/" + r.slug + "/")}" data-name="${esc((r.name + " " + r.firm).toLowerCase())}">${withRank ? `<span class="rank">${i + 1}</span>` : `<span class="rank">${icon(r.level)}</span>`}<span class="grow"><span class="ln">${esc(r.name)}</span><span class="lm">${esc(r.firm)} · ${esc(r.tagLabel)} · ${esc(r.initiated.human)}</span></span><span class="badge ${r.level === "flag" ? "flag" : "caution"}">${esc(r.classification || "Recall")}</span></a>`).join("");
}
function categoryPage(key) {
  const c = CATS[key]; const list = byCat[key];
  const crumbArr = [{ name: "Home", href: "/" }, { name: c.name }];
  const jsonld = { "@context": "https://schema.org", "@graph": [ breadcrumbLD([{ name: "Home", href: "/" }, { name: c.name, href: "/category/" + key + "/" }]),
    { "@type": "CollectionPage", name: c.name + " recalled by the FDA", url: abs("/category/" + key + "/"), description: c.blurb } ] };
  const body = `${crumbs(crumbArr)}
<section><div class="eyebrow">${c.emoji} Category</div><h1 class="h-lg serif" style="margin:.4rem 0">${esc(c.name)} recalled by the FDA</h1>
<p class="lede">${esc(c.blurb)} We’re tracking <strong>${list.length}</strong> FDA recall${list.length === 1 ? "" : "s"} in this category. Each links to its official record.</p></section>
<section><div class="rows">${listRows(list, false) || '<div class="lrow">No recalls on file yet.</div>'}</div></section>`;
  write("category/" + key + "/index.html", page({ title: truncate(`${c.name} recalled by the FDA (${list.length}) | ${CFG.name}`, 65), desc: truncate(`${c.blurb} Browse ${list.length} FDA recalls of ${c.name.toLowerCase()}, each linked to its official source.`, 155), pathname: "/category/" + key + "/", jsonld }, body));
}
function listPage(slug) {
  const L = LISTS[slug]; const list = items.filter((i) => i.tag === L.tag);
  const shown = list.slice(0, 60);
  const crumbArr = [{ name: "Home", href: "/" }, { name: L.title }];
  const jsonld = { "@context": "https://schema.org", "@graph": [ breadcrumbLD([{ name: "Home", href: "/" }, { name: L.title, href: "/list/" + slug + "/" }]),
    { "@type": "Article", headline: L.title, datePublished: BUILD, dateModified: BUILD, image: abs("/assets/og.svg"), author: { "@type": "Organization", name: CFG.name }, publisher: { "@type": "Organization", name: CFG.name, logo: { "@type": "ImageObject", url: abs("/assets/favicon.svg") } } },
    { "@type": "ItemList", numberOfItems: list.length, itemListElement: shown.map((r, i) => ({ "@type": "ListItem", position: i + 1, url: abs("/product/" + r.slug + "/"), name: r.name })) } ] };
  const body = `${crumbs(crumbArr)}
<section><div class="eyebrow">FDA recall list</div><h1 class="h-lg serif" style="margin:.4rem 0">${esc(L.title)}</h1>
<p class="lede">${L.intro}</p><p class="faint" style="margin-top:.5rem">${list.length} total · showing the ${Math.min(60, list.length)} most recent · sourced from openFDA · updated ${BUILD}</p></section>
<section><div class="rows">${listRows(shown, true) || '<div class="lrow">None on file yet.</div>'}</div>
${list.length > 60 ? `<p class="faint" style="margin-top:1rem"><a href="${url("/recalls/")}">See all ${stats.total.toLocaleString()} recalls →</a></p>` : ""}</section>`;
  write("list/" + slug + "/index.html", page({ title: truncate(`${L.title} (${list.length}) | ${CFG.name}`, 65), desc: truncate(`${L.title}: ${list.length} FDA-recalled supplements, each linked to its official record. Updated ${BUILD}.`, 155), pathname: "/list/" + slug + "/", jsonld, ogtype: "article" }, body));
}
function recallsPage() {
  const crumbArr = [{ name: "Home", href: "/" }, { name: "All recalls" }];
  const jsonld = { "@context": "https://schema.org", "@graph": [ breadcrumbLD([{ name: "Home", href: "/" }, { name: "All recalls", href: "/recalls/" }]),
    { "@type": "CollectionPage", name: "All FDA dietary supplement recalls", url: abs("/recalls/") } ] };
  const body = `${crumbs(crumbArr)}
<section><div class="eyebrow">Full database</div><h1 class="h-lg serif" style="margin:.4rem 0">All FDA dietary-supplement recalls</h1>
<p class="lede">Every recall in our database, newest first — ${stats.total.toLocaleString()} in total, from the official openFDA enforcement feed.</p>
<div class="filterbar" style="margin-top:1.2rem"><input id="rowfilter" type="search" placeholder="Filter by product or brand…" aria-label="Filter recalls"><span class="faint" id="rowcount">${stats.total.toLocaleString()} results</span></div>
<div class="rows">${listRows(items, false)}</div></section>`;
  write("recalls/index.html", page({ title: truncate(`All FDA supplement recalls (${stats.total.toLocaleString()}) | ${CFG.name}`, 65), desc: `Searchable list of ${stats.total.toLocaleString()} official FDA dietary-supplement recalls — hidden drugs, contamination and allergens. Sourced from openFDA.`, pathname: "/recalls/", jsonld }, body));
}
function staticPage(slug, title, h1, html) {
  const crumbArr = [{ name: "Home", href: "/" }, { name: h1 }];
  const jsonld = { "@context": "https://schema.org", "@graph": [ breadcrumbLD([{ name: "Home", href: "/" }, { name: h1, href: "/" + slug + "/" }]) ] };
  const body = `${crumbs(crumbArr)}<section><h1 class="h-lg serif" style="margin:.4rem 0 1rem">${esc(h1)}</h1><div class="prose">${html}</div></section>`;
  write(slug + "/index.html", page({ title: truncate(title + " | " + CFG.name, 65), desc: truncate(title + " — how SupplementCheck sources and presents official FDA supplement-recall data.", 155), pathname: "/" + slug + "/", jsonld }, body));
}

/* ---------------- guides (SEO content cluster) ---------------- */
function affiliateBlock() {
  return `<div class="notice"><strong>Sponsored:</strong> at-home heavy-metal test kits screen supplements for lead, arsenic, cadmium and mercury, and NSF/USP-certified brands publish their lab results. <a href="#" rel="nofollow sponsored">Compare tested options &rarr;</a></div>`;
}
function relatedRows(filterFn, n) {
  const list = items.filter(filterFn).slice(0, n || 6);
  return list.length ? `<div class="rows">${listRows(list, false)}</div>` : "";
}
const HEAVY = (it) => /lead|heavy metal|arsenic|cadmium|mercury|contaminat/i.test(it.reason);
const GUIDES = [
  {
    slug: "lead-in-protein-powder", h1: "Lead in Protein Powder: What the Testing Found",
    title: "Lead in Protein Powder — What Testing Found (2026)",
    desc: "Independent testing found lead in most protein powders. Here's which types carry the most, how much is too much, and how to check your brand.",
    related: HEAVY, relatedHeading: "Supplement recalls for contamination",
    body: `
<p class="lede">A 2025 <strong>Consumer Reports</strong> investigation tested popular protein powders and found roughly <strong>two-thirds exceeded its own daily limit for lead</strong> &mdash; some by more than 1,000%. Lead is a neurotoxin with no known safe level, and daily users accumulate the most exposure. Here's what that means and how to protect yourself.</p>
<h2>Why is there lead in protein powder at all?</h2>
<p>Lead isn't added on purpose &mdash; it's a contaminant. Plants pull heavy metals (lead, cadmium, arsenic) up from soil and water, so the raw ingredients carry trace amounts before they're ever processed. That's why <strong>plant-based powders</strong> (pea, rice, hemp, soy) and <strong>chocolate/cacao-flavored</strong> powders tend to test highest &mdash; cocoa is a well-known lead and cadmium accumulator. "Organic" does not automatically mean lower.</p>
<h2>How much is too much?</h2>
<p>There is no FDA limit for lead in supplements specifically. For reference, California's Prop 65 warning threshold is about <strong>0.5 micrograms of lead per day</strong>, and Consumer Reports uses a similar benchmark. The real issue is <em>cumulative</em>: a scoop or two every day, for years, adds up in a way a single serving does not.</p>
<h2>How to lower your exposure</h2>
<ul>
<li><strong>Choose third-party-tested products</strong> &mdash; NSF, USP or Informed Sport test finished products for heavy metals. <a href="${url("/guides/third-party-tested-supplements/")}">How to verify a certification &rarr;</a></li>
<li><strong>Prefer whey over plant-based</strong>, and <strong>vanilla/unflavored over chocolate</strong>, if lead is your concern.</li>
<li><strong>Rotate protein sources</strong> and don't exceed the serving size.</li>
<li><strong>Test what you own</strong> &mdash; mail-in kits screen for lead, arsenic, cadmium and mercury.</li>
</ul>
${affiliateBlock()}`,
    faqs: [
      { q: "Is the lead in protein powder actually dangerous?", a: "Lead has no known safe level, and daily protein-powder users get repeated exposure that accumulates over time. Occasional use is lower risk; the concern is heavy, long-term daily use, especially for children, teens, and pregnant people." },
      { q: "Which protein powder has the least lead?", a: "In independent testing, whey-based and vanilla/unflavored powders generally tested lower than plant-based and chocolate/cacao-flavored ones. The most reliable signal is a third-party certification (NSF, USP, Informed Sport) that tests for heavy metals." },
      { q: "How do I know if my protein powder was tested for heavy metals?", a: "Look for an NSF, NSF Certified for Sport, USP Verified, or Informed Sport mark, then confirm it in the certifier's public directory. A brand that publishes a Certificate of Analysis with heavy-metal results is a strong sign." }
    ]
  },
  {
    slug: "third-party-tested-supplements", h1: "Third-Party Tested Supplements: What NSF, USP & Informed Sport Mean",
    title: "Third-Party Tested Supplements: NSF, USP & Informed Sport",
    desc: "Supplements aren't FDA-approved before sale. Here's what NSF, USP and Informed Sport certifications actually verify, and how to check a product yourself.",
    related: (it) => it.tag === "hiddenDrug" || HEAVY(it), relatedHeading: "Why testing matters: recent recalls",
    body: `
<p class="lede">Dietary supplements are <strong>not approved by the FDA before they're sold</strong> &mdash; the agency mostly acts after something goes wrong. Third-party certification is the closest thing to independent proof that what's on the label is what's in the bottle, and that it's free of dangerous contaminants.</p>
<h2>What each seal actually verifies</h2>
<ul>
<li><strong>USP Verified</strong> &mdash; confirms identity, potency, and freedom from harmful levels of contaminants, made under good manufacturing practices.</li>
<li><strong>NSF Certified</strong> &mdash; tests that label claims match contents and screens for contaminants. <strong>NSF Certified for Sport</strong> adds screening for 280+ substances banned in sport.</li>
<li><strong>Informed Sport / Informed Choice</strong> &mdash; batch-level testing for banned substances, popular with athletes.</li>
</ul>
<h2>How to check a product</h2>
<p>Find the seal on the label, then confirm it in the certifier's public online directory (USP, NSF and Informed Sport all publish searchable lists). A seal printed on the label but missing from the directory is a red flag.</p>
<h2>Why it matters</h2>
<p>Independent testing repeatedly finds supplements with undeclared drugs, wrong doses, or heavy-metal contamination. Certification won't prove a supplement <em>works</em>, but it dramatically lowers the odds of a nasty surprise.</p>
${affiliateBlock()}`,
    faqs: [
      { q: "Does third-party tested mean FDA approved?", a: "No. The FDA does not approve supplements before sale. Third-party certification is independent testing by a private organization (USP, NSF, Informed Sport) and is separate from any government approval." },
      { q: "Is NSF or USP better?", a: "Both are well respected and test identity, potency and contaminants. NSF Certified for Sport and Informed Sport add banned-substance screening for athletes. Any of them beats an uncertified product." },
      { q: "How can I verify a certification is real?", a: "Search the certifier's official online directory for the exact product and manufacturer. If it isn't listed, treat the on-label seal with suspicion." }
    ]
  },
  {
    slug: "banned-supplements", h1: "Banned Supplement Ingredients: The FDA List",
    title: "Banned Supplements: Ingredients the FDA Has Restricted",
    desc: "A plain-English list of supplement ingredients the FDA has banned or warned about: ephedra, DMAA, DMHA, sibutramine and more, plus how to check your product.",
    related: (it) => it.tag === "hiddenDrug", relatedHeading: "Supplements recalled for hidden or banned ingredients",
    body: `
<p class="lede">The FDA can't approve supplements in advance, but it <em>can</em> ban ingredients once they're shown to be dangerous &mdash; and it regularly catches products spiked with drugs that were never declared on the label. Here are the big ones.</p>
<h2>Ingredients the FDA has banned or acted against</h2>
<ul>
<li><strong>Ephedra (ephedrine alkaloids)</strong> &mdash; banned in supplements in 2004 after deaths linked to weight-loss and energy products.</li>
<li><strong>DMAA and DMHA</strong> &mdash; stimulants the FDA says are illegal in supplements; common in pre-workout and weight-loss products.</li>
<li><strong>Sibutramine</strong> &mdash; a prescription weight-loss drug pulled from the US market in 2010, still found hidden in "natural" diet pills.</li>
<li><strong>Sildenafil and tadalafil</strong> &mdash; the active drugs in Viagra and Cialis, repeatedly found undeclared in "male enhancement" supplements.</li>
<li><strong>Phenolphthalein</strong> &mdash; a suspected carcinogen found hidden in some weight-loss products.</li>
<li><strong>BMPEA, picamilon, higenamine, SARMs</strong> &mdash; synthetic or pharmaceutical compounds the FDA has flagged as not legitimate dietary ingredients.</li>
</ul>
<h2>How to check your supplement</h2>
<p>Most of these turn up in <strong>weight-loss, sexual-enhancement and bodybuilding</strong> products. Search our database for your product, or browse the recalls below where the FDA found a hidden drug.</p>`,
    faqs: [
      { q: "How do I know if a supplement contains a banned ingredient?", a: "Check the FDA's tainted-products database, which we mirror here, for your product or brand. Banned stimulants and hidden drugs are most common in weight-loss, sexual-enhancement and muscle-building products." },
      { q: "Is DMAA illegal?", a: "The FDA considers DMAA an illegal ingredient in dietary supplements and has issued warning letters and seizures, though it still appears in some pre-workout and weight-loss products sold online." },
      { q: "Are these ingredients always on the label?", a: "Often not. Many are added secretly, which is exactly why the FDA's tainted-products list exists: the drug was found by lab testing, not declared on the label." }
    ]
  },
  {
    slug: "dangerous-supplements", h1: "The Most Dangerous Supplement Categories",
    title: "The Most Dangerous Supplements (and How to Check Yours)",
    desc: "Three supplement categories account for most FDA safety actions. Here's why weight-loss, sexual-enhancement and bodybuilding products are riskiest, and how to check.",
    related: (it) => ["weight-loss", "sexual-enhancement", "sports-bodybuilding"].includes(it.cat) && it.level === "flag",
    relatedHeading: "Recently flagged in high-risk categories",
    body: `
<p class="lede">Supplements aren't pre-approved, so risk isn't spread evenly &mdash; it concentrates in a few categories where the incentive to cheat is highest. If you take products from these three, a 10-second check is worth it.</p>
<h2>1. Weight-loss</h2>
<p>The category most often caught with hidden pharmaceuticals: withdrawn diet drugs like sibutramine, undeclared stimulants (DMAA/DMHA), and even laxatives and diuretics.</p>
<h2>2. Sexual enhancement</h2>
<p>"Male enhancement" pills are repeatedly found spiked with sildenafil or tadalafil &mdash; real prescription drugs that can be dangerous with heart medications or nitrates.</p>
<h2>3. Bodybuilding & pre-workout</h2>
<p>Muscle-builders and "test boosters" turn up with anabolic-steroid-like compounds, SARMs, and banned stimulants.</p>
<h2>How to check your product</h2>
<p>Search our database, or browse the categories most affected. When in doubt, look for a third-party testing seal and talk to your doctor.</p>`,
    faqs: [
      { q: "What makes a supplement dangerous?", a: "Usually one of three things: a hidden pharmaceutical drug, contamination (heavy metals or microbes), or an undeclared allergen. Weight-loss, sexual-enhancement and bodybuilding products account for most hidden-drug cases." },
      { q: "Are natural supplements safer?", a: "Not necessarily. 'Natural' and 'herbal' products are frequently the ones caught with hidden synthetic drugs, and botanicals can carry heavy metals. A third-party certification is a better signal than the word 'natural.'" },
      { q: "How can I report a bad reaction?", a: "Report it to the FDA's MedWatch program. Your report helps the FDA identify dangerous products and issue recalls." }
    ]
  },
  {
    slug: "heavy-metals-in-supplements", h1: "Heavy Metals in Supplements: Lead, Arsenic, Cadmium & Mercury",
    title: "Heavy Metals in Supplements: What to Know",
    desc: "Which supplements carry the most lead, arsenic, cadmium and mercury, the health effects, and how to lower your exposure with third-party testing.",
    related: HEAVY, relatedHeading: "Recalls for contamination",
    body: `
<p class="lede">Heavy metals are among the most common contaminants found in supplements &mdash; not added on purpose, but pulled from soil and water into the raw ingredients. Some product types carry far more than others.</p>
<h2>Where heavy metals show up most</h2>
<ul>
<li><strong>Protein powders</strong> &mdash; especially plant-based and chocolate. <a href="${url("/guides/lead-in-protein-powder/")}">See the protein-powder guide &rarr;</a></li>
<li><strong>Greens & superfood powders</strong> &mdash; concentrated plant material concentrates metals too.</li>
<li><strong>Herbal & Ayurvedic products</strong> &mdash; some have been found with high lead, occasionally added in traditional preparations.</li>
<li><strong>Rice-based products and kelp/seaweed</strong> &mdash; arsenic (rice) and metals/iodine (seaweed).</li>
</ul>
<h2>Why it matters</h2>
<p>Lead, arsenic, cadmium and mercury are cumulative toxins with no safe daily dose. Children, pregnant people and daily users are most at risk.</p>
<h2>How to lower your exposure</h2>
<p>Favor third-party-tested products, vary your sources, don't exceed serving sizes, and consider an at-home heavy-metal test.</p>
${affiliateBlock()}`,
    faqs: [
      { q: "Which supplements have the most heavy metals?", a: "Plant-based protein powders, greens/superfood powders, some herbal and Ayurvedic products, rice-based products (arsenic) and seaweed. Concentrated plant material tends to concentrate metals." },
      { q: "Can I remove heavy metals from a supplement?", a: "No. The practical steps are to choose third-party-tested products, vary your sources, and avoid exceeding serving sizes." },
      { q: "Are heavy metals in supplements regulated?", a: "There is no single FDA limit for most supplements. California's Prop 65 sets warning thresholds, and third-party certifiers (USP, NSF) test for heavy metals, which is why certification is a useful signal." }
    ]
  },
  {
    slug: "supplement-side-effects", h1: "Supplement Side Effects: What to Watch For",
    title: "Supplement Side Effects and How to Report Them",
    desc: "Common supplement side effects, dangerous drug interactions, who's most at risk, and how to report a reaction to the FDA.",
    related: (it) => it.tag === "hiddenDrug", relatedHeading: "Products recalled for undeclared drug ingredients",
    body: `
<p class="lede">Because supplements aren't tested for safety before sale, side effects and interactions often surface only after people are harmed. Here's what to watch for.</p>
<h2>Common and serious effects</h2>
<p>Mild effects include nausea, headaches and digestive upset. The serious ones &mdash; liver injury (some herbal and weight-loss products), heart palpitations and blood-pressure spikes (stimulant pre-workouts and diet pills), and bleeding risk (high-dose fish oil, vitamin E, ginkgo) &mdash; are the ones to take seriously.</p>
<h2>Dangerous interactions</h2>
<p>Supplements interact with prescription drugs: St. John's Wort weakens many medications, vitamin K affects blood thinners, and hidden sildenafil in "male enhancement" pills is dangerous with nitrates. Always tell your doctor what you take.</p>
<h2>Who's most at risk</h2>
<p>People on prescription medication, pregnant or breastfeeding people, children, and anyone with liver, kidney or heart conditions.</p>
<h2>How to report a reaction</h2>
<p>Report side effects to the <strong>FDA's MedWatch</strong> program. These reports feed the adverse-event database and help trigger recalls.</p>`,
    faqs: [
      { q: "Can supplements have serious side effects?", a: "Yes. Liver injury, heart and blood-pressure problems, bleeding risk, and dangerous drug interactions are all documented, especially with weight-loss, stimulant and herbal products." },
      { q: "How do I report a supplement side effect?", a: "Report it to the FDA's MedWatch program online. Your report is added to the adverse-event database the FDA uses to spot dangerous products." },
      { q: "Should I tell my doctor what supplements I take?", a: "Yes. Several supplements interact with prescription drugs (blood thinners, antidepressants, heart medications), so your doctor and pharmacist should know your full list." }
    ]
  }
];
function guidePage(g) {
  const base = "/guides/" + g.slug + "/";
  const crumbArr = [{ name: "Home", href: "/" }, { name: "Guides", href: "/guides/" }, { name: g.h1 }];
  const related = g.related ? relatedRows(g.related, 8) : "";
  const others = GUIDES.filter((x) => x.slug !== g.slug).slice(0, 4);
  const jsonld = { "@context": "https://schema.org", "@graph": [
    breadcrumbLD([{ name: "Home", href: "/" }, { name: "Guides", href: "/guides/" }, { name: g.h1, href: base }]),
    { "@type": "Article", headline: g.h1, description: g.desc, datePublished: BUILD, dateModified: BUILD, image: abs("/assets/og.svg"), author: { "@type": "Organization", name: CFG.name }, publisher: { "@type": "Organization", name: CFG.name, logo: { "@type": "ImageObject", url: abs("/assets/favicon.svg") } }, mainEntityOfPage: abs(base) },
    { "@type": "FAQPage", mainEntity: g.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }
  ] };
  const body = `${crumbs(crumbArr)}
<section><div class="eyebrow">Safety guide</div><h1 class="h-lg serif" style="margin:.4rem 0 1.1rem">${esc(g.h1)}</h1>
<div class="prose">${g.body}</div></section>
${related ? `<section><h2 class="h-md" style="margin-bottom:.8rem">${esc(g.relatedHeading || "Related recalls in our database")}</h2>${related}<p style="margin-top:1rem"><a href="${url("/recalls/")}">Browse all ${stats.total.toLocaleString()} recalls &rarr;</a></p></section>` : ""}
<section><h2 class="h-md" style="margin-bottom:.5rem">Frequently asked</h2><div class="prose">${g.faqs.map((f) => `<div class="faqq">${esc(f.q)}</div><div class="faqa">${esc(f.a)}</div>`).join("")}</div></section>
<section><h2 class="h-md" style="margin-bottom:.8rem">More safety guides</h2><div class="grid g-4">${others.map((x) => `<a class="card" href="${url("/guides/" + x.slug + "/")}"><div class="ct" style="font-size:1rem">${esc(x.h1.split(":")[0])}</div></a>`).join("")}</div></section>`;
  write("guides/" + g.slug + "/index.html", page({ title: truncate(g.title + " | " + CFG.name, 65), desc: truncate(g.desc, 155), pathname: base, jsonld, ogtype: "article" }, body));
}
function guidesIndexPage() {
  const crumbArr = [{ name: "Home", href: "/" }, { name: "Guides" }];
  const jsonld = { "@context": "https://schema.org", "@graph": [ breadcrumbLD([{ name: "Home", href: "/" }, { name: "Guides", href: "/guides/" }]), { "@type": "CollectionPage", name: "Supplement safety guides", url: abs("/guides/") } ] };
  const cards = GUIDES.map((g) => `<a class="card" href="${url("/guides/" + g.slug + "/")}"><div class="ct">${esc(g.h1.split(":")[0])}</div><div class="cd">${esc(g.desc)}</div></a>`).join("");
  const body = `${crumbs(crumbArr)}
<section><div class="eyebrow">Safety guides</div><h1 class="h-lg serif" style="margin:.4rem 0 1rem">Supplement safety guides</h1>
<p class="lede">Plain-English guides to supplement safety &mdash; heavy metals, hidden drugs, banned ingredients, and how to tell if what you're taking is actually tested.</p></section>
<section><div class="grid g-3">${cards}</div></section>`;
  write("guides/index.html", page({ title: "Supplement Safety Guides | " + CFG.name, desc: "Plain-English guides to supplement safety: lead in protein powder, banned ingredients, heavy metals, third-party testing and more.", pathname: "/guides/", jsonld }, body));
}

/* ---------------- assets + technical ---------------- */
function assets() {
  fs.mkdirSync(path.join(DOCS, "assets"), { recursive: true });
  ["style.css", "app.js"].forEach((f) => fs.copyFileSync(path.join(ROOT, "assets", f), path.join(DOCS, "assets", f)));
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#0E6E63"/><path d="M12 4l6 2.5V11c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8V6.5z" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  write("assets/favicon.svg", favicon);
  const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#0E6E63"/><rect x="60" y="60" width="1080" height="510" rx="28" fill="#0A554C"/><text x="110" y="250" font-family="Georgia,serif" font-size="88" font-weight="700" fill="#fff">SupplementCheck</text><text x="112" y="330" font-family="Arial,sans-serif" font-size="40" fill="#CFE8E3">Check any supplement’s FDA recall record — free.</text><text x="112" y="470" font-family="monospace" font-size="30" fill="#9FD3CB">${stats.total} recalls · ${stats.hidden} with hidden drugs · openFDA</text></svg>`;
  write("assets/og.svg", og);
  write(".nojekyll", "");
  write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${abs("/sitemap.xml")}\n`);
}
function sitemap() {
  const urls = ["/", "/recalls/", "/about/", "/methodology/", "/privacy/"]
    .concat(Object.keys(CATS).map((k) => "/category/" + k + "/"))
    .concat(Object.keys(LISTS).map((s) => "/list/" + s + "/"))
    .concat(["/guides/"]).concat(GUIDES.map((g) => "/guides/" + g.slug + "/"))
    .concat(items.map((i) => "/product/" + i.slug + "/"));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${abs(u)}</loc><lastmod>${BUILD}</lastmod></url>`).join("\n") + `\n</urlset>\n`;
  write("sitemap.xml", xml);
}
function searchIndex() {
  write("search-index.json", JSON.stringify(items.map((i) => ({ s: i.slug, n: i.name, f: i.firm, v: i.level }))));
}
function notFound() {
  write("404.html", page({ title: "Page not found | " + CFG.name, desc: "Page not found.", pathname: "/404.html" },
    `<section style="text-align:center;padding:60px 0"><h1 class="h-lg serif">Not found</h1><p class="lede" style="margin:1rem auto">That page isn’t here. Try searching, or browse all recalls.</p><a class="btn" href="${url("/recalls/")}">Browse all recalls</a></section>`));
}

/* ---------------- run ---------------- */
if (fs.existsSync(DOCS)) fs.rmSync(DOCS, { recursive: true, force: true });
fs.mkdirSync(DOCS, { recursive: true });
assets();
homePage();
recallsPage();
Object.keys(CATS).forEach(categoryPage);
Object.keys(LISTS).forEach(listPage);
items.forEach(productPage);
guidesIndexPage();
GUIDES.forEach(guidePage);
searchIndex();
sitemap();
notFound();
staticPage("about", "About SupplementCheck", "About SupplementCheck",
  `<p>SupplementCheck makes one thing easy: checking whether a dietary supplement has been recalled or flagged by the U.S. Food and Drug Administration.</p>
   <p>Supplements aren’t approved by the FDA before they’re sold. When something goes wrong — a hidden drug ingredient, contamination, or an undeclared allergen — it shows up as an <strong>enforcement (recall) report</strong>. That data is public, but it’s scattered and hard to read. We pull it into one searchable place and link every entry back to its official source.</p>
   <h2>What we are not</h2>
   <p>We’re independent and not affiliated with or endorsed by the FDA, NIH, or any agency. We don’t test products, we don’t rate brands, and nothing here is medical advice. We simply mirror the government’s own records with a date and a link.</p>
   <div class="notice">Currently tracking ${stats.total.toLocaleString()} FDA supplement recalls, including ${stats.hidden} involving hidden drug ingredients. Data from openFDA, last built ${BUILD}.</div>`);
staticPage("methodology", "Methodology & data sources", "Methodology & data",
  `<p>Every record on SupplementCheck comes from the U.S. FDA’s <strong>enforcement (recall) database</strong>, accessed through the free, public-domain <a href="https://open.fda.gov/" rel="noopener">openFDA API</a>.</p>
   <h2>How we build each page</h2>
   <p>We query the FDA food and drug enforcement endpoints for dietary-supplement records, then for each recall we show the product, the recalling firm, the FDA classification, the stated reason, the dates, and where it was distributed — exactly as reported. A colour-coded verdict summarizes the record: <strong>🔴 flagged</strong> for hidden drugs or Class I recalls, <strong>🟡 caution</strong> for other recalls.</p>
   <h2>How we classify the issue</h2>
   <p>We tag each recall as a hidden drug ingredient, contamination, undeclared allergen, or labeling/quality issue by reading the FDA’s own “reason for recall” text. These tags are a reading aid, not an FDA category.</p>
   <h2>Accuracy &amp; limits</h2>
   <p>openFDA data is provided “as is,” can lag real time, and may contain errors — always confirm against the linked FDA record before acting. Absence from this database does <em>not</em> mean a product is safe or tested. This is informational only and not medical advice.</p>
   <div class="notice">Data snapshot built ${BUILD} · ${stats.total.toLocaleString()} records · source: openFDA food &amp; drug enforcement.</div>`);
staticPage("privacy", "Privacy Policy", "Privacy Policy",
  `<p>Last updated ${BUILD}. SupplementCheck is a free, informational site, and we keep data collection to a minimum.</p>
   <h2>What we collect</h2>
   <p>Browsing requires no account and no personal information. The only personal data we collect is your <strong>email address</strong> — and only if you choose to subscribe to recall alerts.</p>
   <h2>Email alerts</h2>
   <p>If you subscribe, your address is stored and emailed by our third-party email provider on our behalf, solely to send you new-recall alerts. Every email includes a one-click <strong>unsubscribe</strong> link, and you can opt out at any time. We never sell or share your email.</p>
   <h2>Cookies &amp; advertising</h2>
   <p>The site sets no advertising cookies today. If we add analytics or ads in future, we will update this page and request consent where required.</p>
   <h2>Data sources</h2>
   <p>Recall information is public-record data from the U.S. FDA via the openFDA API. We are an independent aggregator and are not affiliated with the FDA or NIH.</p>
   <h2>Contact</h2>
   <p>Questions about your data? Email <strong>[add your contact address]</strong>.</p>`);

console.log("Built " + (items.length) + " product pages + " + Object.keys(CATS).length + " categories + " + Object.keys(LISTS).length + " lists.");
console.log("Stats:", stats);
