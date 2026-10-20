"use strict";
// Single-page UI for vehicle owners, guards and admins. No inline handlers: the page runs
// under a strict Content-Security-Policy, so every action goes through data-action delegation.

const API = "/api/v1";
let token = null;
// "Remember me" keeps the token in localStorage; otherwise it lasts as long as the tab.
try { token = sessionStorage.getItem("token") || localStorage.getItem("token"); } catch { /* storage blocked */ }
let me = null;

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TZ = "Asia/Baku"; // campus time, whatever the device is set to
const fmt = iso => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "";
const day = iso => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: TZ }) : "";
const time = iso => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
// Calendar dates (YYYY-MM-DD) as campus sees them.
const campusDay = (offset = 0) => new Date(Date.now() + offset * 864e5).toLocaleDateString("en-CA", { timeZone: TZ });
const dayOf = ymd => ymd === campusDay() ? "Today" : ymd === campusDay(1) ? "Tomorrow"
  : new Date(ymd + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const words = s => String(s ?? "").replaceAll("_", " ");
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : "";

const STATUS = { active: "Active", pending: "Waiting for approval", rejected: "Rejected", suspended: "Suspended", expired: "Expired", inactive: "Replaced" };
const status = s => `<span class="status s-${esc(s)}">${esc(STATUS[s] || s)}</span>`;
// The left band of a real AZ plate: the national flag above the boxed "AZ" RFID label.
const PLATE_SIDE = `<span class="plate-side" aria-hidden="true"><i class="plate-flag"></i><b class="plate-az">AZ</b></span>`;
// AZS 599 (Figure 18): every character sits in a 45 mm cell, and separators are raised 15 x 10 mm bars,
// not the font's hyphen, whatever was typed.
// Plates recorded without separators ("10AB123") are split into the standard 10-AB-123 groups.
const plateGroups = p => {
  const t = String(p ?? "").trim().toUpperCase(), m = t.match(/^(\d{2})([A-Z]{1,2})(\d{3})$/);
  return m ? m.slice(1) : t.split(/[\s-]+/);
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

const plate = (p, lg) => `<span class="plate${lg ? " lg" : ""}" role="img" aria-label="Plate ${esc(p)}">${PLATE_SIDE}<span class="plate-num" aria-hidden="true">${plateChars(p)}</span></span>`;

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
};
const icon = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

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
  const t = $("#toast");
  t.textContent = msg; t.className = "show " + kind;
  clearTimeout(t._h); t._h = setTimeout(() => { t.className = kind; }, kind === "error" ? 6000 : 3000);
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
    throw new Error("Can't reach the parking service. Check your connection and try again.");
  }
  if (res.status === 401 && token) { signOut("Your session ended. Sign in again."); throw new Error("Signed out"); }
  if (opts.raw && res.ok) return res;
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const d = data?.detail;
    let msg = "Something went wrong on the server. Try again in a moment.";
    if (typeof d === "string") msg = d;
    else if (d?.message) msg = d.message + (d.next_allowed_at ? `. Next possible on ${day(d.next_allowed_at)}.` : "");
    else if (Array.isArray(d)) msg = d.map(fieldError).join(" ");
    const err = new Error(msg); err.status = res.status; err.fields = Array.isArray(d) ? d.map(e => e.loc.at(-1)) : [];
    throw err;
  }
  return data;
}

const FIELD_NAMES = { plate: "Plate number", make: "Make", model: "Model", color: "Colour", reason: "Reason", guest_name: "Guest name", valid_on: "Day" };
function fieldError(e) {
  const name = FIELD_NAMES[e.loc.at(-1)] || cap(words(e.loc.at(-1)));
  if (e.type === "string_pattern_mismatch") return e.loc.at(-1) === "plate"
    ? "Plate number: use letters and digits, separated by single spaces or hyphens, like 10-AB-123."
    : `${name}: remove special characters such as < or >.`;
  if (e.type === "string_too_short") return `${name} is too short.`;
  if (e.type === "string_too_long") return `${name} is too long.`;
  return `${name}: ${e.msg}.`;
}

// Disables the button while the request runs, so a double click cannot submit twice.
async function busy(btn, fn) {
  if (btn?.getAttribute("aria-busy") === "true") return;
  btn?.setAttribute("aria-busy", "true"); if (btn) btn.disabled = true;
  try { return await fn(); } finally { if (btn?.isConnected) { btn.removeAttribute("aria-busy"); btn.disabled = false; } }
}

