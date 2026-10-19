"use strict";
// Single-page UI for vehicle owners, guards and admins. No inline handlers: the page runs
// under a strict Content-Security-Policy, so every action goes through data-action delegation.

const API = "/api/v1";
let token = null;
try { token = sessionStorage.getItem("token"); } catch { /* storage blocked */ }
let me = null;

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TZ = "Asia/Baku"; // campus time, whatever the device is set to
const fmt = iso => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "";
const day = iso => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: TZ }) : "";
const time = iso => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const words = s => String(s ?? "").replaceAll("_", " ");
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : "";

const STATUS = { active: "Active", pending: "Waiting for approval", rejected: "Rejected", suspended: "Suspended", expired: "Expired", inactive: "Replaced" };
const status = s => `<span class="status s-${esc(s)}">${esc(STATUS[s] || s)}</span>`;
// The left band of a real AZ plate: the national flag above the boxed "AZ" RFID label.
const PLATE_SIDE = `<span class="plate-side" aria-hidden="true"><i class="plate-flag"></i><b class="plate-az">AZ</b></span>`;
// AZS 599 (Figure 18): every character sits in a 45 mm cell, and separators are raised 15 x 10 mm bars,
// not the font's hyphen, whatever was typed.
const plateChars = p => String(p ?? "").trim().split(/[\s-]+/)
  .map(g => [...g].map(c => `<b data-c="${esc(c)}">${esc(c)}</b>`).join("")).join(`<i class="plate-dash"></i>`);

