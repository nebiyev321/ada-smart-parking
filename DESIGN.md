---
name: ADA Smart Parking
description: ADA University's campus parking-permit service, run beside MyADA.
colors:
  navy: "#0b3d91"
  navy-deep: "#082d6b"
  navy-soft: "#e8eefa"
  navy-soft-line: "#c6d3ee"
  paper: "#f3f5f8"
  surface: "#ffffff"
  ink: "#17202e"
  muted: "#556072"
  line: "#d9dee7"
  field-stroke: "#b9c1ce"
  hanger-steel: "#8a96aa"
  signin-slate: "#527a8e"
  signin-ground: "#a9bcc6"
  signin-field: "#dfe7f3"
  allow: "#12723c"
  allow-soft: "#e3f4ea"
  check: "#b42318"
  check-soft: "#fdecea"
  wait: "#8a5100"
  wait-soft: "#fff1da"
  focus: "#f0b400"
  plate-ink: "#111111"
  flag-blue: "#00b5e2"
  flag-red: "#ef3340"
  flag-green: "#509e2f"
typography:
  display:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
    fontFeature: "tnum"
  plate:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.06em"
  plate-lg:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.06em"
  tag-mark:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 600
    letterSpacing: "0.24em"
  role-label:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "0.74rem"
    fontWeight: 600
    letterSpacing: "0.1em"
  verdict:
    fontFamily: "Source Sans 3, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.1
  headline:
    fontFamily: "Source Sans 3, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Source Sans 3, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
  subtitle:
    fontFamily: "Source Sans 3, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Source Sans 3, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Source Sans 3, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
  status:
    fontFamily: "Source Sans 3, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 600
rounded:
  chip: "3px"
  plate: "5px"
  control: "6px"
  card: "8px"
  stub: "14px"
  tag: "22px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "10px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  2xl: "32px"
components:
  header-band:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.surface}"
    padding: "12px 20px"
  button-primary:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.navy-deep}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.navy}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-ghost-hover:
    backgroundColor: "{colors.navy-soft}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.check}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-danger-hover:
    backgroundColor: "{colors.check-soft}"
  button-danger-solid:
    backgroundColor: "{colors.check}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 11px"
  plate-input:
    typography: "{typography.plate-lg}"
    padding: "8px 14px"
  nav-tab:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    padding: "13px 14px 10px"
  nav-tab-active:
    textColor: "{colors.navy}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "20px"
  status-active:
    backgroundColor: "{colors.allow-soft}"
    textColor: "{colors.allow}"
    typography: "{typography.status}"
    rounded: "{rounded.pill}"
    padding: "1px 10px"
  status-pending:
    backgroundColor: "{colors.wait-soft}"
    textColor: "{colors.wait}"
    rounded: "{rounded.pill}"
  status-check:
    backgroundColor: "{colors.check-soft}"
    textColor: "{colors.check}"
    rounded: "{rounded.pill}"
  plate:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.plate}"
    rounded: "{rounded.plate}"
  plate-label:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.plate-ink}"
  verdict-allow:
    backgroundColor: "{colors.allow-soft}"
    textColor: "{colors.allow}"
    typography: "{typography.verdict}"
    rounded: "{rounded.card}"
    padding: "18px 20px"
  verdict-check:
    backgroundColor: "{colors.check-soft}"
    textColor: "{colors.check}"
    typography: "{typography.verdict}"
    rounded: "{rounded.card}"
    padding: "18px 20px"
  notice:
    backgroundColor: "{colors.navy-soft}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
  signin-panel:
    backgroundColor: "{colors.signin-slate}"
    textColor: "{colors.surface}"
    rounded: "0"
    width: "462px"
  signin-field:
    backgroundColor: "{colors.signin-field}"
    textColor: "{colors.ink}"
    height: "48px"
  demo-row:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
    height: "44px"
  demo-row-hover:
    backgroundColor: "{colors.surface}"
  role-plate-affiliation:
    backgroundColor: "{colors.navy-soft}"
    textColor: "{colors.navy}"
    typography: "{typography.role-label}"
    rounded: "{rounded.chip}"
    padding: "1px 7px"
  role-plate-staff:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.role-label}"
    rounded: "{rounded.chip}"
    padding: "1px 7px"
