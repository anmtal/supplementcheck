/* SupplementCheck static site generator
   Reads data/raw/*.json (openFDA enforcement) -> writes /docs (GitHub Pages).
   Zero dependencies. Run: node build.js */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DOCS = path.join(ROOT, "docs");
const DATA = path.join(ROOT, "data", "raw");

const CFG = { name: "SupplementCheck", origin: "https://anmtal.github.io", base: "/supplementcheck" };
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
<meta name="theme-color" content="#0E6E63">
<meta property="og:type" content="${ogtype || "website"}">
<meta property="og:site_name" content="${CFG.name}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${abs("/assets/og.svg")}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${url("/assets/favicon.svg")}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Public+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap">
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
  <a class="navlink" href="${url("/recalls/")}">All recalls</a>
  <a class="navlink" href="${url("/methodology/")}">Methodology</a>
  <button class="toggle" type="button" aria-label="Toggle dark mode">◐ Theme</button>
</div></header>
<main id="main"><div class="wrap">`;
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
  return `</div></main>
<footer><div class="wrap cols">
  <div>
    <a class="brand" href="${url("/")}" style="font-size:1rem">${LOGO}Supplement<b>Check</b></a>
    <p class="disclaim">We mirror public U.S. FDA recall records so you can check them in one place. We don’t test products or give medical advice, and we’re not affiliated with the FDA or NIH. Every result links to its official source and date. Not a substitute for your doctor.</p>
  </div>
  <div><h4>Browse</h4>
    <a href="${url("/recalls/")}">All FDA recalls</a>
    <a href="${url("/list/supplements-recalled-for-hidden-drug-ingredients/")}">Hidden-drug recalls</a>
    <a href="${url("/list/supplements-recalled-for-contamination/")}">Contamination recalls</a>
    <a href="${url("/list/supplements-recalled-for-undeclared-allergens/")}">Allergen recalls</a>
  </div>
  <div><h4>About</h4>
    <a href="${url("/about/")}">About</a>
    <a href="${url("/methodology/")}">Methodology & data</a>
    <a href="https://open.fda.gov/" rel="noopener">openFDA data</a>
    <a href="https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" rel="noopener nofollow">FDA recalls</a>
  </div>
</div></footer>
<script src="${url("/assets/app.js")}" defer></script>
</body></html>`;
}
function page(opts, body) { return head(opts) + body + foot(); }

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
  const recent = items.slice(0, 6).map(feedItem).join("");
  const catCards = Object.keys(CATS).map((k) => `<a class="card" href="${url("/category/" + k + "/")}"><div class="cn">${CATS[k].emoji} ${byCat[k].length} recalls</div><div class="ct">${esc(CATS[k].name)}</div><div class="cd">${esc(CATS[k].blurb)}</div></a>`).join("");
  const jsonld = { "@context": "https://schema.org", "@graph": [
    { "@type": "Organization", name: CFG.name, url: abs("/"), logo: abs("/assets/favicon.svg") },
    { "@type": "WebSite", name: CFG.name, url: abs("/"), potentialAction: { "@type": "SearchAction", target: abs("/recalls/?q={search_term_string}"), "query-input": "required name=search_term_string" } }
  ] };
  const body = `
<section class="hero"><div class="hero-grid">
  <div>
    <div class="eyebrow">Free FDA safety lookup</div>
    <h1 class="h-xl serif">Is your supplement hiding something?</h1>
    <p class="lede">Search <strong>${stats.total.toLocaleString()}</strong> official U.S. FDA supplement recalls — including <strong>${stats.hidden}</strong> caught with hidden drug ingredients. Free, in ten seconds.</p>
    <div class="bigsearch"><input class="js-search" type="search" placeholder="Search a supplement or brand…" aria-label="Search supplements"><a class="btn" href="${url("/recalls/")}">Browse all</a></div>
    <div class="trustline"><span class="dot"></span> <span class="mono">SOURCE: openFDA · FDA enforcement reports</span> · updated ${BUILD}</div>
  </div>
  <aside class="feed" aria-label="Recently flagged supplements"><h2><span class="pulse" aria-hidden="true"></span> Recently flagged</h2><ul>${recent}</ul></aside>
</div></section>
<section>
  <div class="eyebrow">Browse by category</div>
  <h2 class="h-lg serif" style="margin:.4rem 0 1rem">Where the recalls cluster</h2>
  <div class="grid g-3">${catCards}</div>
</section>
<section>
  <div class="card" style="background:var(--primary-tint);border-color:transparent">
    <div class="cn">Most-read lists</div>
    <div class="grid g-3" style="margin-top:.7rem">
      <a class="card" href="${url("/list/supplements-recalled-for-hidden-drug-ingredients/")}"><div class="ct">🔴 Hidden drug ingredients</div><div class="cd">${stats.hidden} supplements the FDA caught spiked with undeclared drugs.</div></a>
      <a class="card" href="${url("/list/supplements-recalled-for-contamination/")}"><div class="ct">🧫 Contamination</div><div class="cd">Recalls for Salmonella, Listeria, mold and heavy metals.</div></a>
      <a class="card" href="${url("/list/supplements-recalled-for-undeclared-allergens/")}"><div class="ct">⚠️ Undeclared allergens</div><div class="cd">Hidden milk, soy, egg, peanut and tree-nut recalls.</div></a>
    </div>
  </div>
</section>`;
  write("index.html", page({ title: "SupplementCheck — Check any supplement’s FDA recall & safety record", desc: `Search ${stats.total.toLocaleString()} official FDA dietary-supplement recalls by product or brand — including ${stats.hidden} with hidden drug ingredients. Free and sourced.`, pathname: "/", jsonld }, body));
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
  <div class="block"><h3>🔔 Get an alert if this is recalled again</h3><p class="sub">We’ll email you when the FDA flags anything you’ve searched.</p><form class="emailrow" onsubmit="return false"><input type="email" placeholder="you@email.com" aria-label="Email for recall alerts"><button class="btn" type="submit">Notify me</button></form></div>
  <div class="block"><h3>Frequently asked</h3>${faqs.map((f) => `<div class="faqq">${esc(f.q)}</div><div class="faqa">${esc(f.a)}</div>`).join("")}</div>
</article>
<div class="adslot" style="margin-top:16px">ADVERTISEMENT · display ad slot</div>
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
  const urls = ["/", "/recalls/", "/about/", "/methodology/"]
    .concat(Object.keys(CATS).map((k) => "/category/" + k + "/"))
    .concat(Object.keys(LISTS).map((s) => "/list/" + s + "/"))
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

console.log("Built " + (items.length) + " product pages + " + Object.keys(CATS).length + " categories + " + Object.keys(LISTS).length + " lists.");
console.log("Stats:", stats);