// DIN 1451 letters are narrower than most fonts that stand in for it, so measure each glyph's ink in the
// font this device actually resolved and squeeze any that would spill out of its 45 mm cell.
async function fitPlateGlyphs() {
  try { await document.fonts.ready; } catch { /* fonts API unavailable: plates still render, just unfitted */ }
  const probe = document.createElement("span");
  probe.className = "plate-num"; probe.setAttribute("aria-hidden", "true"); probe.textContent = "0";
  Object.assign(probe.style, { position: "absolute", visibility: "hidden", fontSize: "108px" });
  document.body.append(probe);
  const cs = getComputedStyle(probe), ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${cs.fontWeight} 108px ${cs.fontFamily}`;
  if ("fontStretch" in ctx) ctx.fontStretch = "semi-condensed";
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
const GATES = { main: "Main gate", north: "North gate" };
const gateName = id => GATES[id] || cap(words(id)) + " gate";

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

function setStore(v) { try { v ? sessionStorage.setItem("token", v) : sessionStorage.removeItem("token"); } catch { /* storage blocked */ } }

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

const FIELD_NAMES = { plate: "Plate number", make: "Make", model: "Model", color: "Colour", reason: "Reason" };
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
  { id: "vehicle", label: "My vehicle", show: () => true },
  { id: "gate", label: "Gate check", show: () => has(...STAFF) },
  { id: "search", label: "Find a vehicle", show: () => has(...STAFF) },
  { id: "queue", label: "Approvals", show: () => has(...ADMINS) },
  { id: "log", label: "Gate log", show: () => has(...STAFF) },
  { id: "audit", label: "Audit and settings", show: () => has("system_admin") },
];

function signOut(message) {
  token = null; me = null; setStore(null); swung = false; permitSwung = false;
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
  $("#who").innerHTML = `<span>${esc(me.user.full_name)}</span>
    <span class="role">${esc(cap(me.user.affiliation))}</span>
    ${me.roles.map(r => `<span class="role extra">${esc(cap(words(r)))}</span>`).join("")}
    <button type="button" data-action="signout">Sign out</button>`;
  const tabs = TABS.filter(t => t.show());
  const current = tabs.find(t => "#" + t.id === location.hash)?.id || (has("guard") ? "gate" : "vehicle");
  const nav = $("#nav"); nav.hidden = tabs.length < 2;
  nav.innerHTML = tabs.map(t => `<a href="#${t.id}"${t.id === current ? ' aria-current="page"' : ""}>${esc(t.label)}</a>`).join("");
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

// The paper tab slides to the new section at once; the page follows when its data arrives.
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
  const now = new Date(), y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  $("#view").innerHTML = `<div class="signin"><div class="tag${swung ? "" : " swing"}">
    <form id="login-form" class="tag-main" novalidate>
      <div class="tag-head"><img src="/static/ada-mark.svg" alt="ADA University" width="92" height="59">
        <span class="tag-name">SMART PARKING</span><span class="tag-year">${y}/${String(y + 1).slice(2)}</span>
        <span class="tag-serial">Campus parking permit</span></div>
      <div class="tag-body">
        <h1>Sign in</h1>
        <p>Use your MyADA username and password.</p>
        <div class="login-err" role="alert"></div>
        <label class="field"><span>Username</span><input id="login-user" name="username" type="text"
          autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
        <label class="field"><span>Password</span><input id="login-pass" name="password" type="password" autocomplete="current-password"></label>
        <button type="submit" class="tag-submit">Sign in</button>
        <a class="tag-forgot" href="https://online.ada.edu.az/password" target="_blank" rel="noopener">Forgot your password?</a>
      </div>
    </form>
    ${demos ? `<section class="tag-stub" aria-labelledby="stub-title">
      <p class="stub-label" id="stub-title"><strong>Prototype:</strong> sign in as a demo account</p>
      <div class="demo-list">${demos}</div></section>` : ""}
  </div></div>`;
  swung = true;
  const form = $("#login-form");
  if (form) form.onsubmit = e => { e.preventDefault(); ACTIONS.login($(".tag-submit", form)).catch(x => { if (x.message !== "Signed out") loginError(x.message); }); };
}

let swung = false, permitSwung = false;
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

// The owner's permit, drawn as the same hang-tag as the sign-in screen.
const STRIP = { active: "allow", pending: "wait", suspended: "check", expired: "check", rejected: "check", inactive: "idle" };
function permitTag(pm, note) {
  const head = `<div class="permit-head"><img src="/static/ada-mark.svg" alt="ADA University" width="72" height="46">
    <span class="permit-name">SMART PARKING</span>
    ${pm ? plate(pm.plate_display, true) : `<span class="plate-slot">No vehicle yet</span>`}</div>`;
  if (!pm) return `<div class="permit empty"><div class="permit-main">${head}
    <div class="permit-body"><p>${note}</p></div></div></div>`;
  return `<div class="permit"><div class="permit-main">${head}
    <p class="permit-strip ${STRIP[pm.status] || "idle"}">${esc(STATUS[pm.status] || pm.status)}</p>
    <div class="permit-body"><p class="permit-car">${esc(pm.color)} ${esc(pm.make)} ${esc(pm.model)}</p>
      <p class="permit-holder">${esc(me.user.full_name)}, ${esc(cap(me.user.affiliation))}</p>
      <p class="permit-note">${note}</p></div></div></div>`;
}

const page = (title, extra = "") => `<header class="page-head"><h1>${esc(title)}</h1>${extra}</header>`;

const VIEWS = {
  async vehicle() {
    const a = me.active_permit, p = me.pending_permit, l = me.latest_inactive_permit, c = me.change;
    const [events, msgs] = await Promise.all([api("/me/gate-events"), api("/me/messages")]);
    let tag, side = "";
    if (a) tag = permitTag(a, `Valid until <strong>${day(a.valid_until)}</strong>`);
    else if (p) tag = permitTag(p, "The parking office is reviewing your registration. You can't park on campus until it is approved.");
    else if (l?.status === "suspended") tag = permitTag(l, `Suspended${l.reason ? `: ${esc(l.reason)}` : ""}. Contact the parking office to have it reinstated.`);
    else {
      tag = l ? permitTag(l, (l.status === "expired" ? "This permit has expired." : "This permit is no longer valid.") + (l.reason ? ` Reason: ${esc(l.reason)}.` : ""))
        : permitTag(null, "Register your vehicle to park on campus. Each ADA member can register one vehicle, and the parking office approves it.");
      side += `<section class="card"><h2>${l ? "Register again" : "Register your vehicle"}</h2>${vehicleForm("reg", "Register vehicle")}</section>`;
    }
    if (a) {
      side += `<section class="card"><h2>Change vehicle</h2>`;
      if (p) side += vehicleLine(p) + `<p class="notice">Your request is waiting for approval. Keep using ${esc(a.plate_display)} until it is approved.</p>`;
      else if (c.allowed_now) side += `<p class="muted">${c.override_granted ? "The parking office allowed one early change." : `You can change your vehicle once every ${c.cooldown_days} days.`} The new vehicle needs approval, and your current one stays valid until then.</p>` + vehicleForm("chg", "Request change");
      else side += `<p>You can change your vehicle once every ${c.cooldown_days} days. Your next change is possible on <strong>${day(c.next_allowed_at)}</strong>.</p><p class="muted">Sold your car or had an accident? The parking office can allow an early change.</p>`;
      side += `</section>`;
    }
    if (msgs.length) side += `<section class="card"><h2>Messages from campus security</h2><ul class="messages">${msgs.map(m => `<li class="message">
      <h3>${esc(m.subject)}</h3><span class="muted">${esc(m.sender)}, ${fmt(m.created_at)}</span><p>${esc(m.body)}</p></li>`).join("")}</ul></section>`;
    const moves = `<section class="card"><h2>My entries and exits</h2>${events.length
      ? table(["Time", "Movement", "Plate", "Gate"], events.map(e => [fmt(e.occurred_at), e.direction === "in" ? "Entered" : "Left", plate(e.plate_display), esc(gateName(e.gate_id))]))
      : `<p class="muted">Your entries and exits appear here once you drive through a campus gate.</p>`}</section>`;
    // With nothing else beside the permit, the movements fill that column instead of leaving it empty.
    const html = page("My vehicle") + `<div class="owner"><div class="owner-tag">${tag}</div><div class="owner-side">${side || moves}</div></div>` + (side ? moves : "");
    $("#view").innerHTML = html;
    if (!permitSwung) { $(".permit")?.classList.add("swing"); permitSwung = true; }
    bindForm("reg", async v => { await api("/vehicles", { method: "POST", body: v }); toast("Vehicle sent for approval"); render(); });
    bindForm("chg", async v => { await api("/change-requests", { method: "POST", body: v }); toast("Change requested"); render(); });
  },

  async gate() {
    $("#view").innerHTML = page("Gate check", `<label class="gate-pick"><span>Gate</span><select id="gg">${Object.entries(GATES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>`)
      + `<section class="gate-desk"><form id="gate" novalidate>
        <label class="plate-input" for="gp"><span class="plate-input-label">Plate number</span>
          <span class="plate-input-box">${PLATE_SIDE}<input id="gp" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="10-AB-123" enterkeyhint="done"></span></label>
      </form>
      <div class="gate-buttons"><button type="button" data-action="gate" data-dir="in">Record entry</button><button type="button" class="ghost" data-action="gate" data-dir="out">Record exit</button></div>
      <p class="muted gate-hint">Press Enter to record an entry.</p>
      <div class="err" role="alert"></div><div id="gres" aria-live="polite"></div></section>
      <section class="card"><h2>Recent movements</h2><div id="grecent"></div></section>`;
    try { const g = sessionStorage.getItem("gate"); if (g && GATES[g]) $("#gg").value = g; } catch { /* ignore */ }
    $("#gg").onchange = () => { try { sessionStorage.setItem("gate", $("#gg").value); } catch { /* ignore */ } };
    $("#gate").onsubmit = e => { e.preventDefault(); $('[data-dir="in"]').click(); };
    $("#gp").focus();
    await gateRecent();
  },

  async search() {
    $("#view").innerHTML = page("Find a vehicle") + `<div class="card filters">
      <form id="sform" class="row" novalidate><label class="field grow"><span>Full or partial plate</span><input id="sq" placeholder="10AB" minlength="2" autocomplete="off" autocapitalize="characters" spellcheck="false"></label><button type="submit">Search</button></form>
      <div class="err" role="alert"></div></div><div id="sres" aria-live="polite"></div>`;
    $("#sform").onsubmit = e => { e.preventDefault(); busy($("#sform button"), runSearch); };
    $("#sq").focus();
  },

  async queue() {
    const rows = await api("/admin/queue");
    $("#view").innerHTML = page("Approvals", `<span class="page-count">${rows.length ? `${rows.length} waiting` : "Nothing waiting"}</span>`) + `<div class="card">${rows.length
      ? table(["Submitted", "Person", "Vehicle", "Request", ""], rows.map(r => [
          fmt(r.created_at),
          `<strong>${esc(r.full_name)}</strong><span class="sub">${esc(cap(r.affiliation))}, ${esc(r.email)}</span>`,
          `${plate(r.plate_display)}<span class="sub">${esc(r.color)} ${esc(r.make)} ${esc(r.model)}</span>`,
          r.change_request_id ? `Vehicle change<span class="sub">Replaces ${esc(r.replaces_plate)}</span>` : "New registration",
          `<button type="button" data-action="approve" data-id="${r.permit_id}">Approve</button><button type="button" class="danger" data-action="reject" data-id="${r.permit_id}" data-name="${esc(r.full_name)}">Reject</button>`,
        ]))
      : `<p class="muted">No requests are waiting. New registrations and vehicle changes appear here.</p>`}</div>`;
  },

  async log() {
    $("#view").innerHTML = page("Gate log") + `<div class="card filters">
      <form id="lform" class="row" novalidate>
        <label class="field grow"><span>Plate</span><input id="lp" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
        <label class="field"><span>From</span><input id="lf" type="date"></label>
        <label class="field"><span>To</span><input id="lt" type="date"></label>
        <button type="submit">Filter</button><button type="button" class="ghost" data-action="csv">Download CSV</button>
      </form><div class="err" role="alert"></div></div><div class="card" id="lres" aria-live="polite"></div>`;
    $("#lform").onsubmit = e => { e.preventDefault(); busy($("#lform button[type=submit]"), runLog); };
    await runLog();
  },

  async audit() {
    const rows = await api("/admin/audit-log");
    $("#view").innerHTML = page("Audit and settings") + `<div class="card"><h2>Rules</h2>
      <form id="settings" class="row" novalidate>
        <label class="field"><span>Days between vehicle changes</span><input name="days" type="number" min="0" max="365" required value="${me.change.cooldown_days}"></label>
        <button type="submit">Save</button></form><div class="err" role="alert"></div></div>
      <div class="card"><h2>Audit log</h2>${rows.length ? table(["Time", "Who", "Action", "Details"], rows.map(r => [
        fmt(r.created_at), esc(r.actor || "System"), esc(cap(words(r.action))),
        `<span class="details">${esc(r.target_type ? `${cap(words(r.target_type))} ${r.target_id}` : "")}${r.target_type && r.details ? "; " : ""}${esc(details(r.details))}</span>`,
      ])) : `<p class="muted">Nothing recorded yet.</p>`}</div>`;
    $("#settings").onsubmit = async e => {
      e.preventDefault();
      const err = $("#settings + .err"); err.textContent = "";
      const days = Number(e.target.elements.days.value);
      if (!Number.isInteger(days) || days < 0 || days > 365) { err.textContent = "Enter a whole number of days from 0 to 365."; return; }
      await busy($("#settings button"), async () => {
        try { await api("/admin/settings", { method: "PUT", body: { change_cooldown_days: days } }); toast("Rule saved"); render(); }
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

const eventsTable = (rows, full) => table(
  ["Time", "Plate", "Movement", "Owner", "Gate", ...(full ? ["Source", "Recorded by"] : [])],
  rows.map(e => [
    fmt(e.occurred_at), plate(e.plate_display), e.direction === "in" ? "In" : "Out",
    e.authorized ? esc(e.owner) : `<span class="status s-none">No permit</span>`, esc(gateName(e.gate_id)),
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
      const gate = $("#gg").value;
      const r = await api("/admin/gate-events", { method: "POST", body: { plate: value, direction: dir, gate_id: gate } });
      const from = $(".plate-input-box").getBoundingClientRect(), shown = r.plate_display || r.plate;
      const what = `${dir === "in" ? "Entry" : "Exit"} recorded at ${esc(gateName(gate))}, ${time(new Date().toISOString())}.`;
      $("#gres").innerHTML = r.authorized
        ? `<div class="verdict allow"><p class="verdict-word">Allow</p>
           <div class="vehicle">${plate(shown, true)}</div>
           <p><strong>${esc(r.owner)}</strong>, ${esc(r.affiliation)}. ${esc(r.vehicle)}.</p><p class="muted">${what}</p></div>`
        : `<div class="verdict check"><p class="verdict-word">Check the driver</p>
           <div class="vehicle">${plate(shown, true)}</div>
           <p>No active permit for this plate. Ask for the driver's ADA ID before letting them in.</p><p class="muted">${what}</p></div>`;
      flyPlate(from, $("#gres .plate"));
      input.value = ""; input.focus();
      gateRecent(r.authorized ? "allow" : "check").catch(() => {});
    } catch (x) { err.textContent = x.message; }
  });
}

