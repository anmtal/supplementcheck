/* SupplementCheck — theme toggle + client-side search */
(function () {
  var root = document.documentElement;
  var BASE = window.SC_BASE || "";

  // ---- theme ----
  try { var s = localStorage.getItem("sc-theme"); if (s) root.setAttribute("data-theme", s); } catch (e) {}
  function curTheme() {
    var a = root.getAttribute("data-theme");
    if (a) return a;
    return matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light";
  }
  document.querySelectorAll(".toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var next = curTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("sc-theme", next); } catch (e) {}
    });
  });

  // ---- search ----
  var index = null, loading = false;
  function loadIndex(cb) {
    if (index) return cb(index);
    if (loading) return;
    loading = true;
    fetch(BASE + "/search-index.json").then(function (r) { return r.json(); })
      .then(function (d) { index = d; cb(index); })
      .catch(function () { loading = false; });
  }
  function iconFor(v){ return v === "flag" ? "🔴" : (v === "caution" ? "🟡" : "🟢"); }

  document.querySelectorAll(".js-search").forEach(function (input) {
    var panel = document.createElement("div");
    panel.className = "results";
    panel.hidden = true;
    input.parentNode.appendChild(panel);

    function render(q) {
      if (!q || q.length < 2) { panel.hidden = true; return; }
      loadIndex(function (data) {
        var ql = q.toLowerCase();
        var hits = data.filter(function (it) {
          return it.n.toLowerCase().indexOf(ql) !== -1 || (it.f && it.f.toLowerCase().indexOf(ql) !== -1);
        }).slice(0, 8);
        if (!hits.length) { panel.innerHTML = '<div class="empty">No matching recalls found for &ldquo;' + q.replace(/[<>&]/g, "") + '&rdquo;.</div>'; panel.hidden = false; return; }
        panel.innerHTML = hits.map(function (it) {
          return '<a href="' + BASE + '/product/' + it.s + '/">' + iconFor(it.v) +
            ' <span><span class="rn">' + it.n + '</span> <span class="rm">' + (it.f || "") + '</span></span></a>';
        }).join("");
        panel.hidden = false;
      });
    }
    input.addEventListener("input", function () { render(input.value.trim()); });
    input.addEventListener("focus", function () { if (input.value.trim().length >= 2) render(input.value.trim()); });
    document.addEventListener("click", function (e) {
      if (!input.parentNode.contains(e.target)) panel.hidden = true;
    });
  });

  // ---- recalls page live filter ----
  var filter = document.getElementById("rowfilter");
  if (filter) {
    var rows = Array.prototype.slice.call(document.querySelectorAll("[data-name]"));
    var count = document.getElementById("rowcount");
    var params = new URLSearchParams(location.search);
    var q0 = params.get("q");
    if (q0) filter.value = q0;
    function run() {
      var q = filter.value.trim().toLowerCase();
      var shown = 0;
      rows.forEach(function (r) {
        var hit = !q || r.getAttribute("data-name").indexOf(q) !== -1;
        r.hidden = !hit; if (hit) shown++;
      });
      if (count) count.textContent = shown + " result" + (shown === 1 ? "" : "s");
    }
    filter.addEventListener("input", run);
    if (q0) run();
  }
})();