---

# Design System: ADA Smart Parking

## Overview

**Creative North Star: "The Campus Permit"**

ADA Smart Parking looks like the paperwork of parking made trustworthy: a navy ADA band across the top, white working cards on a cool paper ground, and the two physical objects a driver already knows, the Azerbaijani number plate and the permit hang-tag, rendered as interface. The world is an institutional campus service, not a SaaS product. It earns trust by looking like part of ADA (the logomark and ADA navy are binding) and by staying plain everywhere the physical objects don't appear.

Density is moderate and practical. Owners and admins read tables and cards on desktop and phone; guards act at the gate on a phone, so the gate-check surface goes large (2rem plate input, 56px gate buttons, 2rem verdict word). Colour carries meaning: navy is ADA and action, and three status hues (allow green, check red, wait amber) carry every state, always as a soft tint plus a strong ink, never as decoration.

The signature is object fidelity. Plates follow the Azerbaijani national standard (AZS 599: flag, outlined AZ label, DIN-style characters centred in the field, bar separators); the sign-in mirrors the MyADA sign-in panel. Motion is authored around a few moments: the sign-in panel lifts away on sign-in, the owner's permit swings once, and at the gate the typed plate flies into the verdict. Everything else moves only to acknowledge an action or explain a change of state.

**Key Characteristics:**
- ADA navy band header; paper ground; flat white cards with hairline borders.
- Two families: Source Sans 3 for all UI, Barlow Semi Condensed (600, tracked) only for plate-like codes.
- Status is a fixed triad (allow / check / wait), each a soft tint with a strong ink.
- Physical objects (number plate, hang-tag) are the only expressive components.
- Amber focus ring (3px) everywhere; motion is authored on the physical objects and is feedback-only elsewhere, with a fade or static path under reduced motion.

## Colors

A restrained institutional palette: one brand blue, cool blue-grey neutrals, and a three-hue status set that does all the semantic work.

### Primary
- **ADA Navy** (navy): the header band, primary buttons, the hang-tag head, active nav tab, links and the tag's caret colour. It is ADA's identity colour and is binding.
- **Deep Navy** (navy-deep): hover state for navy buttons and links only.
- **Navy Mist** (navy-soft): ghost-button hover, info notices, the affiliation role plate fill. Its edge companion **Mist Line** (navy-soft-line) borders role plates and is the text-selection colour.
- **Plate Ink** (plate-ink) and the **flag colours** (flag-blue, flag-red, flag-green): the number plate only. The flag colours never appear as UI colours.

### Tertiary (status)
- **Allow Green** (allow / allow-soft): active permits and the Allow gate verdict.
- **Check Red** (check / check-soft): rejected, suspended, expired, no permit; the "Check the driver" verdict; errors, invalid fields and danger buttons.
- **Wait Amber** (wait / wait-soft): pending approval and warning notices.
- **Focus Amber** (focus): the 3px focus ring on every interactive element. Not a status colour.

### Neutral
- **Campus Paper** (paper): page ground behind cards and behind the hang-tag.
- **Surface White** (surface): cards, inputs, dialogs, the tag body.
- **Ink** (ink): body text, plate border and numerals, toast background.
- **Slate** (muted): secondary text, field labels, table headers, inactive nav tabs.
- **Hairline** (line): card borders, table rules, nav underline.
- **Field Stroke** (field-stroke): input borders and input placeholder text.
- **Hanger Steel** (hanger-steel): the hang-tag's cord and the outline of staff role plates.

### Named Rules
**The Tint-and-Ink Rule.** Every status appears as its soft tint behind its strong ink (green on green-soft, red on red-soft, amber on amber-soft). Never a solid status block with white text, except the deliberate danger-solid confirm button.

**The Flag Is Not A Palette Rule.** The flag colours belong to the plate's flag. UI blue is always ADA Navy.

## Typography

**UI Font:** Source Sans 3 (with system-ui, -apple-system, Segoe UI, sans-serif)
**Plate Font:** Barlow Semi Condensed 600 (with Arial Narrow, sans-serif)

