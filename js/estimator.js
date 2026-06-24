/* =========================================================
   ZWALD TRAVEL PLANNER — interactive trip estimator
   Live price estimate: selected formula (CHF/day) × number of days.
   ========================================================= */
(function () {
  "use strict";

  var root = document.querySelector("[data-est]");
  if (!root) return;

  var opts = root.querySelectorAll(".est-opt");
  var range = root.querySelector("[data-est-range]");
  var daysOut = root.querySelector("[data-est-days]");
  var amountOut = root.querySelector("[data-est-amount]");
  var detailOut = root.querySelector("[data-est-detail]");
  if (!range || !amountOut) return;

  var rate = 29;
  var name = "Light";

  function format(n) {
    // 1 234 grouping with a regular space (CH French)
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  function update() {
    var days = parseInt(range.value, 10);
    var total = rate * days;
    if (daysOut) daysOut.textContent = days;
    amountOut.textContent = format(total);
    if (detailOut) detailOut.textContent = "Formule " + name + " · " + days + " jours";
    var min = parseInt(range.min, 10);
    var max = parseInt(range.max, 10);
    var pct = ((days - min) / (max - min)) * 100;
    range.style.setProperty("--fill", pct + "%");
  }

  opts.forEach(function (opt) {
    var input = opt.querySelector("input");
    if (!input) return;
    input.addEventListener("change", function () {
      opts.forEach(function (o) { o.classList.remove("is-active"); });
      opt.classList.add("is-active");
      rate = parseFloat(input.value);
      name = input.getAttribute("data-name");
      update();
    });
  });

  range.addEventListener("input", update);
  update();
})();