// Accessible replacement for prompt()/confirm(). Resolves to the text (or true), or null when cancelled.
function ask({ title, text = "", field = null, confirm = "Confirm", danger = false }) {
  const d = $("#dlg");
  d.innerHTML = `<form class="dlg">
    <h2 id="dlg-title">${esc(title)}</h2>
    ${text ? `<p>${esc(text)}</p>` : ""}
    ${field ? `<label class="field"><span>${esc(field.label)}${field.required ? "" : " (optional)"}</span>
      <textarea name="v" rows="3" maxlength="${field.max || 300}" ${field.required ? "required" : ""} placeholder="${esc(field.placeholder || "")}"></textarea></label>` : ""}
    <div class="actions"><button type="button" class="ghost" data-cancel>Cancel</button>
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
    <span class="role${me.roles.length ? "" : " lead"}">${esc(cap(me.user.affiliation))}</span>
    ${me.roles.map((r, i) => `<span class="role extra${i ? "" : " lead"}">${esc(cap(words(r)))}</span>`).join("")}
    <button type="button" data-action="signout">Sign out</button>`;
  const tabs = TABS.filter(t => t.show());
  const current = tabs.find(t => "#" + t.id === location.hash)?.id || (has("guard") ? "gate" : "vehicle");
  const nav = $("#nav"); nav.hidden = tabs.length < 2;
  nav.innerHTML = tabs.map(t => `<a href="#${t.id}"${t.id === current ? ' aria-current="page"' : ""}>${icon(t.icon)}${esc(t.label)}</a>`).join("");
  showTab(nav);
  document.title = `${tabs.find(t => t.id === current).label} · ADA Smart Parking`;
  try { await VIEWS[current](); } catch (e) { if (seq === renderSeq) showError(e); }
  if (enter && seq === renderSeq) replay($("#view"), "enter");
}

