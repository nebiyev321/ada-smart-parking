---
version: 1
slug: "app-static-app-js"
primary_target: "app/static/app.js"
related_targets: ["app/static/app.css","app/static/index.html"]
---

# Whole app: sign-in and every signed-in section

Scope: the whole single-page app, rendered by app/static/app.js and styled by app/static/app.css (sign-in, header and nav, My vehicle, Gate check, Find a vehicle, Approvals, Gate log, Audit and settings). Mode: Operate.

Audience and job: owners check their permit and register or change a vehicle; guards record entries and exits at the gate on a phone outdoors; admins approve, search and audit on desktop. Today the audience is mostly ADA decision-makers watching the demo.

Constraints: the user asked for "more futuristic and also minimalistic". Light by default with automatic dark mode (prefers-color-scheme). Keep the AZS 599 number plates and the arc-text ADA crest on sign-in; the permit hang-tag is retired. Keep the username + password form, the forgot link and the labelled demo picker. ADA logomark and ADA navy are binding. CSP forbids inline styles and scripts.

## Direction contract

THESIS: The campus gate is a terminal. Every screen tells you where you are and where to go, in the calm, bright language of airport wayfinding. It refuses the grey SaaS card dashboard and the dark neon HUD.

OWN-WORLD: navy sign panels (#0b3d91 / deep #07265e) with white legends; wayfinding yellow #ffc72c only for "you are here" and direction; a bright cool hall ground #f4f6fa with white work surfaces; ink #0e1a2e. Overpass for UI (light 300 headings, wide and calm), Barlow Semi Condensed only on plates. One-device-pixel hairlines, 4px radii, square pictogram tiles. Raises: yellow is location-only (from the consumer card); one-pixel ruling system (centre rail); validity as a bar whose length is the time left (labanotation); old permits stay visible, struck through (ticket wallet).

STORY: users recognise ADA at once, see where they are from the lit sign, read their state in one large legend, and act with one navy button.

FIRST VIEWPORT: a 56px navy sign band (ADA mark, "Smart Parking", section legends, the current one marked by a yellow underline tile; user and sign-out on the right). Below it a light page sign: a 2.75rem light-weight heading on a hairline. On Gate check a plate-shaped scanner field framed by corner brackets, with Entry / Exit as two large sign buttons with arrow pictogram tiles, then the verdict as a lit sign.

FORM: Terminal Wayfinding, position 3 on my ordered list of 7 grounded structures; seed key 85cf3604. Signature move: wayfinding signs. The section header is a lit sign with a pictogram tile, and the gate verdict lands as a backlit sign (green "Allow" with a proceed arrow, red "Check the driver" with a stop tile) while a scan line sweeps the plate frame once.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
