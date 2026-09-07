# SupplementCheck

**Look up any dietary supplement's FDA recall & safety record — free.**

A static, SEO-optimized website that mirrors official U.S. FDA recall data so anyone can check a supplement in seconds. Built to be driven by short-form video (fear-hook Reels/Shorts → search the product → see the verdict).

🔗 **Live:** https://anmtal.github.io/supplementcheck/
📊 **Data:** [openFDA](https://open.fda.gov/) food & drug **enforcement (recall)** reports — public domain (CC0).

---

## What it does

- **Search** ~840 real FDA supplement recalls by product or brand (client-side, instant).
- **Report page per product** — the "money page": a colour-coded verdict (🔴 flagged / 🟡 caution), the FDA reason, classification, recalling firm, dates, and distribution — every claim linked to its official source.
- **Category hubs** (weight-loss, sexual-enhancement, sports, vitamins, herbal, other) and **curated lists** (hidden drug ingredients, contamination, undeclared allergens).
- **Monetization slots** wired in as placeholders: affiliate "safer alternatives" + at-home test kits, display-ad slots, and email capture for recall alerts.

## How it works

Pure Node, zero dependencies. Data files → templates → static HTML in `/docs` (served by GitHub Pages).

```bash
npm run fetch     # re-download latest openFDA recall data -> data/raw/
npm run build     # generate the static site -> docs/
npm run rebuild   # fetch + build
npm run dev        # build + serve docs locally (npx serve)
```

## Project structure

```
build.js              # the static-site generator (all templates + SEO)
fetch-data.js         # refreshes data/raw from openFDA
assets/               # source style.css + app.js (search, theme toggle)
data/raw/*.json       # openFDA snapshots (committed for reproducibility)
docs/                 # GENERATED output — the deployed site (GitHub Pages source)
```

## SEO built in

- Pre-rendered static HTML (fully indexable, no JS needed for content)
- Unique `<title>`, meta description, canonical & Open Graph per page
- JSON-LD structured data: `Article` + `FAQPage` on report pages, `BreadcrumbList`, `ItemList`, `WebSite`+`SearchAction`
- `sitemap.xml` (851 URLs), `robots.txt`, clean subfolder URLs, hub-and-spoke internal linking (no orphan pages)

## Monetization — TODO (placeholders in the report template)

- [ ] Affiliate links: third-party-tested brands (NSF/USP), at-home heavy-metal test kits
- [ ] Display ads: AdSense to start → Mediavine/Raptive at ~50k+ sessions/mo
- [ ] Email capture backend (recall alerts) — connect a provider (Buttondown, ConvertKit…)

## Roadmap

- Vertical #2: packaged **food** recalls (same openFDA plumbing) and "additives banned abroad"
- Automated monthly data refresh (GitHub Action running `fetch` + `build`)
- Real OG images (raster), per-ingredient guide pages

## Legal / disclaimer

Independent aggregator. **Not affiliated with or endorsed by the FDA, NIH, or any agency.** We mirror public recall records with a date and a source link — we don't test products, rate brands, or give medical advice. openFDA data is provided "as is" and may lag or contain errors; always confirm against the linked FDA record. Informational only.

Code: MIT. Underlying FDA data: public domain.
