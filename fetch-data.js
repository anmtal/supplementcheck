// Re-download the latest openFDA supplement enforcement (recall) data.
// Node 18+ has global fetch. Run: node fetch-data.js
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "data", "raw");
fs.mkdirSync(OUT, { recursive: true });

const SETS = [
  ["food_enforcement", "https://api.fda.gov/food/enforcement.json?search=product_description:supplement&limit=1000"],
  ["drug_enforcement", "https://api.fda.gov/drug/enforcement.json?search=product_description:supplement&limit=1000"]
];

(async () => {
  for (const [name, url] of SETS) {
    try {
      const res = await fetch(url);
      const json = await res.json();
      fs.writeFileSync(path.join(OUT, name + ".json"), JSON.stringify(json));
      console.log(name + ": " + (json.results ? json.results.length : 0) + " records");
    } catch (e) {
      console.error("Failed " + name + ":", e.message);
    }
  }
})();
