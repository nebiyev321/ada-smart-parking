"use strict";
// Single-page UI for vehicle owners, guards and admins. No inline handlers: the page runs
// under a strict Content-Security-Policy, so every action goes through data-action delegation.
// Every visible string goes through t() from i18n.js; the theme and language are set by prefs.js.

const API = "/api/v1";
let token = null;
// "Remember me" keeps the token in localStorage; otherwise it lasts as long as the tab.
try { token = sessionStorage.getItem("token") || localStorage.getItem("token"); } catch { /* storage blocked */ }
let me = null;

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TZ = "Asia/Baku"; // campus time, whatever the device is set to
// Dates on campus time. Azerbaijani names are built here: many browsers ship no Azerbaijani calendar data
// and would print "2027 M01 18".
const AZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
const AZ_DAYS = ["B.", "B.e.", "Ç.a.", "Ç.", "C.a.", "C.", "Ş."];
function parts(date, timeZone = TZ) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(date).map(x => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: p.year, m: Number(p.month) - 1, d: Number(p.day), hm: `${p.hour}:${p.minute}`, weekday };
}
const fmt = iso => {
  if (!iso) return "";
  if (LANG !== "az") return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const p = parts(new Date(iso)); return `${p.d} ${AZ_MONTHS[p.m].slice(0, 3)} ${p.y}, ${p.hm}`;
};
const day = iso => {
  if (!iso) return "";
  if (LANG !== "az") return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
  const p = parts(new Date(iso)); return `${p.d} ${AZ_MONTHS[p.m]} ${p.y}`;
};
const time = iso => parts(new Date(iso)).hm;
// Calendar dates (YYYY-MM-DD) as campus sees them.
const campusDay = (offset = 0) => new Date(Date.now() + offset * 864e5).toLocaleDateString("en-CA", { timeZone: TZ });
const dayOf = ymd => {
  if (ymd === campusDay()) return t("Today");
  if (ymd === campusDay(1)) return t("Tomorrow");
  const date = new Date(ymd + "T12:00:00Z");
  if (LANG !== "az") return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const p = parts(date, "UTC"); return `${AZ_DAYS[p.weekday]}, ${p.d} ${AZ_MONTHS[p.m].slice(0, 3)}`;
};
const words = s => String(s ?? "").replaceAll("_", " ");
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : "";
// Server codes (student, parking_admin, permit_approved) shown as words in the interface language.
const label = code => t(cap(words(code)));

const STATUS = { active: "Active", pending: "Waiting for approval", rejected: "Rejected", suspended: "Suspended", expired: "Expired", inactive: "Replaced" };
const status = s => `<span class="status s-${esc(s)}">${esc(t(STATUS[s] || s))}</span>`;
// The left band of a real AZ plate: the national flag above the boxed "AZ" RFID label.
const PLATE_SIDE = `<span class="plate-side" aria-hidden="true"><i class="plate-flag"></i><b class="plate-az">AZ</b></span>`;
// AZS 599 (Figure 18): every character sits in a 45 mm cell, and separators are raised 15 x 10 mm bars,
// not the font's hyphen, whatever was typed.
// Plates recorded without separators ("10AB123") are split into the standard 10-AB-123 groups.
const plateGroups = p => {
  const v = String(p ?? "").trim().toUpperCase(), m = v.match(/^(\d{2})([A-Z]{1,2})(\d{3})$/);
  return m ? m.slice(1) : v.split(/[\s-]+/);
};
const plateChars = p => plateGroups(p)
  .map(g => [...g].map(c => `<b data-c="${esc(c)}">${esc(c)}</b>`).join("")).join(`<i class="plate-dash"></i>`);

