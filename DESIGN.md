---
name: ADA Smart Parking
description: ADA University's campus parking-permit service, signed like an airport terminal.
colors:
  sign-navy: "#0b3d91"
  navy-deep: "#07265e"
  navy-soft: "#e9effa"
  sign-muted: "#b9c8e6"
  wayfinding-yellow: "#ffc72c"
  hall: "#f4f6fa"
  surface: "#ffffff"
  ink: "#0e1a2e"
  muted: "#56627a"
  line: "#dfe4ec"
  stroke: "#b4bdcc"
  allow: "#0f7b45"
  allow-soft: "#e2f3e9"
  check: "#b8232b"
  check-soft: "#fbe9ea"
  wait: "#8a5300"
  wait-soft: "#fff2d6"
  idle-soft: "#edf0f4"
  plate-white: "#ffffff"
  plate-black: "#111111"
  plate-placeholder: "#6b7385"
  plate-rim: "#c3cad6"
  dark-hall: "#08111f"
  dark-surface: "#0f1a2e"
  dark-sign: "#0d2f70"
  dark-navy: "#3b6fd8"
  dark-navy-ink: "#9dbaf5"
  dark-ink: "#e6ecf6"
  dark-muted: "#98a6c0"
  dark-line: "#213050"
typography:
  display:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(2rem, 4.4vw, 2.75rem)"
    fontWeight: 300
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  verdict:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(2.4rem, 7vw, 3.5rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 300
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "tnum"
  label:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 600
    lineHeight: 1.55
  table-head:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 600
  plate:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "calc(var(--u) * 92)"
    fontWeight: 500
    lineHeight: 1
  permit-term:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.06em"
rounded:
  tile: "2px"
  r: "4px"
spacing:
  xs: "6px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  2xl: "28px"
  3xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.sign-navy}"
    textColor: "{colors.surface}"
    rounded: "{rounded.r}"
    padding: "10px 18px 8px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.navy-deep}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.sign-navy}"
    rounded: "{rounded.r}"
    padding: "10px 18px 8px"
    height: "44px"
  button-ghost-hover:
    backgroundColor: "{colors.navy-soft}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.check}"
    rounded: "{rounded.r}"
    padding: "10px 18px 8px"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r}"
    padding: "10px 12px 8px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.r}"
    padding: "24px"
  sign-band:
    backgroundColor: "{colors.sign-navy}"
    textColor: "{colors.surface}"
    height: "60px"
    padding: "0 24px"
  sign-tile:
    backgroundColor: "{colors.sign-navy}"
    textColor: "{colors.surface}"
    rounded: "{rounded.r}"
    size: "48px"
  status:
    rounded: "{rounded.tile}"
    padding: "3px 9px 1px"
    typography: "{typography.label}"
  status-active:
    backgroundColor: "{colors.allow-soft}"
    textColor: "{colors.allow}"
  status-pending:
    backgroundColor: "{colors.wait-soft}"
    textColor: "{colors.wait}"
  status-void:
    backgroundColor: "{colors.check-soft}"
    textColor: "{colors.check}"
  verdict-allow:
    backgroundColor: "{colors.allow}"
    textColor: "{colors.surface}"
    rounded: "{rounded.r}"
    padding: "24px"
  verdict-check:
    backgroundColor: "{colors.check}"
    textColor: "{colors.surface}"
    rounded: "{rounded.r}"
    padding: "24px"
  verdict-tile:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.tile}"
    size: "72px"
  plate:
    backgroundColor: "{colors.plate-white}"
    textColor: "{colors.plate-black}"
    height: "30px"
    width: "calc(var(--u) * 520)"
  plate-lg:
    height: "58px"
  plate-input:
    backgroundColor: "{colors.plate-white}"
    textColor: "{colors.plate-black}"
    height: "clamp(78px, 13vw, 104px)"
    padding: "0 calc(var(--u) * 14) 0 calc(var(--u) * 80)"
---

# Design System: ADA Smart Parking

## Overview

**Creative North Star: "Terminal Wayfinding"**