**Character:** a clear, humanist campus-service sans for everything you read, and a condensed, tracked plate face for everything that would be stamped or embossed on a physical object.

### Hierarchy
- **Display** (Barlow SC 600, 3rem, line-height 1, tabular numerals): the permit year on the hang-tag head (e.g. 2026/27).
- **Plate / Plate Large** (Barlow SC 600, 1.05rem or 2rem, 0.06em tracking): number-plate numerals; the large size on the gate check and its input (2rem, 0.08em, uppercase), shrinking to 1.6rem under 640px.
- **Tag Mark** (Barlow SC 600, 1.3rem, 0.24em tracking, uppercase text): "SMART PARKING" on the tag head.
- **Role Label** (Barlow SC 600, 0.74rem, 0.1em, uppercase): role plates in the demo panel.
- **Verdict** (Source Sans 3 700, 2rem, line-height 1.1): "Allow" / "Check the driver" at the gate, sentence case.
- **Headline** (700, 1.5rem, -0.01em): the sign-in heading.
- **Title** (700, 1.25rem): card headings (h2). **Subtitle** (600, 1.05rem): h3.
- **Body** (400, 16px, line-height 1.5): everything else.
- **Label** (600, 0.875rem): field labels, in Slate in the app and in Ink on the tag.
- **Status** (600, 0.85rem): status pills and table headers.

### Named Rules
**The Stamped Code Rule.** Barlow Semi Condensed is for codes printed on objects: plate numbers, permit year, tag mark, role plates. Headings, labels and body copy are always Source Sans 3.

## Layout

A single centred column: `main` is capped at 1000px with a 16px side gutter, 24px top and 64px bottom margins. Cards stack with 16px between them and 20px internal padding (16px under 640px). Form grids auto-fit columns of at least 170px with a 14px gap; action rows use a 10px gap and wrap. The header band is a full-width flex row that wraps; under 640px the user block drops to its own line and extra role chips hide. The section nav is a horizontally scrolling tab strip with hidden scrollbar.

Tables collapse below 640px into stacked records: the header row is hidden, each cell becomes a two-column grid (7.5em label from `data-label`, then value), and action buttons left-align.

The sign-in screen drops the column and the header band: the MyADA-style panel is centred, `min(462px, 100%)` wide with a 16px gutter, 10vh from the top (24px on phones), with the demo panel 18px below it. Under 480px the panel padding narrows to 22px; under 400px demo rows stack their role plates under the name. On fine pointers demo rows may shrink to 40px; touch keeps 44px.

## Elevation & Depth

Flat by default. Cards, inputs, tables, nav and the header band carry no shadow; depth comes from the paper ground against white surfaces and 1px hairlines. Shadows appear only on things that physically float above the page.

### Shadow Vocabulary
- **Hanging permit** (`filter: drop-shadow(0 10px 22px rgba(11,61,145,.16)) drop-shadow(0 2px 4px rgba(23,32,46,.1))`): the owner's permit tag only. A drop-shadow filter so the shadow follows the masked silhouette, hole and notches included.
- **Toast** (`box-shadow: 0 6px 24px rgba(23,32,46,.25)`): the transient toast.
- **Dialog** (`box-shadow: 0 20px 60px rgba(23,32,46,.35)`): modal dialogs, over a 50% Ink backdrop.

### Named Rules
**The Only-What-Floats Rule.** A shadow means the object is not on the page: a hanging tag, a toast, a dialog. Cards and panels stay flat.

## Shapes

Gentle, utilitarian corners: 6px on controls (buttons, inputs, notices, demo rows), 8px on cards, verdicts, dialogs and toasts, full pills for status and header role chips. Physical objects get their own geometry: plates use a 5px corner and a 2px Ink border; role plates a 3px corner and 1px border. The hang-tag is cut, not just rounded: a 22px top radius, an 18px punched hanger hole and 20px half-circle notches at the perforation, all done with CSS masks, a 2px dashed tear line inset 14px, and a 14px bottom radius on the stub. Verdicts and messages mark their meaning with a thick left rule (8px and 4px).

## Components