async function runSearch() {
  const q = $("#sq").value.trim(), err = $("#view .err");
  err.textContent = "";
  if (q.replace(/[^A-Za-z0-9]/g, "").length < 2) { err.textContent = "Type at least two letters or digits of the plate."; return; }
  try {
    const rows = await api("/admin/vehicles?plate=" + encodeURIComponent(q));
    const admin = has(...ADMINS);
    $("#sres").innerHTML = rows.length ? `<div class="card results">` + rows.map(r => `<article class="result">
      ${vehicleLine(r)}
      <p><strong>${esc(r.full_name)}</strong>, ${esc(r.affiliation)}${admin ? `<span class="sub">${esc(r.email)}${r.phone ? `, ${esc(r.phone)}` : ""}</span>` : ""}</p>
      <p class="muted">${r.last_event ? `Last ${r.last_event.direction === "in" ? "entered through" : "left through"} ${esc(gateName(r.last_event.gate_id))} on ${fmt(r.last_event.occurred_at)}.` : "No gate movements recorded."}${r.valid_until && r.status === "active" ? ` Permit valid until ${day(r.valid_until)}.` : ""}</p>
      ${admin ? `<div class="row">
        <label class="field"><span>Message</span><select class="tpl" name="template"><option value="move">Please move your vehicle</option><option value="incident">Your vehicle was involved in an incident</option><option value="lights">Your vehicle's lights are on</option></select></label>
        <button type="button" class="ghost" data-action="contact" data-user="${r.user_id}" data-plate="${esc(r.plate_display)}" data-name="${esc(r.full_name)}">Send message</button>
        ${r.status === "active" ? `<button type="button" class="ghost" data-action="override" data-user="${r.user_id}" data-name="${esc(r.full_name)}">Allow early vehicle change</button>
          <button type="button" class="danger" data-action="suspend" data-id="${r.permit_id}" data-plate="${esc(r.plate_display)}">Suspend permit</button>` : ""}
        ${r.status === "suspended" ? `<button type="button" class="ghost" data-action="reinstate" data-id="${r.permit_id}" data-plate="${esc(r.plate_display)}">Reinstate permit</button>` : ""}
      </div>` : ""}</article>`).join("") + `</div>` : `<div class="card"><p class="muted">No vehicle matches “${esc(q)}”. Check the characters and try a shorter part of the plate.</p></div>`;
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
    const stub = b.dataset.id && b.closest(".tag-stub");
    stub?.classList.add("tearing");
    let r;
    try { r = await api("/auth/mock-login", { method: "POST", body: { myada_user_id: id } }); }
    catch (x) { stub?.classList.remove("tearing"); throw x; }
    token = r.token; setStore(token);
    if (location.hash) history.replaceState(null, "", location.pathname);
    await leave($(".signin"), "unhook");
    await render({ enter: true }); $("#view").focus({ preventScroll: true });
  },
  signout() { signOut("Signed out"); },
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