The campus gate is a terminal. Every screen says where you are and where to go in the calm, bright language of airport signage: navy sign panels carry white legends, a single wayfinding yellow marks "you are here", and work happens on a bright, quiet hall floor. The system answers a request for something "more futuristic and also minimalistic" with signage rather than effects: light, wide headings, one-device-pixel rules, square pictogram tiles, and one authored moment at the gate where a scan line sweeps the plate and the verdict lights up like a backlit sign.

Density is moderate and administrative. Pages are a single 1080px column; records read as ledgers straight off the hall floor, and white surfaces appear only where you act. Light is the default; dark mode follows the operating system automatically and keeps the same sign logic with a deeper navy.

The ADA logomark and ADA blue are binding brand commitments; the navy sign is that blue. The world refuses the grey SaaS card dashboard and the dark neon HUD.

**Key Characteristics:**
- A navy sign band with white section legends; the current one carries a 4px yellow bar.
- Light (300) Overpass page headings beside a navy pictogram tile, standing on a hairline.
- Hairlines are one device pixel; corners are 4px, tiles 2px.
- White cards for actions, ruled ledgers for records.
- Real Azerbaijani number plates drawn to AZS 599-2015 in Barlow Semi Condensed.
- The gate verdict is a solid lit sign: green Allow or red Check the driver.

## Colors

A navy-and-white signage palette on a cool hall, with one yellow that only ever means location, and three traffic states kept for meaning.

### Primary
- **Sign Navy** (`sign-navy`): the sign band, page sign tiles, the permit sign, primary buttons, toast and links in light mode. It is ADA blue, so it is binding. In dark mode the band drops to Night Sign (`dark-sign`) and interactive navy lifts to `dark-navy`, with links and focus accents in `dark-navy-ink`.
- **Deep Navy** (`navy-deep`): primary button hover only.
- **Navy Mist** (`navy-soft`): ghost button hover, notices, the entry/exit button tile on ghost buttons, demo role chips.
- **Legend Mute** (`sign-muted`): inactive legends and secondary text on navy (nav links, the role, the permit term).

### Secondary
- **Wayfinding Yellow** (`wayfinding-yellow`): exactly three uses. The 4px "you are here" bar under the current nav legend, the 3px focus ring, and text selection (with ink text).

### Tertiary
- **Allow Green** (`allow`) with **Allow Tint** (`allow-soft`): active permits, the Allow verdict sign, the validity bar fill, fresh-allow row flashes. The verdict sign keeps `#0f7b45` in both schemes; text uses a lighter green (`#5fd396`) in dark mode.
- **Check Red** (`check`) with **Check Tint** (`check-soft`): rejected, suspended, expired, the Check the driver verdict, errors, danger buttons. The verdict sign keeps `#b8232b` in both schemes.
- **Wait Amber** (`wait`) with **Wait Tint** (`wait-soft`): pending states and warning notices.
- **Idle Tint** (`idle-soft`): inactive permits and the empty track of the validity bar.

### Neutral
- **Hall** (`hall`): the page ground. Ledgers sit directly on it.
- **Surface White** (`surface`): cards, the permit body, dialog, inputs, the sign-in panel.
- **Ink** (`ink`): body text, the 1px rule under ledger headers, the inner ring of focus.
- **Slate** (`muted`): secondary text, field labels, table headers, scanner brackets at rest.
- **Hairline** (`line`): card borders, table row rules, page-head rule.
- **Field Stroke** (`stroke`): input borders, ghost button borders, the demo-panel rule.
- **Plate White / Plate Black / Plate Rim** (`plate-white`, `plate-black`, `plate-rim`): the number plate only; fixed in both schemes because a plate is a physical object. `plate-placeholder` is the "00-AA-000" hint in the gate input.

### Named Rules
**The You-Are-Here Rule.** Wayfinding yellow marks location (the current nav legend), focus, and selection. Nothing else: no yellow edges, loading bars, buttons, badges or highlights.

**The Lit Sign Rule.** Solid colour fields are signs: navy for place, green or red for the gate verdict. Status everywhere else is a tint behind coloured ink with a small lit square.

## Typography