### Header Band
The ADA navy band across every screen: "MyADA" in bold plus "Smart Parking", user name and role chips on the right (translucent white pills), and header buttons as white outlines that fill to 10% white on hover. On sign-in only the brand shows.

### Buttons
- **Shape:** gently rounded (6px), minimum 40px tall, 600 weight at 1rem.
- **Primary:** ADA Navy fill, white text, navy border; Deep Navy on hover.
- **Ghost:** white with navy text and border; Navy Mist on hover.
- **Danger:** white with Check Red text and border, Check Soft on hover; **Danger Solid** is a red fill for final confirms.
- **Busy / Disabled:** 65% opacity with a progress cursor while busy; not-allowed cursor when disabled.
- **Gate buttons:** 1.15rem, 14px 32px padding, 56px tall, flexing to share the row.
- **Focus:** 3px Focus Amber outline, 2px offset.

### Inputs / Fields
- **Style:** white, 1px Field Stroke border, 6px radius, 9px 11px padding, inherited font. Labels sit above in Label type; hints below at 0.8rem Slate.
- **Focus:** 3px Focus Amber outline at 0 offset plus an Ink border.
- **Error:** Check Red border (`aria-invalid`); error text in Check Red 600 below the form. On sign-in, errors sit in a Check Soft block above the fields.
- **Plate input:** the gate's plate field uses Plate Large type, uppercase, with a plain UI-type placeholder.

### Navigation
A white tab strip under the header with a hairline bottom border. Tabs are Slate 600 text with a 3px transparent underline; hover goes to Ink; the current page is navy text with a navy underline. Scrolls horizontally on narrow screens.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** Surface White on Campus Paper.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px Hairline.
- **Internal Padding:** 20px (16px on phones).
- **Notices:** borderless 6px blocks in Navy Mist (info), Wait Soft (warn) or Check Soft (bad).
- **Messages:** a 4px navy left rule with 14px indent.

### Status Pill
An inline pill (999px) with a 7px dot in the current colour, 1px 10px padding, Status type. Active is allow, pending is wait, rejected/suspended/expired/none are check, inactive is a neutral grey tint with Slate text.

### Number Plate (signature)
Drawn to the national standard **AZS 599-2015, Type I** (Table 1, Figure 5, Figure 18), with every dimension in plate millimetres via one unit, `--u` = plate height / 110:
- **Plate:** 520 x 110, corner R13, white reflective field, a 4.5 black border strip inset 3 from the edge (§2.2: symbols and border strip black on white). On screen a 1px #c3cad6 hairline marks the plate edge.
- **Flag (§1.7):** the tricolour, 42 x 21, at 25 from the left and 17 from the top, with crescent and star.
- **RFID label:** 58 x 44 at 16 from the left and 17 from the bottom, white with a thin black rounded outline and "AZ" in the plate face, directly below the flag.
- **Characters:** Barlow Semi Condensed 500 (a DIN 1451-style face, loaded from Google Fonts so every device draws the same plate), cap height 65 of the 110 plate (smaller than the standard 77, by preference), 5 between letters. Each letter is trimmed to its cap height (`text-box: trim-both cap alphabetic`), so it is vertically centred on the plate, and the character group is centred in the field right of the flag band. The plate is always 520 wide. Plates stored without separators ("10AB123") are drawn in the standard 10-AB-123 groups.
- **Separators:** raised bars 15 x 10, 8 clear either side (31 between groups), never the font's hyphen, whatever was typed.
- **Sizes:** 30px tall inline, 58px for verdicts (50px on phones), 46px on the owner's permit tag; the gate input is itself a plate (78–104px).
- It is announced as one image ("Plate 10-AB-123").

### Gate Verdict
An 8px-radius panel with an 8px left rule in the verdict colour, soft tint fill, and the verdict word in Verdict type ("Allow" in allow green, "Check the driver" in check red), followed by the vehicle line with a plate.

### Tables
Full-width, collapsed borders, 0.95rem; 10px 8px cells with hairline rules; Slate 0.85rem headers; actions right-aligned. Below 640px they become labelled stacked records (see Layout).