function showError(e) {
  $("#view").innerHTML = `<div class="card" role="alert"><h2>This page didn't load</h2>
    <p>${esc(e.message)}</p><button type="button" data-action="retry">Try again</button></div>`;
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

async function renderLogin() {
  $("#who").innerHTML = ""; $("#nav").hidden = true; document.title = "Sign in · ADA Smart Parking";
  document.body.dataset.screen = "login";
  let users = null;
  try { users = await api("/auth/demo-users"); }
  catch (e) { if (e.status !== 404) { showError(e); return; } }
  const demos = (users || []).map(u => {
    const roles = (u.roles || "").split(",").filter(Boolean);
    const tags = roles.length ? roles.map(r => ROLE_TAG[r] || cap(words(r))) : [cap(u.affiliation)];
    return `<button type="button" class="demo" data-action="login" data-id="${esc(u.myada_user_id)}">
      <span class="demo-name">${esc(u.full_name)}</span><span class="demo-id">${esc(u.myada_user_id)}</span>
      <span class="demo-roles">${tags.map(t => `<span class="demo-role${roles.length ? " staff" : ""}">${esc(t)}</span>`).join("")}</span></button>`;
  }).join("");
  $("#view").innerHTML = `<div class="signin">
    <div class="signin-panel">
      <div class="signin-sign">
      <svg class="signin-mark" viewBox="0 -18 312 219" role="img" aria-label="ADA University">
        <defs><path id="mark-arc" d="M 33 132 A 128 128 0 0 1 289 132"/></defs>
        <text dominant-baseline="middle"><textPath href="#mark-arc" startOffset="47%" text-anchor="end">UNİVERSİTET</textPath></text>
        <text dominant-baseline="middle"><textPath href="#mark-arc" startOffset="53%" text-anchor="start">UNIVERSITY</textPath></text>
        <image href="/static/ada-mark.svg" width="312" height="201"/>
      </svg>
      <p class="signin-product">Smart Parking</p>
      </div>
      <form id="login-form" class="signin-form" novalidate>
        <h1>Sign in</h1>
        <p class="signin-lede">Use your MyADA username and password.</p>
        <div class="login-err" role="alert"></div>
        <label class="field" for="login-user"><span>Username</span>
        <input id="login-user" name="username" type="text" autocomplete="username"
          autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
        <label class="field" for="login-pass"><span>Password</span>
        <input id="login-pass" name="password" type="password" autocomplete="current-password"></label>
        <button type="submit" class="signin-submit">Sign in</button>
        <label class="signin-remember"><input id="login-remember" type="checkbox"> Remember me on this computer</label>
      </form>
      <a class="signin-forgot" href="https://online.ada.edu.az/password" target="_blank" rel="noopener">Forgot your password?</a>
    </div>
    ${demos ? `<section class="demo-panel" aria-labelledby="stub-title">
      <p class="stub-label" id="stub-title"><strong>Prototype:</strong> sign in as a demo account</p>
      <div class="demo-list">${demos}</div></section>` : ""}
  </div>`;
  const form = $("#login-form");
  if (form) form.onsubmit = e => { e.preventDefault(); ACTIONS.login($(".signin-submit", form)).catch(x => { if (x.message !== "Signed out") loginError(x.message); }); };
}

const ROLE_TAG = { guard: "Guard", parking_admin: "Parking admin", system_admin: "System admin" };

function loginError(msg) { const el = $(".login-err"); if (el) el.textContent = msg; }

const vehicleForm = (id, submit) => `<form id="${id}" novalidate>
  <div class="grid">
    <label class="field"><span>Plate number</span><input name="plate" placeholder="10-AB-123" required maxlength="16"
      autocomplete="off" autocapitalize="characters" spellcheck="false"><small>As shown on the plate</small></label>
    <label class="field"><span>Make</span><input name="make" placeholder="Toyota" required maxlength="40" autocomplete="off"></label>
    <label class="field"><span>Model</span><input name="model" placeholder="Corolla" required maxlength="40" autocomplete="off"></label>
    <label class="field"><span>Colour</span><input name="color" placeholder="White" required maxlength="30" autocomplete="off"></label>
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
      err.textContent = "Fill in " + missing.map(i => i.closest("label").querySelector("span").textContent.toLowerCase()).join(", ") + ".";
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

const table = (cols, rows) => `<div class="table"><table>
  <thead><tr>${cols.map(c => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map((cell, i) => `<td data-label="${esc(cols[i])}"${i === r.length - 1 && cols[i] === "" ? ' class="actions-cell"' : ""}>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
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
  return `<div class="validity"><div class="validity-label"><span>Time left</span><strong>${days} ${days === 1 ? "day" : "days"}</strong></div>
    <progress max="100" value="${left}" aria-label="Time left on this permit">${left}%</progress></div>`;
}
function permitTag(pm, note) {
  const sign = `<div class="permit-sign"><div class="permit-top"><img src="/static/ada-mark.svg" alt="ADA University" width="44" height="28">
    <span>Parking permit</span>${term(pm) ? `<span class="permit-term">${term(pm)}</span>` : ""}</div>
    ${pm ? plate(pm.plate_display, true) : `<span class="plate-slot">No vehicle yet</span>`}</div>`;
  if (!pm) return `<article class="permit empty">${sign}<div class="permit-body"><p>${note}</p></div></article>`;
  const kind = STRIP[pm.status] || "idle";
  return `<article class="permit${kind === "check" || kind === "idle" ? " void" : ""}">${sign}
    <p class="permit-state ${kind}">${esc(STATUS[pm.status] || pm.status)}</p>
    <div class="permit-body"><p class="permit-car">${esc(pm.color)} ${esc(pm.make)} ${esc(pm.model)}</p>
      <p class="permit-holder">${esc(me.user.full_name)}, ${esc(cap(me.user.affiliation))}</p>
      ${validity(pm)}
      <p class="permit-note">${note}</p></div></article>`;
}

const page = (title, extra = "") => {
  const tab = TABS.find(t => t.label === title);
  return `<header class="page-head">${tab ? `<span class="sign-tile">${icon(tab.icon)}</span>` : ""}<h1>${esc(title)}</h1>${extra ? `<div class="page-tail">${extra}</div>` : ""}</header>`;
};

const VIEWS = {
  async vehicle() {
    const a = me.active_permit, p = me.pending_permit, l = me.latest_inactive_permit, c = me.change;
    const [events, msgs, passes] = await Promise.all([api("/me/gate-events"), api("/me/messages"), api("/me/visitor-passes")]);
    const rn = me.renewal, renewing = p && a && p.renews_permit_id === a.id;
    let tag, side = "";
    if (a) tag = permitTag(a, `Valid until <strong>${day(a.valid_until)}</strong>`);
    else if (p) tag = permitTag(p, "The parking office is reviewing your registration. You can't park on campus until it is approved.");
    else if (l?.status === "suspended") tag = permitTag(l, `Suspended${l.reason ? `: ${esc(l.reason)}` : ""}. Contact the parking office to have it reinstated.`);
    else {
      tag = l ? permitTag(l, (l.status === "expired" ? "This permit has expired." : "This permit is no longer valid.") + (l.reason ? ` Reason: ${esc(l.reason)}.` : ""))
        : permitTag(null, "Register your vehicle to park on campus. Each ADA member can register one vehicle, and the parking office approves it.");
      side += `<section class="card"><h2>${l ? "Register again" : "Register your vehicle"}</h2>${vehicleForm("reg", "Register vehicle")}</section>`;
    }
    if (renewing) side += `<section class="card"><h2>Renewal</h2><p class="notice">Your renewal for ${termOf(rn.next_valid_until)} is waiting for approval. Your current permit stays valid until ${day(a.valid_until)}.</p></section>`;
    else if (a && rn?.due && !p) side += `<section class="card"><h2>Renew your permit</h2>
      <p>Your permit ends on <strong>${day(a.valid_until)}</strong>. Renew it for ${termOf(rn.next_valid_until)} with the same vehicle; the parking office approves it and your permit continues with no gap.</p>
      <div class="actions"><button type="button" data-action="renew">Request renewal</button></div></section>`;
    if (a && !renewing) {
      side += `<section class="card"><h2>Change vehicle</h2>`;
      if (p) side += vehicleLine(p) + `<p class="notice">Your request is waiting for approval. Keep using ${esc(a.plate_display)} until it is approved.</p>`;
      else if (c.allowed_now) side += `<p class="muted">${c.override_granted ? "The parking office allowed one early change." : `You can change your vehicle once every ${c.cooldown_days} days.`} The new vehicle needs approval, and your current one stays valid until then.</p>` + vehicleForm("chg", "Request change");
      else side += `<p>You can change your vehicle once every ${c.cooldown_days} days. Your next change is possible on <strong>${day(c.next_allowed_at)}</strong>.</p><p class="muted">Sold your car or had an accident? The parking office can allow an early change.</p>`;
      side += `</section>`;
    }
    side += visitorPasses(passes);
    if (msgs.length) side += `<section class="card"><h2>Messages from campus security</h2><ul class="messages">${msgs.map(m => `<li class="message">
      <h3>${esc(m.subject)}</h3><span class="muted">${esc(m.sender)}, ${fmt(m.created_at)}</span><p>${esc(m.body)}</p></li>`).join("")}</ul></section>`;
    const moves = `<section class="ledger"><h2>My entries and exits</h2>${events.length
      ? table(["Time", "Movement", "Plate"], events.map(e => [fmt(e.occurred_at), e.direction === "in" ? "Entered" : "Left", plate(e.plate_display)]))
      : `<p class="muted">Your entries and exits appear here once you drive through a campus gate.</p>`}</section>`;
    // With nothing else beside the permit, the movements fill that column instead of leaving it empty.
    const html = page("My vehicle") + `<div class="owner"><div class="owner-tag">${tag}</div><div class="owner-side">${side || moves}</div></div>` + (side ? moves : "");
    $("#view").innerHTML = html;
    bindForm("reg", async v => { await api("/vehicles", { method: "POST", body: v }); toast("Vehicle sent for approval"); render(); });
    bindForm("chg", async v => { await api("/change-requests", { method: "POST", body: v }); toast("Change requested"); render(); });
    bindForm("pass", async v => {
      const r = await api("/visitor-passes", { method: "POST", body: { ...v, guest_name: v.guest_name || null } });
      toast(r.status === "pending" ? `Visitor pass for ${r.plate_display} sent for approval` : `Visitor pass issued for ${r.plate_display}, ${dayOf(r.valid_on).toLowerCase()}`); render();
    });
  },

  async campus() {
    const { inside, visitors_today: guests } = await api("/admin/on-campus");
    const flagged = inside.filter(c => c.overnight || !c.authorized).length;
    $("#view").innerHTML = page("On campus", `<span class="page-count">${inside.length ? `${inside.length} inside${flagged ? `, ${flagged} to check` : ""}` : "No cars inside"}</span>`)
      + `<section class="ledger"><h2>Inside now</h2>${inside.length
        ? table(["Entered", "Plate", "Driver", "Note"], inside.map(c => [
            c.overnight ? fmt(c.entered_at) : `Today, ${time(c.entered_at)}`, plate(c.plate_display),
            c.authorized ? driver(c) : `<span class="muted">Not on record</span>`,
            [c.overnight ? `<span class="status s-pending">Overnight</span>` : "", c.authorized ? "" : `<span class="status s-none">No permit</span>`].join(" ") || `<span class="muted">None</span>`,
          ]))
        : `<p class="muted">No cars are inside. Entries recorded at the gate appear here until the car leaves.</p>`}</section>
      <section class="ledger"><h2>Visitors expected today</h2>${guests.length
        ? table(["Plate", "Guest", "Host", "Status"], guests.map(v => [
            plate(v.plate_display), esc(v.guest_name || "Not given"), esc(v.host),
            v.inside ? `<span class="status s-active">Inside</span>` : v.arrived ? "Left" : `<span class="muted">Not arrived</span>`,
          ]))
        : `<p class="muted">No visitor passes for today. ADA members issue them from My vehicle.</p>`}</section>`;
  },

  async gate() {
    $("#view").innerHTML = page("Gate check")
      + `<section class="gate-desk"><form id="gate" novalidate>
        <label class="plate-input" for="gp"><span class="plate-input-label">Plate number</span>
          <span class="scanner"><span class="plate-input-box">${PLATE_SIDE}<input id="gp" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="00-AA-000" enterkeyhint="done"></span></span></label>
      </form>
      <div class="gate-actions"><div class="gate-buttons">
        <button type="button" data-action="gate" data-dir="in"><span class="ico-tile">${icon("in")}</span>Record entry</button>
        <button type="button" class="ghost" data-action="gate" data-dir="out"><span class="ico-tile">${icon("out")}</span>Record exit</button></div>
      <p class="muted gate-hint">Press Enter to record an entry.</p></div>
      <div class="err" role="alert"></div><div id="gres" aria-live="polite"></div></section>
      <section class="ledger"><h2>Recent movements</h2><div id="grecent"></div></section>`;
    $("#gate").onsubmit = e => { e.preventDefault(); $('[data-dir="in"]').click(); };
    $("#gp").focus();
    await gateRecent();
  },

  async search() {
    $("#view").innerHTML = page("Find a vehicle") + `<div class="card filters">
      <form id="sform" class="row" novalidate><label class="field grow"><span>Full or partial plate</span><input id="sq" placeholder="10AB" minlength="2" autocomplete="off" autocapitalize="characters" spellcheck="false"></label><button type="submit">Search</button></form>
      <div class="err" role="alert"></div></div><div id="sres" aria-live="polite"></div>
      <section class="ledger" id="sall"><h2>All registered vehicles</h2><p class="muted">Loading…</p></section>`;
    $("#sform").onsubmit = e => { e.preventDefault(); busy($("#sform button"), runSearch); };
    $("#sq").focus();
    const all = await api("/admin/vehicles/all");
    $("#sall").innerHTML = `<h2>All registered vehicles <span class="muted">${all.length}</span></h2>${all.length
      ? table(["Plate", "Vehicle", "Owner", "Status", "Valid until"], all.map(v => [
          plate(v.plate_display), `${esc(v.color)} ${esc(v.make)} ${esc(v.model)}`,
          `${esc(v.full_name)}<span class="sub">${esc(cap(v.affiliation))}</span>`, status(v.status), v.status === "active" ? esc(day(v.valid_until)) : "",
        ]))
      : `<p class="muted">No vehicles are registered yet.</p>`}`;
  },

  async queue() {
    const admin = has(...ADMINS);
    const [rows, passes] = await Promise.all([admin ? api("/admin/queue") : [], api("/admin/visitor-passes/pending")]);
    const renewals = rows.filter(r => r.renews_permit_id).length, waiting = rows.length + passes.length;
    const visitors = `<section class="ledger"><h2>Visitor passes</h2>${passes.length
      ? table(["Day", "Plate", "Guest", "Host", ""], passes.map(v => [
          esc(dayOf(v.valid_on)), plate(v.plate_display), esc(v.guest_name || "Not given"),
          `${esc(v.host)}<span class="sub">${esc(cap(v.host_affiliation))}</span>`,
          `<button type="button" data-action="approvePass" data-id="${v.id}">Approve</button><button type="button" class="danger" data-action="rejectPass" data-id="${v.id}" data-plate="${esc(v.plate_display)}">Reject</button>`,
        ]))
      : `<p class="muted">No visitor passes are waiting. Passes ADA members ask for appear here.</p>`}</section>`;
    $("#view").innerHTML = page("Approvals", `<span class="page-count">${waiting ? `${waiting} waiting` : "Nothing waiting"}</span>`
      + (renewals ? `<button type="button" data-action="approveRenewals">Approve all renewals (${renewals})</button>` : ""))
      + visitors + (!admin ? "" : `<section class="ledger"><h2>Permits</h2>${rows.length
      ? table(["Submitted", "Person", "Vehicle", "Request", ""], rows.map(r => [
          fmt(r.created_at),
          `<strong>${esc(r.full_name)}</strong><span class="sub">${esc(cap(r.affiliation))}, ${esc(r.email)}</span>`,
          `${plate(r.plate_display)}<span class="sub">${esc(r.color)} ${esc(r.make)} ${esc(r.model)}</span>`,
          r.renews_permit_id ? `Renewal<span class="sub">Same vehicle, next term</span>`
            : r.change_request_id ? `Vehicle change<span class="sub">Replaces ${esc(r.replaces_plate)}</span>` : "New registration",
          `<button type="button" data-action="approve" data-id="${r.permit_id}">Approve</button><button type="button" class="danger" data-action="reject" data-id="${r.permit_id}" data-name="${esc(r.full_name)}">Reject</button>`,
        ]))
      : `<p class="muted">No permit requests are waiting. New registrations, vehicle changes and renewals appear here.</p>`}</section>`);
  },

  async log() {
    $("#view").innerHTML = page("Gate log") + `<div class="card filters">
      <form id="lform" class="row" novalidate>
        <label class="field grow"><span>Plate</span><input id="lp" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
        <label class="field"><span>From</span><input id="lf" type="date"></label>
        <label class="field"><span>To</span><input id="lt" type="date"></label>
        <button type="submit">Filter</button><button type="button" class="ghost" data-action="csv">Download CSV</button>
      </form><div class="err" role="alert"></div></div><div class="ledger" id="lres" aria-live="polite"></div>`;
    $("#lform").onsubmit = e => { e.preventDefault(); busy($("#lform button[type=submit]"), runLog); };
    await runLog();
  },

  async audit() {
    const [rows, rules] = await Promise.all([api("/admin/audit-log"), api("/admin/settings")]);
    $("#view").innerHTML = page("Audit and settings") + `<div class="card"><h2>Rules</h2>
      <form id="settings" class="row" novalidate>
        <label class="field"><span>Days between vehicle changes</span><input name="days" type="number" min="0" max="365" required value="${rules.change_cooldown_days}"></label>
        <label class="field"><span>Renewal opens, days before a permit ends</span><input name="renew" type="number" min="1" max="365" required value="${rules.renewal_window_days}"></label>
        <button type="submit">Save</button></form><div class="err" role="alert"></div></div>
      <div class="ledger"><h2>Audit log</h2>${rows.length ? table(["Time", "Who", "Action", "Details"], rows.map(r => [
        fmt(r.created_at), esc(r.actor || "System"), esc(cap(words(r.action))),
        `<span class="details">${esc([r.target_type ? `${cap(words(r.target_type))} ${r.target_id}` : "", details(r.details)].filter(Boolean).join("; "))}</span>`,
      ])) : `<p class="muted">Nothing recorded yet.</p>`}</div>`;
    $("#settings").onsubmit = async e => {
      e.preventDefault();
      const err = $("#settings + .err"); err.textContent = "";
      const days = Number(e.target.elements.days.value), renew = Number(e.target.elements.renew.value);
      if (!Number.isInteger(days) || days < 0 || days > 365) { err.textContent = "Days between vehicle changes: enter a whole number from 0 to 365."; return; }
      if (!Number.isInteger(renew) || renew < 1 || renew > 365) { err.textContent = "Renewal window: enter a whole number of days from 1 to 365."; return; }
      await busy($("#settings button"), async () => {
        try { await api("/admin/settings", { method: "PUT", body: { change_cooldown_days: days, renewal_window_days: renew } }); toast("Rules saved"); render(); }
        catch (x) { err.textContent = x.message; }
      });
    };
  },
};

function details(json) {
  if (!json) return "";
  try { return Object.entries(JSON.parse(json)).filter(([, v]) => v !== null).map(([k, v]) => `${words(k)}: ${typeof v === "boolean" ? (v ? "yes" : "no") : v}`).join(", "); }
  catch { return json; }
}

// Who a car belongs to: its permit holder, the host of a visitor, or nobody on record.
const driver = e => e.owner ? esc(e.owner)
  : e.visitor_of ? `Visitor of ${esc(e.visitor_of)}${e.guest_name ? `<span class="sub">${esc(e.guest_name)}</span>` : ""}`
  : `<span class="status s-none">No permit</span>`;
const repeatLine = rp => `Entered without a permit ${rp.n} times since ${day(rp.first_at)}.`;

// Pass states reuse the permit status colours: waiting is amber, approved green, rejected red.
const PASS_STATUS = { pending: ["pending", "Waiting for approval"], approved: ["active", "Approved"], rejected: ["rejected", "Rejected"] };
const passStatus = st => { const [cls, label] = PASS_STATUS[st] || ["inactive", st]; return `<span class="status s-${cls}">${esc(label)}</span>`; };
function visitorPasses(passes) {
  const list = passes.length ? `<ul class="passes">${passes.map(v => `<li class="pass">${plate(v.plate_display)}
      <span><strong>${esc(dayOf(v.valid_on))}</strong><span class="sub">${esc(v.guest_name || "Guest")}</span></span>
      ${passStatus(v.status)}${v.status === "rejected" && v.reason ? `<span class="sub pass-reason">${esc(v.reason)}</span>` : ""}
      <button type="button" class="ghost" data-action="revokePass" data-id="${v.id}" data-plate="${esc(v.plate_display)}">Cancel</button></li>`).join("")}</ul>` : "";
  return `<section class="card"><h2>Visitor passes</h2>
    <p class="muted">Let a guest's car in for one day${has(...STAFF) ? "" : ". Campus security approves each pass before the visit"}. You can ask for up to 3 passes for a day, up to 30 days ahead.</p>${list}
    <form id="pass" novalidate><div class="grid">
      <label class="field"><span>Guest's plate</span><input name="plate" placeholder="10-AB-123" required maxlength="16" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      <label class="field"><span>Guest name (optional)</span><input name="guest_name" maxlength="60" autocomplete="off"></label>
      <label class="field"><span>Day</span><input name="valid_on" type="date" required value="${campusDay()}" min="${campusDay()}" max="${campusDay(30)}"></label>
    </div><div class="actions"><button type="submit">${has(...STAFF) ? "Issue pass" : "Request pass"}</button></div><div class="err" role="alert"></div></form></section>`;
}

const eventsTable = (rows, full) => table(
  ["Time", "Plate", "Movement", "Owner", ...(full ? ["Source", "Recorded by"] : [])],
  rows.map(e => [
    fmt(e.occurred_at), plate(e.plate_display), e.direction === "in" ? "In" : "Out",
    driver(e),
    ...(full ? [esc(e.source === "manual" ? "Guard" : e.source.toUpperCase()), esc(e.recorded_by || "Gate device")] : []),
  ]));

async function gateRecent(fresh) {
  const rows = (await api("/admin/gate-events")).slice(0, 10);
  $("#grecent").innerHTML = rows.length ? eventsTable(rows) : `<p class="muted">Entries and exits recorded at the gates appear here.</p>`;
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
  if (!value) { err.textContent = "Type the plate number first."; replay($(".plate-input-box"), "nudge", 400); input.focus(); return; }
  await busy(btn, async () => {
    try {
      // Campus has one gate; the service records it as "main".
      const r = await api("/admin/gate-events", { method: "POST", body: { plate: value, direction: dir } });
      const from = $(".plate-input-box").getBoundingClientRect(), shown = r.plate_display || r.plate;
      const what = `${dir === "in" ? "Entry" : "Exit"} recorded at ${time(new Date().toISOString())}.`;
      $("#gres").innerHTML = r.authorized
        ? `<div class="verdict allow"><span class="verdict-tile">${icon("go")}</span><div class="verdict-body"><p class="verdict-word">Allow</p>
           <div class="vehicle">${plate(shown, true)}</div>
           ${r.visitor ? `<p><strong>Visitor of ${esc(r.visitor.host)}</strong>${r.visitor.guest_name ? `, ${esc(r.visitor.guest_name)}` : ""}. Day pass for today.</p>`
             : `<p><strong>${esc(r.owner)}</strong>, ${esc(r.affiliation)}. ${esc(r.vehicle)}.</p>`}<p class="muted">${what}</p></div></div>`
        : `<div class="verdict check"><span class="verdict-tile">${icon("stop")}</span><div class="verdict-body"><p class="verdict-word">Check the driver</p>
           <div class="vehicle">${plate(shown, true)}</div>
           <p>No active permit or visitor pass for this plate. Ask for the driver's ADA ID before letting them in.</p>
           ${r.pending_pass ? `<p class="verdict-flag">${esc(r.pending_pass.host)} asked for a visitor pass for this plate today. It is waiting for approval.</p>
             <button type="button" class="verdict-action" data-action="approvePass" data-id="${r.pending_pass.id}" data-gate="1">Approve pass</button>` : ""}
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
  if (q.replace(/[^A-Za-z0-9]/g, "").length < 2) { err.textContent = "Type at least two letters or digits of the plate."; return; }
  try {
    const [rows, flagged] = await Promise.all([api("/admin/vehicles?plate=" + encodeURIComponent(q)), api("/admin/flagged-plates?plate=" + encodeURIComponent(q))]);
    const admin = has(...ADMINS);
    const unknown = flagged.length ? `<section class="ledger"><h2>Entering without a permit</h2>${table(["Plate", "Entries without a permit", "Last seen"], flagged.map(f => [
      plate(f.plate_display), `<span class="status s-none">${f.n} times</span><span class="sub">Since ${day(f.first_at)}</span>`, fmt(f.last_at)]))}</section>` : "";
    $("#sres").innerHTML = !rows.length && unknown ? unknown : (rows.length ? `<div class="card results">` + rows.map(r => `<article class="result">
      ${vehicleLine(r)}${r.repeat ? `<p class="flag">${repeatLine(r.repeat)}</p>` : ""}
      <p><strong>${esc(r.full_name)}</strong>, ${esc(r.affiliation)}${admin ? `<span class="sub">${esc(r.email)}${r.phone ? `, ${esc(r.phone)}` : ""}</span>` : ""}</p>
      <p class="muted">${r.last_event ? `Last ${r.last_event.direction === "in" ? "entered" : "left"} campus on ${fmt(r.last_event.occurred_at)}.` : "No gate movements recorded."}${r.valid_until && r.status === "active" ? ` Permit valid until ${day(r.valid_until)}.` : ""}</p>
      ${admin ? `<div class="row">
        <label class="field"><span>Message</span><select class="tpl" name="template"><option value="move">Please move your vehicle</option><option value="incident">Your vehicle was involved in an incident</option><option value="lights">Your vehicle's lights are on</option></select></label>
        <button type="button" class="ghost" data-action="contact" data-user="${r.user_id}" data-plate="${esc(r.plate_display)}" data-name="${esc(r.full_name)}">Send message</button>
        ${r.status === "active" ? `<button type="button" class="ghost" data-action="override" data-user="${r.user_id}" data-name="${esc(r.full_name)}">Allow early vehicle change</button>
          <button type="button" class="danger" data-action="suspend" data-id="${r.permit_id}" data-plate="${esc(r.plate_display)}">Suspend permit</button>` : ""}
        ${r.status === "suspended" ? `<button type="button" class="ghost" data-action="reinstate" data-id="${r.permit_id}" data-plate="${esc(r.plate_display)}">Reinstate permit</button>` : ""}
      </div>` : ""}</article>`).join("") + `</div>` + unknown : `<div class="card"><p class="muted">No vehicle matches “${esc(q)}”. Check the characters and try a shorter part of the plate.</p></div>`);
  } catch (x) { err.textContent = x.message; }
}

function logQuery() {
  return new URLSearchParams(Object.entries({ plate: $("#lp").value.trim(), from: $("#lf").value, to: $("#lt").value }).filter(([, v]) => v)).toString();
}

async function runLog() {
  const err = $("#view .err"); err.textContent = "";
  try {
    const rows = await api("/admin/gate-events?" + logQuery());
    $("#lres").innerHTML = rows.length ? eventsTable(rows, true) : `<p class="muted">No movements match these filters.</p>`;
  } catch (x) { err.textContent = x.message; }
}

// Actions that need a reason or a confirmation.
const ACTIONS = {
  async login(b) {
    const id = b.dataset.id || document.getElementById("login-user")?.value.trim();
    const user = document.getElementById("login-user");
    if (!id) { loginError("Enter your username."); user?.setAttribute("aria-invalid", "true"); user?.focus(); return; }
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
  signout() { signOut("Signed out"); },
  async renew() {
    await api("/me/renewal", { method: "POST" });
    toast("Renewal requested"); await render();
  },
  async revokePass(b) {
    if (!await ask({ title: `Cancel the visitor pass for ${b.dataset.plate}?`, text: "The gate will check this car again.", confirm: "Cancel pass", danger: true })) return;
    await api(`/visitor-passes/${b.dataset.id}/revoke`, { method: "POST" });
    toast("Visitor pass cancelled"); await render();
  },
  async approvePass(b) {
    await api(`/admin/visitor-passes/${b.dataset.id}/approve`, { method: "POST" });
    toast("Visitor pass approved");
    // At the gate the guard records the entry again; elsewhere the row leaves the list.
    if (b.dataset.gate) { b.remove(); $("#gp").focus(); return; }
    await leave(b.closest("tr"), "leaving approved"); await render();
  },
  async rejectPass(b) {
    const reason = await ask({ title: `Reject the visitor pass for ${b.dataset.plate}?`, field: { label: "Reason, shown to the host", required: true }, confirm: "Reject pass", danger: true });
    if (!reason) return;
    await api(`/admin/visitor-passes/${b.dataset.id}/reject`, { method: "POST", body: { reason } });
    toast("Visitor pass rejected"); await leave(b.closest("tr")); await render();
  },
  async approveRenewals() {
    const r = await api("/admin/renewals/approve-all", { method: "POST" });
    toast(`${r.approved} ${r.approved === 1 ? "renewal" : "renewals"} approved${r.skipped ? `, ${r.skipped} skipped` : ""}`); await render();
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
    toast("Approved"); await leave(b.closest("tr"), "leaving approved"); await render();
  },
  async reject(b) {
    const reason = await ask({ title: `Reject ${b.dataset.name}'s request?`, field: { label: "Reason, shown to the person", required: true }, confirm: "Reject request", danger: true });
    if (!reason) return;
    await api(`/admin/permits/${b.dataset.id}/reject`, { method: "POST", body: { reason } });
    toast("Rejected"); await leave(b.closest("tr")); await render();
  },
  async contact(b) {
    const sel = $(".tpl", b.closest(".result, .card"));
    const note = await ask({ title: `Send “${sel.selectedOptions[0].text}”`, text: `To ${b.dataset.name}, about ${b.dataset.plate}.`, field: { label: "Note to add", max: 500 }, confirm: "Send message" });
    if (note === null) return;
    const r = await api(`/admin/users/${b.dataset.user}/contact`, { method: "POST", body: { template: sel.value, plate: b.dataset.plate, note: note || null } });
    toast("Message sent to " + r.sent_to);
  },
  async suspend(b) {
    const reason = await ask({ title: `Suspend the permit for ${b.dataset.plate}?`, text: "The gate will flag this vehicle until the permit is reinstated.", field: { label: "Reason, shown to the owner", required: true }, confirm: "Suspend permit", danger: true });
    if (!reason) return;
    await api(`/admin/permits/${b.dataset.id}/suspend`, { method: "POST", body: { reason } });
    toast("Permit suspended"); await runSearch();
  },
  async reinstate(b) {
    if (!await ask({ title: `Reinstate the permit for ${b.dataset.plate}?`, text: "The vehicle will be allowed through the gates again.", confirm: "Reinstate permit" })) return;
    await api(`/admin/permits/${b.dataset.id}/reinstate`, { method: "POST", body: {} });
    toast("Permit reinstated"); await runSearch();
  },
  async override(b) {
    const reason = await ask({ title: `Allow ${b.dataset.name} an early vehicle change?`, text: "They can request one change now, without waiting for the usual interval.", field: { label: "Reason", required: true, placeholder: "Car sold, accident, rental" }, confirm: "Allow early change" });
    if (!reason) return;
    await api(`/admin/users/${b.dataset.user}/cooldown-override`, { method: "POST", body: { reason } });
    toast("Early change allowed once");
  },
};

document.addEventListener("click", e => {
  const b = e.target.closest("[data-action]");
  if (!b || !ACTIONS[b.dataset.action]) return;
  e.preventDefault();
  const run = () => ACTIONS[b.dataset.action](b);
  // Actions that open a dialog manage their own flow; the rest lock the button while they run.
  const guarded = b.dataset.action === "gate" ? run() : busy(b, run);
  Promise.resolve(guarded).catch(x => { if (x.message !== "Signed out") toast(x.message, "error"); });
});

render({ enter: true });