**Display Font:** Overpass (with system-ui, -apple-system, Segoe UI, sans-serif)
**Body Font:** Overpass
**Plate Font:** Barlow Semi Condensed (with Arial Narrow, sans-serif), only on number plates and the permit term

**Character:** Overpass is a highway-signage face; set light and wide it reads as calm terminal signage, set bold it reads as a verdict at arm's length. Barlow Semi Condensed stands in for the DIN 1451 Mittelschrift of real plates and never leaves them.

### Hierarchy
- **Display** (300, clamp(2rem, 4.4vw, 2.75rem), 1.05, -0.025em): the page sign heading beside its pictogram tile.
- **Verdict** (700, clamp(2.4rem, 7vw, 3.5rem), 1, -0.02em): "Allow" / "Check the driver" only; 2.1rem under 640px.
- **Headline** (300, 1.75rem, 1.1): the sign-in heading.
- **Title** (600, 1.125rem, 1.2): card and ledger headings (h2); h3 is 600 at 1rem.
- **Body** (400, 16px, 1.55, tabular numerals throughout).
- **Label** (600, 0.85rem, Slate): field labels; table headers 600 at 0.8rem; status legends 600 at 0.82rem. Sentence case, no tracking.
- **Plate** (500, 92 plate-millimetres on the plate's own unit, line-height 1): plate characters, trimmed to cap height.

### Named Rules
**The Light Sign Rule.** Page headings are light (300) and wide, never bold; weight is reserved for the verdict.

**The Plates Only Rule.** Barlow Semi Condensed appears only on plates and the permit term.

## Layout

One centred column, max 1080px, padded 40px 24px 72px (28px 16px 64px under 760px). The sticky sign band spans the viewport at a 60px minimum; under 980px the nav wraps to its own full-width row (46px legends) beneath the brand, separated by a faint white rule, and scrolls horizontally with the current legend centred.

Each page opens with the page sign: tile and heading, optional tail (a count, or a page-wide action such as "Approve all renewals") pushed right, 20px below to a hairline, then 28px to the work. Work stacks as cards (20px apart) and ledgers (36px below). Form grids auto-fit 170px columns at 16px gaps. My vehicle is a 360px permit column beside a flexible side column (28px gap); Gate check is the scanner beside a 260-340px button column (32px gap). Both collapse to one column under 760px; the gate buttons then sit side by side, and under 640px stack icon over label at 88px.

Under 640px tables become stacked records: headers move off-screen, each cell shows its label in a 6.5em column, and the plate leads every record.

Spacing steps observed in use: 6, 12, 16, 20, 24, 28, 40px.

## Elevation & Depth

Flat. Surfaces sit on the hall with a one-pixel hairline and no shadow; depth is conveyed by the navy sign versus the white surface versus the hall. Only two things float.

### Shadow Vocabulary
- **Toast** (`box-shadow: 0 8px 28px rgba(8, 20, 45, .28)`): the transient navy toast at the bottom centre.
- **Dialog** (`box-shadow: 0 24px 64px rgba(8, 20, 45, .32)`): modal dialog, over a `rgba(8, 20, 45, .55)` backdrop with a 2px blur.
- **Scan line** (`box-shadow: 0 0 14px 2px` navy at 45%): the glow on the scanner's sweep line during its single pass; not a surface shadow.
- **Plate rim** (`box-shadow: 0 0 0 1px #c3cad6`): the plate's outline so a white plate reads on a white card.

### Named Rules
**The Nothing Floats Rule.** Toast and dialog are the only elevated things. Cards, permits, verdicts and sign-in are flat.

**The One Device Pixel Rule.** Rules are `1px`, or `.5px` at 2dppx and above, so every hairline is one device pixel.

## Shapes

Square-shouldered. A 4px radius on buttons, inputs, cards, permits, verdict signs, the sign tile, notices and dialogs; 2px on inner tiles (status legends, button icon tiles, the verdict pictogram tile, role chips). The status legend leads with a 7px square, the permit state with a 10px square: lit squares, not dots. Pictograms are stroked line drawings on one 24-unit grid (1.75 stroke at 20px; 1.6 at 34px in the sign tile; 2-2.2 on gate buttons and verdict). The validity bar is a 6px square-ended bar.

Number plates are the one curved silhouette, and they follow AZS 599-2015 Type I exactly: 520 x 110 units (`--u` is one millimetre at the rendered height), corner R13, a 4.5-unit black border strip inset 3 units, a 42 x 21 flag at (25, 17), a 58 x 44 "AZ" RFID label at 16 from the left and 17 from the bottom, characters 92 units on a cap-trimmed line, 5 units apart, centred as one group in the field right of the flag band; separators are 15 x 10 bars with 8 units either side.

## Components

### Buttons
Calm, solid, signed.
- **Shape:** 4px corners, 44px minimum height, padding 10px 18px 8px (the 2px bottom offset centres Overpass caps), 600 at 0.95rem.
- **Primary:** Sign Navy fill, white legend; Deep Navy on hover.
- **Ghost:** transparent with Field Stroke border and navy legend; Navy Mist fill and navy border on hover.
- **Danger:** transparent with Check Red border and legend; Check Tint on hover. A solid red variant exists for confirming destructive dialogs.
- **On the band:** transparent with a 45% white border, 34px tall.
- **Press / busy:** scale .97 on press; busy buttons dim to 65% and show a spinner after 150ms.

### Gate sign buttons
Record entry (primary) and Record exit (ghost) are 64px sign buttons, 1.15rem, with a 44px pictogram tile (white 14% on navy; Navy Mist on ghost) holding the entry or exit arrow.

### Status
A tint behind coloured ink with a 7px lit square, 2px corners, 0.82rem 600. Active is green, pending amber, rejected/suspended/expired red, inactive idle. Replaced (inactive) and rejected statuses are struck through with a 1px line: nothing disappears, it cancels.

### Cards / Containers
- **Corner Style:** 4px.
- **Background:** Surface White, with a one-device-pixel Hairline border.
- **Shadow Strategy:** none (see Elevation).
- **Internal Padding:** 24px (18px 24px for filter cards; 18px 16px under 640px).
- **Use:** only for things you act on: filters, forms, the permit, Change vehicle, Rules, search results, messages.

### Ledgers
Records (Approvals, Gate log, Audit log, My entries and exits, Recent movements) are tables placed straight on the hall: an h2, a 1px Ink rule under the header row, hairline rows, no outer border, first and last cells flush. Table headers are Slate 600 at 0.8rem. New rows flash their verdict tint for 1.8s; handled approvals slide out right.

Ledgers also carry On campus ("Inside now", oldest entry first, with Overnight and No permit status notes; "Visitors expected today") and the unregistered plates found by Find a vehicle under "Entering without a permit". Upcoming visitor passes on My vehicle are a hairline-ruled list inside the Visitor passes card: plate, day, guest, a status (Waiting for approval in Wait, Approved in Allow, Rejected in Check, struck through, with the reason below), and a small ghost Cancel button. Approvals holds two ledgers, "Visitor passes" (guards and admins) above "Permits" (admins only); Find a vehicle ends with the "All registered vehicles" ledger. On phones, empty cells of a stacked record are hidden.

### Inputs / Fields
- **Style:** Surface White, 1px Field Stroke border, 4px corners, 44px tall, padding 10px 12px 8px; label above in 0.85rem 600 Slate, hint below in 0.8rem.
- **Hover:** border darkens to Slate.
- **Focus:** 3px yellow outline flush to the field with an Ink border.
- **Error:** Check Red border; message in Check Red 600 below the form.

### Navigation
Section legends on the navy band: pictogram plus 600 0.95rem label, Legend Mute at rest, white on hover and when current. The current legend carries a 4px yellow bar inset 14px from each side at the bottom edge. Switching sections slides the bar to its new legend with a 300ms view transition. The visitor's name and role sit at the right, with a ghost sign-out button.

### Page Sign
A 48px navy tile (40px under 640px) holding the section pictogram at 34px, beside the Display heading, on a hairline. The tile appears only for sections in the nav.

### Permit
The owner's permit as a sign: a navy head with the ADA mark, "Parking permit" and the academic term in Barlow (e.g. 2025/26), the large plate on the navy; beneath it a full-width state strip (tint with a 10px lit square, 700 at 1.05rem); then a white body with the car, the holder, the validity bar and a note above a hairline. Void permits fade their plate to 50%.

### Validity Bar
A 6px square-ended progress bar under "Time left / N days". Its length is the share of the permit term still left, in Allow Green on an Idle track. Shown for active permits only.

### Number Plate
A drawn AZS 599-2015 plate at 30px inline, 58px large (50px under 640px, 44px in the phone verdict). Fixed white, black and flag colours in both schemes.

### Gate Scanner and Plate Input
The gate input is itself a plate (78-104px tall) inside a viewfinder of four 22px corner brackets in Slate, turning navy on focus. Typed characters are centred like drawn ones: padding 0 14u 0 80u, type at 82 plate-millimetres rather than 92 (an input cannot squeeze wide glyphs, and the widest plates such as "99-WW-888" need 5.05em of the 426mm field), centred text, letter-spacing and text-indent .054em, padding-bottom .092em (Barlow caps sit 0.046em low on a line-height-1 box), uppercase, navy caret. Placeholder "00-AA-000" in Plate Placeholder. An empty submit nudges the plate side to side and reddens its strip.

### Verdict
A solid backlit sign: Allow Green for "Allow" with a proceed arrow, Check Red for "Check the driver" with a stop octagon; the pictogram sits in a 72px white tile (52px under 640px) in the verdict's colour. Everything after the tile sits in one text column (`.verdict-body`): the large plate, the owner (or "Visitor of <host>" for a day pass) or the instruction, a repeat-entry line for plates that came in without a permit three or more times (bold, inside a 1px 75%-white outline, never a filled block), and the recorded time in 94% white. Campus has one gate, so the verdict names the time, not the gate. The gate never auto-blocks, so the words stay "Allow" and "Check the driver".

### Toast and Dialog
The toast is a navy sign (red for errors) that rises 12px into place at the bottom centre. The dialog is a 460px white surface with 4px corners and right-aligned actions.

### Sign-in
A 440px white panel whose head is a navy sign carrying the ADA crest and "Smart Parking"; the form below has a Headline, fields, a full-width 48px primary button and a forgot link. The band is hidden on this screen. Demo accounts sit below a stroke rule as quiet transparent rows with navy role chips (staff roles as solid navy chips).

### Motion
Feedback stays at or under 150ms; state changes take 200-320ms on `cubic-bezier(.16, 1, .3, 1)` going in and `cubic-bezier(.7, 0, .84, 0)` going out. Pages rise 8px in sequence (sign, then work, capped at 80ms delay). The one authored moment is the gate: the scan line sweeps the frame once (500ms), the verdict sign lights up (450ms), its tile lands from 70% (320ms), and the typed plate flies from the input into the verdict (420ms). The slow-response bar is white over the band (navy on sign-in). Under reduced motion everything falls back to 200ms fades or holds still.

## Do's and Don'ts

### Do:
- **Do** keep Wayfinding Yellow to the current-section bar, the focus ring and selection.
- **Do** put records in ledgers on the hall (1px Ink header rule, hairline rows) and keep white cards for things the user acts on.
- **Do** open every section with the page sign: navy pictogram tile, light 300 heading, hairline beneath.
- **Do** draw plates with the shared plate component and unit system; never type a plate as plain text.
- **Do** show permanence: replaced and rejected statuses are struck through, void permits fade their plate, nothing is removed from view.
- **Do** keep the gate's vocabulary "Allow" / "Check the driver"; the gate advises, it does not block.
- **Do** give every movement a fade-only or static path under reduced motion.
- **Do** keep hairlines to one device pixel and corners to 4px (2px for inner tiles).

### Don't:
- **Don't** use yellow for edges, loading bars, buttons, badges or emphasis.
- **Don't** wrap record lists in white cards.
- **Don't** add shadows to cards, permits or verdicts; only toast and dialog float.
- **Don't** set page headings bold or use Barlow Semi Condensed outside plates and the permit term.
- **Don't** add a second authored animation; the gate is the one moment.
- **Don't** drift toward the grey SaaS card dashboard or the dark neon HUD.