### MyADA Sign-in
The sign-in mirrors the MyADA sign-in page so it reads as part of ADA at first glance; the header band is hidden on this screen.
- **Ground:** Slate Ground `#a9bcc6` with a woven 45/-45 degree 1px texture.
- **Panel:** `min(462px, 100%)`, Slate `#527a8e` (deepened from MyADA so white text passes AA at 4.6:1), a 1px 70% white border, square corners, a soft offset shadow. Centred, 10vh from the top (24px on phones).
- **Crest:** the ADA logomark with "UNİVERSİTET" and "UNIVERSITY" set on an arc through the mark's star (serif, 17 units, 3 letter-spacing), then "SMART PARKING" in Barlow 500, 0.32em tracking, so it never passes for MyADA itself.
- **Form:** fields 48px, Field `#dfe7f3`, centred text, placeholders as the visible labels (screen-reader labels behind them); SIGN IN as a 1px white outline that fills 14% white on hover; "Remember me on this computer" keeps the session in localStorage instead of the tab; "Forgot your password?" links to ADA's password page.
- **Demo panel:** only when demo login is on, below the sign-in panel: 55% white with a white border, a bold "Prototype:" label, then demo rows with role plates. A picked row turns white with a Slate border while signing in.
- **Motion:** the panels rise 12px and fade in once (0.5s, demo panel 80ms later); on sign-in they lift 10px and fade out (0.3s) before the app enters.

### Motion
Feedback 100–150ms, state changes 200–320ms, authored moments up to 900ms; arrivals use `cubic-bezier(.16,1,.3,1)`, exits `cubic-bezier(.7,0,.84,0)` and run faster.
- **Section change:** the paper nav tab slides to the new section at once (View Transition on the tab only); content rises 8px and fades over 0.32s, staggered 40ms per block and capped, with table rows capped at five steps.
- **Sign-in:** the panels lift 10px and fade (0.3s), then the app enters.
- **Gate:** the verdict fades in over 0.12s, the verdict word stamps (scale 1.18 to 1), and the typed plate flies from the input into the verdict (FLIP, 0.42s). The new movement row flashes its status tint for 1.8s. An empty submit shakes the plate input once.
- **Approvals:** a handled row tints and slides out (0.22–0.32s) before the list refreshes.
- **Controls:** buttons scale to 0.97 on press; busy buttons show a spinner after 150ms. A response slower than 180ms shows a thin bar along the top edge.
- **Overlays:** dialogs rise 10px and scale from 0.97 over 0.24s; the toast rises 12px.
- **Reduced motion:** movement becomes a short fade or nothing; the swings and the shake are off.

### Toast and Dialog
The toast is an Ink pill-ish block (8px) centred 20px from the bottom, fading in over 0.15s; errors turn it Check Red. Dialogs are 8px, 22px padded, at most 440px wide, actions right-aligned.

## Do's and Don'ts

### Do:
- **Do** use ADA Navy for the header band, primary actions and links, and keep the ADA logomark white on navy.
- **Do** show every status as tint plus ink from the allow / check / wait triad, with the status dot on pills.
- **Do** render plate numbers with the plate component, never as plain text in the Plate font.
- **Do** keep Barlow Semi Condensed to stamped codes (plates, permit year, tag mark, role plates), tracked, at 600.
- **Do** give every interactive element the 3px Focus Amber ring and touch rows at least 44px.
- **Do** label demo affordances as prototype ("Prototype: sign in as a demo account") and keep them in their own panel, below the real sign-in.
- **Do** give every movement a fade-only or static path under `prefers-reduced-motion`, keeping feedback legible.

### Don't:
- **Don't** move the signed-in app off ADA navy; only the sign-in screen uses the MyADA slate.
- **Don't** use the flag colours as UI colours, or draw the plate with an EU-style blue strip or with spaces or font hyphens between the groups.
- **Don't** add shadows to cards, inputs or panels; shadows are for the hanging tag, toasts and dialogs.
- **Don't** call a gate verdict "denied" or "blocked"; the vocabulary is "Allow" and "Check the driver", because the gate never auto-blocks.
- **Don't** add decorative motion: scroll reveals, hover lifts, or loops (the slow-response bar loops only while a request is pending).
