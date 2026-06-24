/* =========================================================
   ZWALD TRAVEL PLANNER — interactive savings calculator
   Shows what a traveller saves with local prices vs going solo,
   and how that compares to the planner fee. Numbers are framed
   as an estimate (~15% average saving on bookings).
   ========================================================= */
(function () {
  "use strict";

  var root = document.querySelector("[data-est]");
  if (!root) return;

  var opts = root.querySelectorAll(".est-opt");
  var daysRange = root.querySelector("[data-est-days-range]");
  var budgetRange = root.querySelector("[data-est-budget-range]");
  var daysOut = root.querySelector("[data-est-days]");
  var budgetOut = root.querySelector("[data-est-budget]");
  var amountOut = root.querySelector("[data-est-amount]");
  var feeOut = root.querySelector("[data-est-fee]");
  var msgOut = root.querySelector("[data-est-msg]");
  if (!daysRange || !budgetRange || !amountOut) return;

  var SAVING_RATE = 0.15; // average saving on bookings with local prices
  var people = 2;
  var rate = 40; // planner fee per day (CHF)

  function format(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  function fill(input) {
    var min = parseFloat(input.min);
    var max = parseFloat(input.max);
    var pct = ((parseFloat(input.value) - min) / (max - min)) * 100;
    input.style.setProperty("--fill", pct + "%");
  }

  function update() {
    var days = parseInt(daysRange.value, 10);
    var daily = parseInt(budgetRange.value, 10);
    if (daysOut) daysOut.textContent = days;
    if (budgetOut) budgetOut.textContent = daily;

    var saving = Math.round(daily * days * people * SAVING_RATE);
    var fee = rate * days;
    amountOut.textContent = format(saving);
    if (feeOut) feeOut.textContent = format(fee);

    if (msgOut) {
      if (saving >= fee) {
        msgOut.textContent = "✨ Entièrement couvert par tes économies — tu es gagnant·e.";
      } else {
        var pct = Math.round((saving / fee) * 100);
        msgOut.textContent = "Déjà " + pct + "% remboursé par tes économies — le reste, c'est des semaines de temps gagné et zéro stress.";
      }
    }

    fill(daysRange);
    fill(budgetRange);
  }

  opts.forEach(function (opt) {
    var input = opt.querySelector("input");
    if (!input) return;
    input.addEventListener("change", function () {
      opts.forEach(function (o) { o.classList.remove("is-active"); });
      opt.classList.add("is-active");
      people = parseInt(input.value, 10);
      rate = parseFloat(input.getAttribute("data-rate"));
      update();
    });
  });

  daysRange.addEventListener("input", update);
  budgetRange.addEventListener("input", update);
  update();
})();
