// Runs inside the card. A page card grows its text to fill the card: the
// largest --fit from 1 to 2.2 at which the note still fits; a note that does
// not fit even at 1 keeps that size and fades out at the bottom. Once the
// images and embedded fonts are in and the text is fitted, the card marks
// itself ready (`data-ready`), which is when the snapshot is taken. No
// animation frame: an offscreen web view may never draw one.
(function () {
  var page = document.querySelector(".page");

  function fits(scale) {
    page.style.setProperty("--fit", String(scale));
    return page.scrollHeight <= page.clientHeight + 1;
  }

  function fit() {
    if (!page) return;
    var low = 1;
    var high = 2.2;
    if (!fits(low)) {
      page.classList.add("overflowing");
      return;
    }
    page.classList.remove("overflowing");
    for (var i = 0; i < 12; i++) {
      var mid = (low + high) / 2;
      if (fits(mid)) low = mid;
      else high = mid;
    }
    fits(low);
  }

  fit();
  window.addEventListener("load", function () {
    document.fonts.ready.then(function () {
      fit();
      document.documentElement.dataset.ready = "1";
    });
  });
})();