// DIN 1451 letters are narrower than most fonts that stand in for it, so measure each glyph's ink in the
// font this device actually resolved and squeeze any that would spill out of its 45 mm cell.
async function fitPlateGlyphs() {
  try { await document.fonts.ready; } catch { /* fonts API unavailable: plates still render, just unfitted */ }
  const probe = document.createElement("span");
  probe.className = "plate-num"; probe.setAttribute("aria-hidden", "true"); probe.textContent = "0";
  Object.assign(probe.style, { position: "absolute", visibility: "hidden", fontSize: "92px" });
  document.body.append(probe);
  const cs = getComputedStyle(probe), ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${cs.fontWeight} 92px ${cs.fontFamily}`;
  probe.remove();
  const rules = [];
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") {
    const m = ctx.measureText(c), ink = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    if (ink > 45) rules.push(`.plate-num b[data-c="${c}"] { transform: scaleX(${(45 / ink).toFixed(3)}); }`);
  }
  try {
    const sheet = new CSSStyleSheet(); sheet.replaceSync(rules.join(" "));
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch { /* older browser: letters keep their natural width */ }
}
fitPlateGlyphs();

const plate = (p, lg) => `<span class="plate${lg ? " lg" : ""}" role="img" aria-label="${esc(t("Plate {plate}", { plate: p }))}">${PLATE_SIDE}<span class="plate-num" aria-hidden="true">${plateChars(p)}</span></span>`;

// Wayfinding pictograms on one 24-unit grid, stroked in the current colour.
const ICONS = {
  vehicle: '<path d="M4 17v-5l2.2-5.2A1.5 1.5 0 0 1 7.6 6h8.8a1.5 1.5 0 0 1 1.4.8L20 12v5M4 12h16M3.5 17h17M6 17v2.5M18 17v2.5"/><circle cx="7.5" cy="14.5" r=".9"/><circle cx="16.5" cy="14.5" r=".9"/>',
  gate: '<path d="M5 21V5M2.5 21h5M5 7.5h16v5H5zM11 7.5l-2.5 5M17 7.5l-2.5 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
  queue: '<path d="M4 4.5h16v15H4zM8 12l3 3 5-6"/>',
  campus: '<path d="M4 4h16v16H4zM10 17V7h3.5a3 3 0 0 1 0 6H10"/>',
  log: '<path d="M7 20V4M3.5 7.5 7 4l3.5 3.5M17 4v16M13.5 16.5 17 20l3.5-3.5"/>',
  audit: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  in: '<path d="M14 4h5v16h-5M3 12h11.5M10.5 8l4 4-4 4"/>',
  out: '<path d="M10 4H5v16h5M9 12h11.5M16.5 8l4 4-4 4"/>',
  go: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  stop: '<path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7zM12 7.5v5.5M12 16.5v.01"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  print: '<path d="M7 9V3.5h10V9M7 17H4.5V9.5h15V17H17M7 14h10v6.5H7z"/>',
};
const icon = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// Theme: an explicit choice is stored; without one the page follows the device.
const darkNow = () => document.documentElement.dataset.theme
  ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
function syncThemeColor() {
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = darkNow() ? "#0d2f70" : "#0b3d91"; });
}
// The display controls sit in the sign band when signed in and above the panel on sign-in.
const prefsButtons = () => {
  const dark = darkNow(), az = LANG === "az";
  return `<button type="button" class="pref" data-action="toggleLang" lang="${az ? "en" : "az"}"
      aria-label="${az ? "Switch to English" : "Azərbaycan dilinə keç"}" title="${az ? "English" : "Azərbaycanca"}">${az ? "EN" : "AZ"}</button>
    <button type="button" class="pref" data-action="toggleTheme" aria-label="${esc(t(dark ? "Switch to light mode" : "Switch to dark mode"))}"
      title="${esc(t(dark ? "Switch to light mode" : "Switch to dark mode"))}">${icon(dark ? "sun" : "moon")}</button>`;
};
// The theme button offers the other mode: a sun while dark, a moon while light.
function paintThemeButtons() {
  const dark = darkNow(), text = t(dark ? "Switch to light mode" : "Switch to dark mode");
  document.querySelectorAll('[data-action="toggleTheme"]').forEach(b => { b.innerHTML = icon(dark ? "sun" : "moon"); b.setAttribute("aria-label", text); b.title = text; });
}
// Text in the page shell that exists before any view renders.
function applyShellText() {
  $(".skip").textContent = t("Skip to content");
  $("#nav").setAttribute("aria-label", t("Sections"));
  const loading = $("#view .loading"); if (loading) loading.textContent = t("Loading…");
}

// Motion: every effect has a CSS reduced-motion path; helpers resolve even when no animation runs.
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function replay(el, cls, ms = 700) {
  if (!el) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  clearTimeout(el["_" + cls]); el["_" + cls] = setTimeout(() => el.classList.remove(cls), ms);
}
// Plays an exit class, then resolves, so the next state never waits more than a beat.
function leave(el, cls = "leaving") {
  if (!el) return Promise.resolve();
  el.classList.add(...cls.split(" "));
  return new Promise(done => {
    el.addEventListener("animationend", e => { if (e.target === el) done(); });
    setTimeout(done, 450);
  });
}

function setStore(v, remember = false) {
  try {
    sessionStorage.removeItem("token"); localStorage.removeItem("token");
    if (v) (remember ? localStorage : sessionStorage).setItem("token", v);
  } catch { /* storage blocked */ }
}

function toast(msg, kind = "") {
  const el = $("#toast");
  el.textContent = msg; el.className = "show " + kind;
  clearTimeout(el._h); el._h = setTimeout(() => { el.className = kind; }, kind === "error" ? 6000 : 3000);
}

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new Error(t("Can't reach the parking service. Check your connection and try again."));
  }
  if (res.status === 401 && token) { signOut(t("Your session ended. Sign in again.")); throw new Error("Signed out"); }
  if (opts.raw && res.ok) return res;
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const d = data?.detail;
    let msg = t("Something went wrong on the server. Try again in a moment.");
    if (typeof d === "string") msg = t(d);
    else if (d?.message) msg = d.next_allowed_at ? t("{message}. Next possible on {date}.", { message: t(d.message), date: day(d.next_allowed_at) }) : t(d.message);
    else if (Array.isArray(d)) msg = d.map(fieldError).join(" ");
    const err = new Error(msg); err.status = res.status; err.fields = Array.isArray(d) ? d.map(e => e.loc.at(-1)) : [];
    throw err;
  }
  return data;
}

const FIELD_NAMES = { plate: "Plate number", make: "Make", model: "Model", color: "Colour", reason: "Reason", guest_name: "Guest name", valid_on: "Day" };
function fieldError(e) {
  const name = t(FIELD_NAMES[e.loc.at(-1)] || cap(words(e.loc.at(-1))));
  if (e.type === "string_pattern_mismatch") return e.loc.at(-1) === "plate"
    ? t("Plate number: use letters and digits, separated by single spaces or hyphens, like 10-AB-123.")
    : t("{name}: remove special characters such as < or >.", { name });
  if (e.type === "string_too_short") return t("{name} is too short.", { name });
  if (e.type === "string_too_long") return t("{name} is too long.", { name });
  return `${name}: ${e.msg}.`;
}

// Disables the button while the request runs, so a double click cannot submit twice.
async function busy(btn, fn) {
  if (btn?.getAttribute("aria-busy") === "true") return;
  btn?.setAttribute("aria-busy", "true"); if (btn) btn.disabled = true;
  try { return await fn(); } finally { if (btn?.isConnected) { btn.removeAttribute("aria-busy"); btn.disabled = false; } }
}

// Accessible replacement for prompt()/confirm(). Resolves to the text (or true), or null when cancelled.
function ask({ title, text = "", field = null, confirm = t("Confirm"), danger = false }) {
  const d = $("#dlg");
  d.innerHTML = `<form class="dlg">
    <h2 id="dlg-title">${esc(title)}</h2>
    ${text ? `<p>${esc(text)}</p>` : ""}
    ${field ? `<label class="field"><span>${esc(field.label)}${field.required ? "" : " " + esc(t("(optional)"))}</span>
      <textarea name="v" rows="3" maxlength="${field.max || 300}" ${field.required ? "required" : ""} placeholder="${esc(field.placeholder || "")}"></textarea></label>` : ""}
    <div class="actions"><button type="button" class="ghost" data-cancel>${esc(t("Cancel"))}</button>
    <button type="submit" class="${danger ? "danger-solid" : ""}">${esc(confirm)}</button></div></form>`;
  const f = $("form", d);
  return new Promise(resolve => {
    let result = null;
    $("[data-cancel]", d).onclick = () => d.close();
    f.onsubmit = e => { e.preventDefault(); result = field ? f.elements.v.value.trim() : true; d.close(); };
    d.onclose = () => resolve(result);
    d.showModal();
    (field ? f.elements.v : $("button[type=submit]", d)).focus();
  });
}

const has = (...roles) => me && roles.some(r => me.roles.includes(r));
const STAFF = ["guard", "parking_admin", "system_admin"];
const ADMINS = ["parking_admin", "system_admin"];
const TABS = [
  { id: "vehicle", label: "My vehicle", icon: "vehicle", show: () => true },
  { id: "gate", label: "Gate check", icon: "gate", show: () => has(...STAFF) },
  { id: "campus", label: "On campus", icon: "campus", show: () => has(...STAFF) },
  { id: "search", label: "Find a vehicle", icon: "search", show: () => has(...STAFF) },
  { id: "queue", label: "Approvals", icon: "queue", show: () => has(...STAFF) },
  { id: "log", label: "Gate log", icon: "log", show: () => has(...STAFF) },
  { id: "audit", label: "Audit and settings", icon: "audit", show: () => has("system_admin") },
];

function signOut(message) {
  token = null; me = null; setStore(null);
  if (location.hash) history.replaceState(null, "", location.pathname);
  render();
  if (typeof message === "string") toast(message);
}

let renderSeq = 0;
async function render({ enter = false } = {}) {
  const seq = ++renderSeq;
  if (!token) return renderLogin();
  // A slow answer (a cold start on Vercel) shows a thin bar instead of a frozen page.
  const slow = setTimeout(() => document.body.classList.add("loading"), 180);
  try { await renderApp(seq, enter); }
  finally { clearTimeout(slow); if (seq === renderSeq) document.body.classList.remove("loading"); }
}

async function renderApp(seq, enter) {
  try { me = await api("/me"); } catch (e) { if (token) showError(e); return; }
  if (seq !== renderSeq) return;
  delete document.body.dataset.screen;
  $("#who").innerHTML = `<span class="person">${esc(me.user.full_name)}</span>
    <span class="role${me.roles.length ? "" : " lead"}">${esc(label(me.user.affiliation))}</span>
    ${me.roles.map((r, i) => `<span class="role extra${i ? "" : " lead"}">${esc(label(r))}</span>`).join("")}
    ${prefsButtons()}
    <button type="button" data-action="signout">${esc(t("Sign out"))}</button>`;
  const tabs = TABS.filter(tab => tab.show());
  const current = tabs.find(tab => "#" + tab.id === location.hash)?.id || (has("guard") ? "gate" : "vehicle");
  const nav = $("#nav"); nav.hidden = tabs.length < 2;
  nav.innerHTML = tabs.map(tab => `<a href="#${tab.id}"${tab.id === current ? ' aria-current="page"' : ""}>${icon(tab.icon)}${esc(t(tab.label))}</a>`).join("");
  showTab(nav);
  document.title = `${t(tabs.find(tab => tab.id === current).label)} · ADA Smart Parking`;
  try { await VIEWS[current](); } catch (e) { if (seq === renderSeq) showError(e); }
  if (enter && seq === renderSeq) replay($("#view"), "enter");
}

function showError(e) {
  $("#view").innerHTML = `<div class="card" role="alert"><h2>${esc(t("This page didn't load"))}</h2>
    <p>${esc(e.message)}</p><button type="button" data-action="retry">${esc(t("Try again"))}</button></div>`;
}

// On a phone the tab strip scrolls; keep the current tab in view.
function showTab(nav) {
  const a = $("[aria-current]", nav);
  if (a && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2, behavior: calm() ? "auto" : "smooth" });
}

// The yellow "you are here" bar slides to the new section at once; the page follows when its data arrives.
function moveTab(id) {
  const nav = $("#nav"), next = $(`a[href="#${CSS.escape(id)}"]`, nav);
  if (!next || next.hasAttribute("aria-current")) return;
  const swap = () => { $("[aria-current]", nav)?.removeAttribute("aria-current"); next.setAttribute("aria-current", "page"); showTab(nav); };
  if (document.startViewTransition && !calm()) document.startViewTransition(swap); else swap();
}

window.addEventListener("hashchange", () => {
  moveTab(location.hash.slice(1));
  render({ enter: true }); $("#view").focus({ preventScroll: true });
});
// Following the device: repaint the theme button and the browser bar colour when the device switches.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!document.documentElement.dataset.theme) { syncThemeColor(); paintThemeButtons(); }
});

async function renderLogin() {
  $("#who").innerHTML = ""; $("#nav").hidden = true; document.title = `${t("Sign in")} · ADA Smart Parking`;
  document.body.dataset.screen = "login";
  let users = null;
  try { users = await api("/auth/demo-users"); }
  catch (e) { if (e.status !== 404) { showError(e); return; } }
  const demos = (users || []).map(u => {
    const roles = (u.roles || "").split(",").filter(Boolean);
    const tags = roles.length ? roles.map(label) : [label(u.affiliation)];
    return `<button type="button" class="demo" data-action="login" data-id="${esc(u.myada_user_id)}">
      <span class="demo-name">${esc(u.full_name)}</span><span class="demo-id">${esc(u.myada_user_id)}</span>
      <span class="demo-roles">${tags.map(tag => `<span class="demo-role${roles.length ? " staff" : ""}">${esc(tag)}</span>`).join("")}</span></button>`;
  }).join("");
  $("#view").innerHTML = `<div class="signin">
    <div class="signin-prefs">${prefsButtons()}</div>
    <div class="signin-panel">
      <div class="signin-sign">
      <svg class="signin-mark" viewBox="0 -18 312 219" role="img" aria-label="${esc(t("ADA University"))}">
        <defs><path id="mark-arc" d="M 33 132 A 128 128 0 0 1 289 132"/></defs>
        <text dominant-baseline="middle"><textPath href="#mark-arc" startOffset="47%" text-anchor="end">UNİVERSİTET</textPath></text>
        <text dominant-baseline="middle"><textPath href="#mark-arc" startOffset="53%" text-anchor="start">UNIVERSITY</textPath></text>
        <image href="/static/ada-mark.svg" width="312" height="201"/>
      </svg>
      <p class="signin-product">Smart Parking</p>
      </div>
      <form id="login-form" class="signin-form" novalidate>
        <h1>${esc(t("Sign in"))}</h1>
        <p class="signin-lede">${esc(t("Use your MyADA username and password."))}</p>
        <div class="login-err" role="alert"></div>
        <label class="field" for="login-user"><span>${esc(t("Username"))}</span>
        <input id="login-user" name="username" type="text" autocomplete="username"
          autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
        <label class="field" for="login-pass"><span>${esc(t("Password"))}</span>
        <input id="login-pass" name="password" type="password" autocomplete="current-password"></label>
        <button type="submit" class="signin-submit">${esc(t("Sign in"))}</button>
        <label class="signin-remember"><input id="login-remember" type="checkbox"> ${esc(t("Remember me on this computer"))}</label>
      </form>
      <a class="signin-forgot" href="https://online.ada.edu.az/password" target="_blank" rel="noopener">${esc(t("Forgot your password?"))}</a>
    </div>
    ${demos ? `<section class="demo-panel" aria-labelledby="stub-title">
      <p class="stub-label" id="stub-title"><strong>${esc(t("Prototype:"))}</strong> ${esc(t("sign in as a demo account"))}</p>
      <div class="demo-list">${demos}</div></section>` : ""}
  </div>`;
  const form = $("#login-form");
  if (form) form.onsubmit = e => { e.preventDefault(); ACTIONS.login($(".signin-submit", form)).catch(x => { if (x.message !== "Signed out") loginError(x.message); }); };
}

function loginError(msg) { const el = $(".login-err"); if (el) el.textContent = msg; }

const vehicleForm = (id, submit) => `<form id="${id}" novalidate>
  <div class="grid">
    <label class="field"><span>${esc(t("Plate number"))}</span><input name="plate" placeholder="10-AB-123" required maxlength="16"
      autocomplete="off" autocapitalize="characters" spellcheck="false"><small>${esc(t("As shown on the plate"))}</small></label>
    <label class="field"><span>${esc(t("Make"))}</span><input name="make" placeholder="Toyota" required maxlength="40" autocomplete="off"></label>
    <label class="field"><span>${esc(t("Model"))}</span><input name="model" placeholder="Corolla" required maxlength="40" autocomplete="off"></label>
    <label class="field"><span>${esc(t("Colour"))}</span><input name="color" placeholder="${esc(t("White"))}" required maxlength="30" autocomplete="off"></label>
  </div>
  <div class="actions"><button type="submit">${esc(submit)}</button></div>
  <div class="err" role="alert"></div></form>`;

function bindForm(id, fn) {
  const f = $("#" + id); if (!f) return;
  f.onsubmit = async e => {
    e.preventDefault();
    const err = $(".err", f); err.textContent = "";
    f.querySelectorAll("[aria-invalid]").forEach(i => i.removeAttribute("aria-invalid"));
    const missing = [...f.elements].filter(i => i.required && !i.value.trim());
    if (missing.length) {
      missing.forEach(i => i.setAttribute("aria-invalid", "true"));
      err.textContent = t("Fill in {fields}.", { fields: missing.map(i => i.closest("label").querySelector("span").textContent.toLowerCase()).join(", ") });
      missing[0].focus(); return;
    }
    const values = Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, String(v).trim()]));
    await busy($("button[type=submit]", f), async () => {
      try { await fn(values); }
      catch (x) {
        if (x.message === "Signed out") return;
        err.textContent = x.message;
        (x.fields || []).forEach(n => f.elements[n]?.setAttribute("aria-invalid", "true"));
      }
    });
  };
}

const vehicleLine = (p, lg) => `<div class="vehicle">${plate(p.plate_display, lg)}
  <span class="desc">${esc(p.color)} ${esc(p.make)} ${esc(p.model)}</span> ${status(p.status)}</div>`;

// Column titles are English keys, translated here so data-label (the phone layout) matches the header.
const table = (cols, rows) => `<div class="table"><table>
  <thead><tr>${cols.map(c => `<th scope="col">${esc(t(c))}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map((cell, i) => `<td data-label="${esc(t(cols[i]))}"${i === r.length - 1 && cols[i] === "" ? ' class="actions-cell"' : ""}>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;

// The owner's permit as a sign: the plate on navy, the state lit beneath it.
const STRIP = { active: "allow", pending: "wait", suspended: "check", expired: "check", rejected: "check", inactive: "idle" };
// Permit terms run to 30 June, so a term ending in the first half of a year is last year's academic year.
const term = pm => {
  if (!pm?.valid_until) return "";
  const end = new Date(pm.valid_until), y = end.getUTCFullYear();
  return end.getUTCMonth() < 7 ? `${y - 1}/${String(y).slice(2)}` : `${y}/${String(y + 1).slice(2)}`;
};
const termOf = until => term({ valid_until: until });
// Length is duration: the bar's fill is the share of the permit term still left.
function validity(pm) {
  if (pm.status !== "active" || !pm.valid_from || !pm.valid_until) return "";
  const from = Date.parse(pm.valid_from), until = Date.parse(pm.valid_until), now = Date.now();
  const left = Math.round(Math.max(0, Math.min(1, (until - now) / (until - from))) * 100), days = Math.max(0, Math.ceil((until - now) / 864e5));
  return `<div class="validity"><div class="validity-label"><span>${esc(t("Time left"))}</span><strong>${esc(t(days === 1 ? "{n} day" : "{n} days", { n: days }))}</strong></div>
    <progress max="100" value="${left}" aria-label="${esc(t("Time left on this permit"))}">${left}%</progress></div>`;
}
function permitTag(pm, note) {
  const sign = `<div class="permit-sign"><div class="permit-top"><img src="/static/ada-mark.svg" alt="${esc(t("ADA University"))}" width="44" height="28">
    <span>${esc(t("Parking permit"))}</span>${term(pm) ? `<span class="permit-term">${term(pm)}</span>` : ""}</div>
    ${pm ? plate(pm.plate_display, true) : `<span class="plate-slot">${esc(t("No vehicle yet"))}</span>`}</div>`;
  if (!pm) return `<article class="permit empty">${sign}<div class="permit-body"><p>${note}</p></div></article>`;
  const kind = STRIP[pm.status] || "idle";
  return `<article class="permit${kind === "check" || kind === "idle" ? " void" : ""}">${sign}
    <p class="permit-state ${kind}">${esc(t(STATUS[pm.status] || pm.status))}</p>
    <div class="permit-body"><p class="permit-car">${esc(pm.color)} ${esc(pm.make)} ${esc(pm.model)}</p>
      <p class="permit-holder">${esc(me.user.full_name)}, ${esc(label(me.user.affiliation))}</p>
      ${validity(pm)}
      <p class="permit-note">${note}</p>
      ${pm.status === "active" ? `<button type="button" class="ghost print-permit" data-action="print">${icon("print")}${esc(t("Print permit"))}</button>` : ""}</div></article>`;
}

// title is the English key of a section; its tab supplies the pictogram.
const page = (title, extra = "") => {
  const tab = TABS.find(x => x.label === title);
  return `<header class="page-head">${tab ? `<span class="sign-tile">${icon(tab.icon)}</span>` : ""}<h1>${esc(t(title))}</h1>${extra ? `<div class="page-tail">${extra}</div>` : ""}</header>`;
};

const VIEWS = {
  async vehicle() {
    const a = me.active_permit, p = me.pending_permit, l = me.latest_inactive_permit, c = me.change;
    const [events, msgs, passes] = await Promise.all([api("/me/gate-events"), api("/me/messages"), api("/me/visitor-passes")]);
    const rn = me.renewal, renewing = p && a && p.renews_permit_id === a.id;
    let tag, side = "";
    if (a) tag = permitTag(a, t("Valid until {date}", { date: `<strong>${esc(day(a.valid_until))}</strong>` }));
    else if (p) tag = permitTag(p, esc(t("The parking office is reviewing your registration. You can't park on campus until it is approved.")));
    else if (l?.status === "suspended") tag = permitTag(l, l.reason
      ? t("Suspended: {reason}. Contact the parking office to have it reinstated.", { reason: esc(l.reason) })
      : esc(t("Suspended. Contact the parking office to have it reinstated.")));
    else {
      tag = l ? permitTag(l, esc(t(l.status === "expired" ? "This permit has expired." : "This permit is no longer valid.")) + (l.reason ? " " + t("Reason: {reason}.", { reason: esc(l.reason) }) : ""))
        : permitTag(null, esc(t("Register your vehicle to park on campus. Each ADA member can register one vehicle, and the parking office approves it.")));
      side += `<section class="card"><h2>${esc(t(l ? "Register again" : "Register your vehicle"))}</h2>${vehicleForm("reg", t("Register vehicle"))}</section>`;
    }
    if (renewing) side += `<section class="card"><h2>${esc(t("Renewal"))}</h2><p class="notice">${esc(t("Your renewal for {term} is waiting for approval. Your current permit stays valid until {date}.", { term: termOf(rn.next_valid_until), date: day(a.valid_until) }))}</p></section>`;
    else if (a && rn?.due && !p) side += `<section class="card"><h2>${esc(t("Renew your permit"))}</h2>
      <p>${t("Your permit ends on {date}. Renew it for {term} with the same vehicle; the parking office approves it and your permit continues with no gap.", { date: `<strong>${esc(day(a.valid_until))}</strong>`, term: esc(termOf(rn.next_valid_until)) })}</p>
      <div class="actions"><button type="button" data-action="renew">${esc(t("Request renewal"))}</button></div></section>`;
    if (a && !renewing) {
      side += `<section class="card"><h2>${esc(t("Change vehicle"))}</h2>`;
      if (p) side += vehicleLine(p) + `<p class="notice">${esc(t("Your request is waiting for approval. Keep using {plate} until it is approved.", { plate: a.plate_display }))}</p>`;
      else if (c.allowed_now) side += `<p class="muted">${esc(c.override_granted ? t("The parking office allowed one early change.") : t("You can change your vehicle once every {n} days.", { n: c.cooldown_days }))} ${esc(t("The new vehicle needs approval, and your current one stays valid until then."))}</p>` + vehicleForm("chg", t("Request change"));
      else side += `<p>${esc(t("You can change your vehicle once every {n} days.", { n: c.cooldown_days }))} ${t("Your next change is possible on {date}.", { date: `<strong>${esc(day(c.next_allowed_at))}</strong>` })}</p><p class="muted">${esc(t("Sold your car or had an accident? The parking office can allow an early change."))}</p>`;
      side += `</section>`;
    }
    side += visitorPasses(passes);
    if (msgs.length) side += `<section class="card"><h2>${esc(t("Messages from campus security"))}</h2><ul class="messages">${msgs.map(m => `<li class="message">
      <h3>${esc(t(m.subject))}</h3><span class="muted">${esc(m.sender)}, ${esc(fmt(m.created_at))}</span><p>${esc(tMessage(m.body))}</p></li>`).join("")}</ul></section>`;
    const moves = `<section class="ledger"><h2>${esc(t("My entries and exits"))}</h2>${events.length
      ? table(["Time", "Movement", "Plate"], events.map(e => [esc(fmt(e.occurred_at)), esc(t(e.direction === "in" ? "Entered" : "Left")), plate(e.plate_display)]))
      : `<p class="muted">${esc(t("Your entries and exits appear here once you drive through a campus gate."))}</p>`}</section>`;
    // With nothing else beside the permit, the movements fill that column instead of leaving it empty.
    const html = page("My vehicle") + `<div class="owner"><div class="owner-tag">${tag}</div><div class="owner-side">${side || moves}</div></div>` + (side ? moves : "");
    $("#view").innerHTML = html;
    bindForm("reg", async v => { await api("/vehicles", { method: "POST", body: v }); toast(t("Vehicle sent for approval")); render(); });
    bindForm("chg", async v => { await api("/change-requests", { method: "POST", body: v }); toast(t("Change requested")); render(); });
    bindForm("pass", async v => {
      const r = await api("/visitor-passes", { method: "POST", body: { ...v, guest_name: v.guest_name || null } });
      toast(r.status === "pending" ? t("Visitor pass for {plate} sent for approval", { plate: r.plate_display })
        : t("Visitor pass issued for {plate}, {day}", { plate: r.plate_display, day: dayOf(r.valid_on).toLowerCase() }));
      render();
    });
  },

  async campus() {
    const { inside, visitors_today: guests } = await api("/admin/on-campus");
    const flagged = inside.filter(c => c.overnight || !c.authorized).length;
    $("#view").innerHTML = page("On campus", `<span class="page-count">${esc(inside.length ? t("{n} inside", { n: inside.length }) + (flagged ? t(", {n} to check", { n: flagged }) : "") : t("No cars inside"))}</span>`)
      + `<section class="ledger"><h2>${esc(t("Inside now"))}</h2>${inside.length
        ? table(["Entered at", "Plate", "Driver", "Note"], inside.map(c => [
            esc(c.overnight ? fmt(c.entered_at) : t("Today, {time}", { time: time(c.entered_at) })), plate(c.plate_display),
            c.authorized ? driver(c) : `<span class="muted">${esc(t("Not on record"))}</span>`,
            [c.overnight ? `<span class="status s-pending">${esc(t("Overnight"))}</span>` : "", c.authorized ? "" : `<span class="status s-none">${esc(t("No permit"))}</span>`].join(" ") || `<span class="muted">${esc(t("None"))}</span>`,
          ]))
        : `<p class="muted">${esc(t("No cars are inside. Entries recorded at the gate appear here until the car leaves."))}</p>`}</section>
      <section class="ledger"><h2>${esc(t("Visitors expected today"))}</h2>${guests.length
        ? table(["Plate", "Guest", "Host", "Status"], guests.map(v => [
            plate(v.plate_display), esc(v.guest_name || t("Not given")), esc(v.host),
            v.inside ? `<span class="status s-active">${esc(t("Inside"))}</span>` : v.arrived ? esc(t("Left")) : `<span class="muted">${esc(t("Not arrived"))}</span>`,
          ]))
        : `<p class="muted">${esc(t("No visitor passes for today. ADA members issue them from My vehicle."))}</p>`}</section>`;
  },

  async gate() {
    $("#view").innerHTML = page("Gate check")
      + `<section class="gate-desk"><form id="gate" novalidate>
        <label class="plate-input" for="gp"><span class="plate-input-label">${esc(t("Plate number"))}</span>
          <span class="scanner"><span class="plate-input-box">${PLATE_SIDE}<input id="gp" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="00-AA-000" enterkeyhint="done"></span></span></label>
      </form>
      <div class="gate-actions"><div class="gate-buttons">
        <button type="button" data-action="gate" data-dir="in"><span class="ico-tile">${icon("in")}</span>${esc(t("Record entry"))}</button>
        <button type="button" class="ghost" data-action="gate" data-dir="out"><span class="ico-tile">${icon("out")}</span>${esc(t("Record exit"))}</button></div>
      <p class="muted gate-hint">${esc(t("Press Enter to record an entry."))}</p></div>
      <div class="err" role="alert"></div><div id="gres" aria-live="polite"></div></section>
      <section class="ledger"><h2>${esc(t("Recent movements"))}</h2><div id="grecent"></div></section>`;
    $("#gate").onsubmit = e => { e.preventDefault(); $('[data-dir="in"]').click(); };
    $("#gp").focus();
    await gateRecent();
  },

  async search() {
    $("#view").innerHTML = page("Find a vehicle") + `<div class="card filters">
      <form id="sform" class="row" novalidate><label class="field grow"><span>${esc(t("Full or partial plate"))}</span><input id="sq" placeholder="10AB" minlength="2" autocomplete="off" autocapitalize="characters" spellcheck="false"></label><button type="submit">${esc(t("Search"))}</button></form>
      <div class="err" role="alert"></div></div><div id="sres" aria-live="polite"></div>
      <section class="ledger" id="sall"><h2>${esc(t("All registered vehicles"))}</h2><p class="muted">${esc(t("Loading…"))}</p></section>`;
    $("#sform").onsubmit = e => { e.preventDefault(); busy($("#sform button"), runSearch); };
    $("#sq").focus();
    const all = await api("/admin/vehicles/all");
    $("#sall").innerHTML = `<h2>${esc(t("All registered vehicles"))} <span class="muted">${all.length}</span></h2>${all.length
      ? table(["Plate", "Vehicle", "Owner", "Status", "Valid until"], all.map(v => [
          plate(v.plate_display), `${esc(v.color)} ${esc(v.make)} ${esc(v.model)}`,
          `${esc(v.full_name)}<span class="sub">${esc(label(v.affiliation))}</span>`, status(v.status), v.status === "active" ? esc(day(v.valid_until)) : "",
        ]))
      : `<p class="muted">${esc(t("No vehicles are registered yet."))}</p>`}`;
  },

  async queue() {
    const admin = has(...ADMINS);
    const [rows, passes] = await Promise.all([admin ? api("/admin/queue") : [], api("/admin/visitor-passes/pending")]);
    const renewals = rows.filter(r => r.renews_permit_id).length, waiting = rows.length + passes.length;
    const decide = (approve, reject, attrs) => `<button type="button" data-action="${approve}" ${attrs}>${esc(t("Approve"))}</button><button type="button" class="danger" data-action="${reject}" ${attrs}>${esc(t("Reject"))}</button>`;
    const visitors = `<section class="ledger"><h2>${esc(t("Visitor passes"))}</h2>${passes.length
      ? table(["Day", "Plate", "Guest", "Host", ""], passes.map(v => [
          esc(dayOf(v.valid_on)), plate(v.plate_display), esc(v.guest_name || t("Not given")),
          `${esc(v.host)}<span class="sub">${esc(label(v.host_affiliation))}</span>`,
          decide("approvePass", "rejectPass", `data-id="${v.id}" data-plate="${esc(v.plate_display)}"`),
        ]))
      : `<p class="muted">${esc(t("No visitor passes are waiting. Passes ADA members ask for appear here."))}</p>`}</section>`;
    $("#view").innerHTML = page("Approvals", `<span class="page-count">${esc(waiting ? t("{n} waiting", { n: waiting }) : t("Nothing waiting"))}</span>`
      + (renewals ? `<button type="button" data-action="approveRenewals">${esc(t("Approve all renewals ({n})", { n: renewals }))}</button>` : ""))
      + visitors + (!admin ? "" : `<section class="ledger"><h2>${esc(t("Permits"))}</h2>${rows.length
      ? table(["Submitted", "Person", "Vehicle", "Request", ""], rows.map(r => [
          esc(fmt(r.created_at)),
          `<strong>${esc(r.full_name)}</strong><span class="sub">${esc(label(r.affiliation))}, ${esc(r.email)}</span>`,
          `${plate(r.plate_display)}<span class="sub">${esc(r.color)} ${esc(r.make)} ${esc(r.model)}</span>`,
          r.renews_permit_id ? `${esc(t("Renewal"))}<span class="sub">${esc(t("Same vehicle, next term"))}</span>`
            : r.change_request_id ? `${esc(t("Vehicle change"))}<span class="sub">${esc(t("Replaces {plate}", { plate: r.replaces_plate }))}</span>` : esc(t("New registration")),
          decide("approve", "reject", `data-id="${r.permit_id}" data-name="${esc(r.full_name)}"`),
        ]))
      : `<p class="muted">${esc(t("No permit requests are waiting. New registrations, vehicle changes and renewals appear here."))}</p>`}</section>`);
  },

  async log() {
    $("#view").innerHTML = page("Gate log") + `<div class="card filters">
      <form id="lform" class="row" novalidate>
        <label class="field grow"><span>${esc(t("Plate"))}</span><input id="lp" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
        <label class="field"><span>${esc(t("From"))}</span><input id="lf" type="date"></label>
        <label class="field"><span>${esc(t("To"))}</span><input id="lt" type="date"></label>
        <button type="submit">${esc(t("Filter"))}</button><button type="button" class="ghost" data-action="csv">${esc(t("Download CSV"))}</button>
      </form><div class="err" role="alert"></div></div><div class="ledger" id="lres" aria-live="polite"></div>`;
    $("#lform").onsubmit = e => { e.preventDefault(); busy($("#lform button[type=submit]"), runLog); };
    await runLog();
  },

  async audit() {
    const [rows, rules] = await Promise.all([api("/admin/audit-log"), api("/admin/settings")]);
    $("#view").innerHTML = page("Audit and settings") + `<div class="card"><h2>${esc(t("Rules"))}</h2>
      <form id="settings" class="row" novalidate>
        <label class="field"><span>${esc(t("Days between vehicle changes"))}</span><input name="days" type="number" min="0" max="365" required value="${rules.change_cooldown_days}"></label>
        <label class="field"><span>${esc(t("Renewal opens, days before a permit ends"))}</span><input name="renew" type="number" min="1" max="365" required value="${rules.renewal_window_days}"></label>
        <button type="submit">${esc(t("Save"))}</button></form><div class="err" role="alert"></div></div>
      <div class="ledger"><h2>${esc(t("Audit log"))}</h2>${rows.length ? table(["Time", "Who", "Action", "Details"], rows.map(r => [
        esc(fmt(r.created_at)), esc(r.actor || t("System")), esc(label(r.action)),
        `<span class="details">${esc([r.target_type ? `${label(r.target_type)} ${r.target_id}` : "", details(r.details)].filter(Boolean).join("; "))}</span>`,
      ])) : `<p class="muted">${esc(t("Nothing recorded yet."))}</p>`}</div>`;
    $("#settings").onsubmit = async e => {
      e.preventDefault();
      const err = $("#settings + .err"); err.textContent = "";
      const days = Number(e.target.elements.days.value), renew = Number(e.target.elements.renew.value);
      if (!Number.isInteger(days) || days < 0 || days > 365) { err.textContent = t("Days between vehicle changes: enter a whole number from 0 to 365."); return; }
      if (!Number.isInteger(renew) || renew < 1 || renew > 365) { err.textContent = t("Renewal window: enter a whole number of days from 1 to 365."); return; }
      await busy($("#settings button"), async () => {
        try { await api("/admin/settings", { method: "PUT", body: { change_cooldown_days: days, renewal_window_days: renew } }); toast(t("Rules saved")); render(); }
        catch (x) { err.textContent = x.message; }
      });
    };
  },
};

function details(json) {
  if (!json) return "";
  try { return Object.entries(JSON.parse(json)).filter(([, v]) => v !== null).map(([k, v]) => `${words(k)}: ${typeof v === "boolean" ? t(v ? "yes" : "no") : v}`).join(", "); }
  catch { return json; }
}

// Who a car belongs to: its permit holder, the host of a visitor, or nobody on record.
const driver = e => e.owner ? esc(e.owner)
  : e.visitor_of ? `${esc(t("Visitor of {host}", { host: e.visitor_of }))}${e.guest_name ? `<span class="sub">${esc(e.guest_name)}</span>` : ""}`
  : `<span class="status s-none">${esc(t("No permit"))}</span>`;
const repeatLine = rp => esc(t("Entered without a permit {n} times since {date}.", { n: rp.n, date: day(rp.first_at) }));

// Pass states reuse the permit status colours: waiting is amber, approved green, rejected red.
const PASS_STATUS = { pending: ["pending", "Waiting for approval"], approved: ["active", "Approved"], rejected: ["rejected", "Rejected"] };
const passStatus = st => { const [cls, text] = PASS_STATUS[st] || ["inactive", st]; return `<span class="status s-${cls}">${esc(t(text))}</span>`; };
function visitorPasses(passes) {
  const staff = has(...STAFF);
  const list = passes.length ? `<ul class="passes">${passes.map(v => `<li class="pass">${plate(v.plate_display)}
      <span><strong>${esc(dayOf(v.valid_on))}</strong><span class="sub">${esc(v.guest_name || t("Guest"))}</span></span>
      ${passStatus(v.status)}${v.status === "rejected" && v.reason ? `<span class="sub pass-reason">${esc(v.reason)}</span>` : ""}
      <button type="button" class="ghost" data-action="revokePass" data-id="${v.id}" data-plate="${esc(v.plate_display)}">${esc(t("Cancel"))}</button></li>`).join("")}</ul>` : "";
  return `<section class="card"><h2>${esc(t("Visitor passes"))}</h2>
    <p class="muted">${esc(t(staff ? "Let a guest's car in for one day. You can ask for up to 3 passes for a day, up to 30 days ahead."
      : "Let a guest's car in for one day. Campus security approves each pass before the visit. You can ask for up to 3 passes for a day, up to 30 days ahead."))}</p>${list}
    <form id="pass" novalidate><div class="grid">
      <label class="field"><span>${esc(t("Guest's plate"))}</span><input name="plate" placeholder="10-AB-123" required maxlength="16" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      <label class="field"><span>${esc(t("Guest name (optional)"))}</span><input name="guest_name" maxlength="60" autocomplete="off"></label>
      <label class="field"><span>${esc(t("Day"))}</span><input name="valid_on" type="date" required value="${campusDay()}" min="${campusDay()}" max="${campusDay(30)}"></label>
    </div><div class="actions"><button type="submit">${esc(t(staff ? "Issue pass" : "Request pass"))}</button></div><div class="err" role="alert"></div></form></section>`;
}

const eventsTable = (rows, full) => table(
  ["Time", "Plate", "Movement", "Owner", ...(full ? ["Source", "Recorded by"] : [])],
  rows.map(e => [
    esc(fmt(e.occurred_at)), plate(e.plate_display), esc(t(e.direction === "in" ? "In" : "Out")),
    driver(e),
    ...(full ? [esc(e.source === "manual" ? t("Guard") : e.source.toUpperCase()), esc(e.recorded_by || t("Gate device"))] : []),
  ]));

async function gateRecent(fresh) {
  const rows = (await api("/admin/gate-events")).slice(0, 10);
  $("#grecent").innerHTML = rows.length ? eventsTable(rows) : `<p class="muted">${esc(t("Entries and exits recorded at the gates appear here."))}</p>`;
  if (fresh) $("#grecent tbody tr")?.classList.add("fresh", fresh);
}

// The plate the guard typed travels from the input into the verdict, so the answer reads as being about that car.
function flyPlate(from, el) {
  if (!el || calm() || !el.animate) return;
  const to = el.getBoundingClientRect(), k = from.height / to.height;
  el.animate([
    { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${k})`, opacity: .4 },
    { transform: "none", opacity: 1 },
  ], { duration: 420, easing: "cubic-bezier(.16, 1, .3, 1)" });
}

async function recordGate(btn) {
  const input = $("#gp"), err = $("#view .err"), dir = btn.dataset.dir;
  err.textContent = "";
  const value = input.value.trim();
  if (!value) { err.textContent = t("Type the plate number first."); replay($(".plate-input-box"), "nudge", 400); input.focus(); return; }
  await busy(btn, async () => {
    try {
      // Campus has one gate; the service records it as "main".
      const r = await api("/admin/gate-events", { method: "POST", body: { plate: value, direction: dir } });
      const from = $(".plate-input-box").getBoundingClientRect(), shown = r.plate_display || r.plate;
      const what = esc(t(dir === "in" ? "Entry recorded at {time}." : "Exit recorded at {time}.", { time: time(new Date().toISOString()) }));
      $("#gres").innerHTML = r.authorized
        ? `<div class="verdict allow"><span class="verdict-tile">${icon("go")}</span><div class="verdict-body"><p class="verdict-word">${esc(t("Allow"))}</p>
           <div class="vehicle">${plate(shown, true)}</div>
           ${r.visitor ? `<p><strong>${esc(t("Visitor of {host}", { host: r.visitor.host }))}</strong>${r.visitor.guest_name ? `, ${esc(r.visitor.guest_name)}` : ""}. ${esc(t("Day pass for today."))}</p>`
             : `<p><strong>${esc(r.owner)}</strong>, ${esc(label(r.affiliation))}. ${esc(r.vehicle)}.</p>`}<p class="muted">${what}</p></div></div>`
        : `<div class="verdict check"><span class="verdict-tile">${icon("stop")}</span><div class="verdict-body"><p class="verdict-word">${esc(t("Check the driver"))}</p>
           <div class="vehicle">${plate(shown, true)}</div>
           <p>${esc(t("No active permit or visitor pass for this plate. Ask for the driver's ADA ID before letting them in."))}</p>
           ${r.pending_pass ? `<p class="verdict-flag">${esc(t("{host} asked for a visitor pass for this plate today. It is waiting for approval.", { host: r.pending_pass.host }))}</p>
             <button type="button" class="verdict-action" data-action="approvePass" data-id="${r.pending_pass.id}" data-gate="1">${esc(t("Approve pass"))}</button>` : ""}
           ${r.repeat ? `<p class="verdict-flag">${repeatLine(r.repeat)}</p>` : ""}<p class="muted">${what}</p></div></div>`;
      flyPlate(from, $("#gres .plate"));
      replay($(".scanner"), "scan", 600);
      input.value = ""; input.focus({ preventScroll: true });
      $("#gres .verdict").scrollIntoView({ block: "nearest", behavior: calm() ? "auto" : "smooth" });
      gateRecent(r.authorized ? "allow" : "check").catch(() => {});
    } catch (x) { err.textContent = x.message; }
  });
}

async function runSearch() {
  const q = $("#sq").value.trim(), err = $("#view .err");
  err.textContent = "";
  if (q.replace(/[^A-Za-z0-9]/g, "").length < 2) { err.textContent = t("Type at least two letters or digits of the plate."); return; }
  try {
    const [rows, flagged] = await Promise.all([api("/admin/vehicles?plate=" + encodeURIComponent(q)), api("/admin/flagged-plates?plate=" + encodeURIComponent(q))]);
    const admin = has(...ADMINS);
    const unknown = flagged.length ? `<section class="ledger"><h2>${esc(t("Entering without a permit"))}</h2>${table(["Plate", "Entries without a permit", "Last seen"], flagged.map(f => [
      plate(f.plate_display), `<span class="status s-none">${esc(t("{n} times", { n: f.n }))}</span><span class="sub">${esc(t("Since {date}", { date: day(f.first_at) }))}</span>`, esc(fmt(f.last_at))]))}</section>` : "";
    const templates = ["move", "incident", "lights"].map((v, i) => `<option value="${v}">${esc(t(["Please move your vehicle", "Your vehicle was involved in an incident", "Your vehicle's lights are on"][i]))}</option>`).join("");
    $("#sres").innerHTML = !rows.length && unknown ? unknown : (rows.length ? `<div class="card results">` + rows.map(r => `<article class="result">
      ${vehicleLine(r)}${r.repeat ? `<p class="flag">${repeatLine(r.repeat)}</p>` : ""}
      <p><strong>${esc(r.full_name)}</strong>, ${esc(label(r.affiliation))}${admin ? `<span class="sub">${esc(r.email)}${r.phone ? `, ${esc(r.phone)}` : ""}</span>` : ""}</p>
      <p class="muted">${esc(r.last_event ? t(r.last_event.direction === "in" ? "Last entered campus on {date}." : "Last left campus on {date}.", { date: fmt(r.last_event.occurred_at) }) : t("No gate movements recorded."))}${r.valid_until && r.status === "active" ? " " + esc(t("Permit valid until {date}.", { date: day(r.valid_until) })) : ""}</p>
      ${admin ? `<div class="row">
        <label class="field"><span>${esc(t("Message"))}</span><select class="tpl" name="template">${templates}</select></label>
        <button type="button" class="ghost" data-action="contact" data-user="${r.user_id}" data-plate="${esc(r.plate_display)}" data-name="${esc(r.full_name)}">${esc(t("Send message"))}</button>
        ${r.status === "active" ? `<button type="button" class="ghost" data-action="override" data-user="${r.user_id}" data-name="${esc(r.full_name)}">${esc(t("Allow early vehicle change"))}</button>
          <button type="button" class="danger" data-action="suspend" data-id="${r.permit_id}" data-plate="${esc(r.plate_display)}">${esc(t("Suspend permit"))}</button>` : ""}
        ${r.status === "suspended" ? `<button type="button" class="ghost" data-action="reinstate" data-id="${r.permit_id}" data-plate="${esc(r.plate_display)}">${esc(t("Reinstate permit"))}</button>` : ""}
      </div>` : ""}</article>`).join("") + `</div>` + unknown : `<div class="card"><p class="muted">${esc(t("No vehicle matches “{q}”. Check the characters and try a shorter part of the plate.", { q }))}</p></div>`);
  } catch (x) { err.textContent = x.message; }
}

function logQuery() {
  return new URLSearchParams(Object.entries({ plate: $("#lp").value.trim(), from: $("#lf").value, to: $("#lt").value }).filter(([, v]) => v)).toString();
}

async function runLog() {
  const err = $("#view .err"); err.textContent = "";
  try {
    const rows = await api("/admin/gate-events?" + logQuery());
    $("#lres").innerHTML = rows.length ? eventsTable(rows, true) : `<p class="muted">${esc(t("No movements match these filters."))}</p>`;
  } catch (x) { err.textContent = x.message; }
}

// Actions that need a reason or a confirmation.
const ACTIONS = {
  async login(b) {
    const id = b.dataset.id || document.getElementById("login-user")?.value.trim();
    const user = document.getElementById("login-user");
    if (!id) { loginError(t("Enter your username.")); user?.setAttribute("aria-invalid", "true"); user?.focus(); return; }
    user?.removeAttribute("aria-invalid"); loginError("");
    if (b.dataset.id) b.classList.add("picked");
    let r;
    try { r = await api("/auth/mock-login", { method: "POST", body: { myada_user_id: id } }); }
    catch (x) { b.classList.remove("picked"); throw x; }
    token = r.token; setStore(token, !!document.getElementById("login-remember")?.checked);
    if (location.hash) history.replaceState(null, "", location.pathname);
    await leave($(".signin"), "unhook");
    await render({ enter: true }); $("#view").focus({ preventScroll: true });
  },
  signout() { signOut(t("Signed out")); },
  toggleTheme() {
    const next = darkNow() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* storage blocked: lasts for this page */ }
    syncThemeColor(); paintThemeButtons();
  },
  async toggleLang(b) {
    LANG = LANG === "az" ? "en" : "az";
    document.documentElement.lang = LANG;
    try { localStorage.setItem("lang", LANG); } catch { /* storage blocked: lasts for this page */ }
    applyShellText();
    await render();
    $(`[data-action="toggleLang"]`)?.focus();
  },
  print() { window.print(); },
  async renew() {
    await api("/me/renewal", { method: "POST" });
    toast(t("Renewal requested")); await render();
  },
  async revokePass(b) {
    if (!await ask({ title: t("Cancel the visitor pass for {plate}?", { plate: b.dataset.plate }), text: t("The gate will check this car again."), confirm: t("Cancel pass"), danger: true })) return;
    await api(`/visitor-passes/${b.dataset.id}/revoke`, { method: "POST" });
    toast(t("Visitor pass cancelled")); await render();
  },
  async approvePass(b) {
    await api(`/admin/visitor-passes/${b.dataset.id}/approve`, { method: "POST" });
    toast(t("Visitor pass approved"));
    // At the gate the guard records the entry again; elsewhere the row leaves the list.
    if (b.dataset.gate) { b.remove(); $("#gp").focus(); return; }
    await leave(b.closest("tr"), "leaving approved"); await render();
  },
  async rejectPass(b) {
    const reason = await ask({ title: t("Reject the visitor pass for {plate}?", { plate: b.dataset.plate }), field: { label: t("Reason, shown to the host"), required: true }, confirm: t("Reject pass"), danger: true });
    if (!reason) return;
    await api(`/admin/visitor-passes/${b.dataset.id}/reject`, { method: "POST", body: { reason } });
    toast(t("Visitor pass rejected")); await leave(b.closest("tr")); await render();
  },
  async approveRenewals() {
    const r = await api("/admin/renewals/approve-all", { method: "POST" });
    toast(t(r.approved === 1 ? "{n} renewal approved" : "{n} renewals approved", { n: r.approved }) + (r.skipped ? t(", {n} skipped", { n: r.skipped }) : "")); await render();
  },
  retry() { return render(); },
  gate: recordGate,
  async csv(b) {
    const res = await api("/admin/gate-events?format=csv&" + logQuery(), { raw: true });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement("a"), { href: url, download: "gate-log.csv" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async approve(b) {
    await api(`/admin/permits/${b.dataset.id}/approve`, { method: "POST", body: {} });
    toast(t("Approved")); await leave(b.closest("tr"), "leaving approved"); await render();
  },
  async reject(b) {
    const reason = await ask({ title: t("Reject {name}'s request?", { name: b.dataset.name }), field: { label: t("Reason, shown to the person"), required: true }, confirm: t("Reject request"), danger: true });
    if (!reason) return;
    await api(`/admin/permits/${b.dataset.id}/reject`, { method: "POST", body: { reason } });
    toast(t("Rejected")); await leave(b.closest("tr")); await render();
  },
  async contact(b) {
    const sel = $(".tpl", b.closest(".result, .card"));
    const note = await ask({ title: t("Send “{template}”", { template: sel.selectedOptions[0].text }), text: t("To {name}, about {plate}.", { name: b.dataset.name, plate: b.dataset.plate }), field: { label: t("Note to add"), max: 500 }, confirm: t("Send message") });
    if (note === null) return;
    const r = await api(`/admin/users/${b.dataset.user}/contact`, { method: "POST", body: { template: sel.value, plate: b.dataset.plate, note: note || null } });
    toast(t("Message sent to {email}", { email: r.sent_to }));
  },
  async suspend(b) {
    const reason = await ask({ title: t("Suspend the permit for {plate}?", { plate: b.dataset.plate }), text: t("The gate will flag this vehicle until the permit is reinstated."), field: { label: t("Reason, shown to the owner"), required: true }, confirm: t("Suspend permit"), danger: true });
    if (!reason) return;
    await api(`/admin/permits/${b.dataset.id}/suspend`, { method: "POST", body: { reason } });
    toast(t("Permit suspended")); await runSearch();
  },
  async reinstate(b) {
    if (!await ask({ title: t("Reinstate the permit for {plate}?", { plate: b.dataset.plate }), text: t("The vehicle will be allowed through the gates again."), confirm: t("Reinstate permit") })) return;
    await api(`/admin/permits/${b.dataset.id}/reinstate`, { method: "POST", body: {} });
    toast(t("Permit reinstated")); await runSearch();
  },
  async override(b) {
    const reason = await ask({ title: t("Allow {name} an early vehicle change?", { name: b.dataset.name }), text: t("They can request one change now, without waiting for the usual interval."), field: { label: t("Reason"), required: true, placeholder: t("Car sold, accident, rental") }, confirm: t("Allow early change") });
    if (!reason) return;
    await api(`/admin/users/${b.dataset.user}/cooldown-override`, { method: "POST", body: { reason } });
    toast(t("Early change allowed once"));
  },
};

document.addEventListener("click", e => {
  const b = e.target.closest("[data-action]");
  if (!b || !ACTIONS[b.dataset.action]) return;
  e.preventDefault();
  const run = () => ACTIONS[b.dataset.action](b);
  // Display switches act at once; actions that open a dialog manage their own flow; the rest lock the button while they run.
  if (b.dataset.action === "toggleTheme" || b.dataset.action === "print") return run();
  const guarded = b.dataset.action === "gate" ? run() : busy(b, run);
  Promise.resolve(guarded).catch(x => { if (x.message !== "Signed out") toast(x.message, "error"); });
});

syncThemeColor();
applyShellText();
render({ enter: true });
