---
version: 1
slug: "app-static-app-js"
primary_target: "app/static/app.js"
related_targets: ["app/static/app.css"]
---

# Sign-in screen

Scope: the signed-out screen rendered by `renderLogin()` in app/static/app.js and the `/* Sign-in */` block in app/static/app.css. Mode: Operate.

Audience and job: ADA students, faculty, guards and admins signing in. Today mostly demo viewers (ADA decision-makers) who pick a demo account; later real users with MyADA username + password. Guards sign in on phones at the gate.

Constraints: keep the username + password form (the password isn't checked yet; the mock only uses the username), the "Forgot your password?" link to online.ada.edu.az/password, and the demo picker when `/auth/demo-users` returns accounts (it 404s when demo login is off, and then the stub disappears). ADA logomark + ADA navy are binding. Join the app's own world (navy #0b3d91, Source Sans 3, Barlow Semi Condensed plate face), not the old MyADA teal clone.

Must not feel like: a generic SaaS login; a demo picker that's too loud OR too hidden; anything that breaks on phones.

## Direction contract

THESIS: Signing in to a parking service means taking your permit off the mirror. The sign-in card is an ADA parking hang-tag, not a floating white rectangle on a gradient.

OWN-WORLD: the app's palette: navy #0b3d91 / #082d6b, paper #f3f5f8, ink #17202e, muted #556072, focus amber #f0b400. Source Sans 3 for UI; Barlow Semi Condensed, tracked, for the tag code and role labels, like the app's number plates. Tag silhouette: rounded top with a punched hanger hole (mask), side notches at the perforation, dashed tear line. Standard inputs, button, and links in the app's own component style.

STORY: the visitor recognises ADA (the mark) and Smart Parking (the tag) at once, signs in with MyADA credentials, or during the demo tears into the stub and picks a person by role.

FIRST VIEWPORT: the app's navy header band across the top with "MyADA Smart Parking". The tag hangs centred below it from the band (~420px wide; full width minus a 16px gutter on phones). Navy tag head with hanger hole, ADA mark, "SMART PARKING" in plate type and the permit-year code. The white body holds the "Sign in" heading, one line on using the MyADA account, labelled Username and Password fields, a full-width navy Sign in button, and the forgot link. Then the perforation, then the stub on a paper tint: a "Prototype — sign in as a demo account" label and compact rows of name plus role plate (Student, Faculty, Guard, Parking admin, System admin). The primary action sits in the body; the stub is visible without scrolling at 1440×900 and below the button on phones.

FORM: Permit Hang-tag, position 2 on my ordered list of 7 grounded structures; seed key 872945c8. Signature move: the tag swings once from its hanger hole on load (damped rotation about the hole, ~700ms, none under reduced motion), and choosing a demo row tears the stub down a few pixels along the perforation before signing in.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
