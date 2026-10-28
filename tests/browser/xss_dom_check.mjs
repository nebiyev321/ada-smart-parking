// XSS regression check in a real browser, with harmless fixtures.
//
// Stores inert markup probes (an <i> element carrying data-xss-probe, never a script) in every
// free-text field the API accepts, renders each screen that shows them, and fails if any probe
// became an element instead of text, or if the page reported a Content-Security-Policy violation.
// Also loads hostile URL fragments to check the hash is never written into the page.
//
// Run from the repo root:  node tests/browser/xss_dom_check.mjs
// Needs Python with the app's requirements and Chrome (set CHROME_PATH if it isn't at the default).
// Uses its own temporary database and port, so it never touches parking.db.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8799, BASE = `http://127.0.0.1:${PORT}`, DEBUG_PORT = 9399;
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
// Inert probes: one closes a quoted attribute, one is plain element markup, one uses an entity.
const PROBES = [
  `"><i data-xss-probe="attr">probe-attr</i>`,
  `<i data-xss-probe="text">probe-text</i>`,
  `&lt;i data-xss-probe="entity"&gt;probe-entity`,
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), "parking-xss-"));
const failures = [];

const server = spawn("python", ["-m", "uvicorn", "app.main:app", "--port", String(PORT)],
  { env: { ...process.env, PARKING_DB: join(dir, "xss.db"), DATABASE_URL: "" }, stdio: "ignore" });
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, "--no-first-run",
  `--user-data-dir=${join(dir, "chrome")}`, "about:blank"], { stdio: "ignore" });

async function waitFor(url) {
  for (let i = 0; i < 150; i++) { try { const r = await fetch(url); if (r.ok) return r; } catch { /* not up yet */ } await sleep(200); }
  throw new Error("Timed out waiting for " + url);
}
async function call(path, token, body, method = body ? "POST" : "GET") {
  const r = await fetch(BASE + "/api/v1" + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
const login = async id => (await call("/auth/mock-login", null, { account_id: id })).token;

try {
  await waitFor(BASE + "/robots.txt");
  const [owner, owner2, guard, admin, sysadmin] = await Promise.all(["M1001", "M1002", "E3001", "E3002", "E3003"].map(login));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Baku" });

  // Stored fixtures, one per free-text field that accepts markup characters.
  const p1 = await call("/vehicles", owner, { plate: "10-AB-123", make: "Toyota", model: "Corolla", color: "White" });
  await call(`/admin/permits/${p1.id}/reject`, admin, { reason: PROBES[0] });                 // permit rejection reason
  const p2 = await call("/vehicles", owner2, { plate: "90-XY-777", make: "Kia", model: "Rio", color: "Grey" });
  await call(`/admin/permits/${p2.id}/approve`, admin, {});
  await call(`/admin/users/${(await call("/me", owner2)).user.id}/contact`, admin, { template: "move", plate: "90-XY-777", note: PROBES[1] }); // message note
  await call(`/admin/users/${(await call("/me", owner2)).user.id}/cooldown-override`, admin, { reason: "Probe " + PROBES[1] });               // audit details
  const vp = await call("/visitor-passes", owner2, { plate: "55-QQ-555", guest_name: "Guest", valid_on: today });
  await call(`/admin/visitor-passes/${vp.id}/reject`, guard, { reason: PROBES[2] });          // visitor pass rejection reason
  await call(`/admin/permits/${p2.id}/suspend`, admin, { reason: PROBES[1] });               // suspension reason

  await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const page = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()).find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let n = 0; const pending = new Map();
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const id = ++n; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expr => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send("Page.enable");
  // Record CSP violations from the first script onward.
  await send("Page.addScriptToEvaluateOnNewDocument", { source:
    "window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI));" });

  async function check(name, token, hash, expectText) {
    await send("Page.navigate", { url: BASE + "/" });
    await sleep(400);
    await evaluate(`sessionStorage.clear(); ${token ? `sessionStorage.setItem("token", ${JSON.stringify(token)});` : ""} true`);
    await send("Page.navigate", { url: `${BASE}/?n=${Math.random()}${hash}` });
    await sleep(1600);
    const r = await evaluate(`({ probes: document.querySelectorAll("[data-xss-probe]").length,
      text: document.body.innerText, csp: window.__csp, title: document.title })`);
    if (r.probes) failures.push(`${name}: ${r.probes} probe element(s) rendered as HTML`);
    if (r.csp.length) failures.push(`${name}: CSP violation ${r.csp.join(", ")}`);
    for (const t of expectText) if (!r.text.includes(t)) failures.push(`${name}: expected literal text ${JSON.stringify(t)} not shown`);
    if (/data-xss-probe|<img|onerror/i.test(r.title)) failures.push(`${name}: hash reached the page title`);
    console.log(`${r.probes || r.csp.length ? "FAIL" : "ok  "} ${name}`);
  }

  await check("owner sees rejection reason", owner, "#vehicle", [PROBES[0]]);
  await check("owner sees suspension, message and pass reason", owner2, "#vehicle", [PROBES[1], PROBES[2]]);
  await check("system admin audit log", sysadmin, "#audit", ["Probe"]);
  await check("hash with markup is ignored", owner, `#${encodeURIComponent('<i data-xss-probe="hash">x</i>')}`, []);
  await check("hash breaking a CSS selector is ignored", guard, `#${encodeURIComponent('gate"]')}`, []);
  await check("sign-in screen with markup hash", null, `#${encodeURIComponent('"><i data-xss-probe="login">')}`, []);
  ws.close();
} catch (e) {
  failures.push("Harness error: " + e.message);
} finally {
  chrome.kill(); server.kill();
  await sleep(500);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Chrome may still hold files on Windows */ }
}

if (failures.length) { console.error("\n" + failures.join("\n")); process.exit(1); }
console.log("\nNo probe rendered as HTML and no CSP violations.");
