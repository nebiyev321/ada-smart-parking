"use strict";
// Runs before the page is drawn: the saved theme and language, so the page never flashes the wrong one.
// Without a saved choice the theme follows the device and the language follows the browser.
(function () {
  const root = document.documentElement;
  let theme = null, lang = null;
  try { theme = localStorage.getItem("theme"); lang = localStorage.getItem("lang"); } catch { /* storage blocked */ }
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  if (lang !== "az" && lang !== "en") lang = /^az\b/i.test(navigator.language || "") ? "az" : "en";
  root.lang = lang;
})();
