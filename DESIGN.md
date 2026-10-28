---
name: Smart Parking
description: A parking-permit, gate and visitor-pass service for any organisation's site, in a Swiss-minimal style.
colors:
  brand: "#2563eb"
  brand-deep: "#1d4ed8"
  brand-ink: "#1d4ed8"
  brand-soft: "#eff6ff"
  hall: "#f8fafc"
  surface: "#ffffff"
  surface-2: "#f1f5f9"
  ink: "#0f172a"
  muted: "#475569"
  line: "#e2e8f0"
  stroke: "#cbd5e1"
  allow: "#15803d"
  allow-soft: "#dcfce7"
  check: "#b91c1c"
  check-soft: "#fee2e2"
  wait: "#92400e"
  wait-soft: "#fef3c7"
  idle-soft: "#f1f5f9"
  plate-white: "#ffffff"
  plate-black: "#111111"
  dark-hall: "#0b1220"
  dark-surface: "#111a2e"
  dark-brand-ink: "#93c5fd"
  dark-brand-soft: "#172554"
  dark-ink: "#e2e8f0"
  dark-muted: "#94a3b8"
  dark-line: "#1e293b"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(1.75rem, 3.6vw, 2.25rem)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  verdict:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "clamp(2.4rem, 7vw, 3.5rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "tnum"
  label:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "0.85rem"
    fontWeight: 600
  table-head:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.04em"
    textTransform: "uppercase"
  plate:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontWeight: 500
rounded:
  pill: "999px"
  r: "8px"
  r-lg: "12px"
  panel: "16px"
spacing:
  xs: "6px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  2xl: "28px"
  3xl: "40px"
---

# Design System: Smart Parking

## Overview

**Direction: Swiss minimal.** A bright, quiet workspace on one blue. Hierarchy comes from type weight, size and space rather than from colour or decoration. Colour carries meaning only: blue for action and place, green for allowed, red for "check the driver", amber for waiting. The direction came from the ui-ux-pro-max design system for a parking-permit app (Minimalism & Swiss Style; available blue, allowed green, occupied red), with Plus Jakarta Sans as the one interface family.

The product is generic: no organisation's branding is built in. The mark is a white "P" on a blue rounded square (`app/static/mark.svg`), which is also the favicon.

Light is the default; dark mode follows the device unless the person picks a theme.

## Colors

- **Brand blue** (`brand`, #2563eb): primary buttons, the permit head, the current-tab rule, the focus ring, demo staff chips. White text on it is 5.2:1. Dark mode keeps #2563eb for filled buttons and uses `dark-brand-ink` (#93c5fd) for links and the current tab.
- **Brand soft** (`brand-soft`): icon tiles beside page titles, ghost-button hover, notices, role chips.
- **Neutrals** (slate): `hall` page ground, `surface` cards, `ink` text, `muted` secondary text (7.5:1 on white), `line` hairlines, `stroke` input and ghost-button borders.
- **Allow / Check / Wait**: green, red and amber, each with a soft tint. Statuses are a tint behind coloured text with a dot; the gate verdict is a solid green or red field with white text.
- **Plates** keep fixed white, black and flag colours in both themes, because a plate is a physical object.

## Typography

- **Plus Jakarta Sans** everywhere in the interface. Page titles 800, tight tracking; card titles 700; labels 600; body 400 with tabular numerals.
- Table headers are small uppercase, 0.75rem, tracked +0.04em, in `muted`.
- **Barlow Semi Condensed** only on number plates (it stands in for the DIN 1451 lettering of real plates).

## Layout

One centred column, max 1080px. The header is a translucent white bar with a hairline under it: the mark and "Smart Parking" on the left, sections as tabs with a 2px blue rule under the current one, the person, the language and theme switches and Sign out on the right. Below 1480px the tabs wrap to their own row and scroll sideways.

Each page opens with a 44px icon tile (brand-soft, brand-ink icon) beside the bold title, then 28px to the work. Cards are 20px apart; records (ledgers) sit straight on the page. Under 640px tables become stacked records with the plate leading.

## Elevation & Shape

- Cards and the permit: 12px radius, a hairline border and the faintest lift (`0 1px 2px` at 5%). Dark mode drops the lift.
- The sign-in card: 16px radius with a soft shadow, over a faint blue glow at the top of the page.
- Toast (ink on white, red for errors) and dialog are the only floating layers. On phones the dialog rises from the bottom as a sheet.
- Buttons and inputs: 8px radius, 44px tall. Statuses and role chips are pills.

## Components

- **Buttons:** primary (blue fill, white text), ghost (stroke border, brand-ink text), danger (red border and text). Pressed buttons scale to .97; busy buttons dim and show a spinner after 150ms.
- **Inputs:** 1px stroke border; focus is a 2px blue outline with a blue border. Errors use a red border, with the message under the field, led by a red dot.
- **Permit:** a blue head with the mark, "Parking permit" and "Valid to MM/YYYY", the large plate on the blue; a full-width state strip (tint and dot); then the car, the holder and group, a 6px rounded validity bar, a note and Print permit.
- **Gate check:** the plate input sits in a four-corner viewfinder that turns blue on focus. Record entry (primary) and Record exit (ghost) are 64px buttons with a 44px icon tile.
- **Verdict:** a solid green "Allow" or red "Check the driver" field, a 72px white icon tile, the plate, the owner or instruction, and the recorded time.
- **Rules (Audit and settings):** days between vehicle changes, the renewal window, the permit length in days, and an optional fixed yearly end date (`MM-DD`).
- **Sign-in:** one card with the mark and name, the title, username, password with a show/hide toggle, a full-width Sign in button, Remember me, and a help line. Demo accounts sit below a rule as quiet rows with group and role chips.

## Motion

Feedback is at most 150ms. State changes take 200-320ms, easing out going in and in going out. Pages rise 8px in sequence. The one authored moment is the gate: the scan line sweeps once, the verdict lights, its tile lands, and the typed plate flies into the verdict. Under reduced motion everything becomes a 200ms fade or holds still.

## Do's and Don'ts

- **Do** keep colour for meaning; use weight, size and space for hierarchy.
- **Do** draw plates with the shared plate component; never type a plate as plain text.
- **Do** keep statuses legible after they end: replaced and rejected are struck through, never removed.
- **Do** keep the gate's words "Allow" / "Check the driver"; the gate advises, it does not block.
- **Don't** add heavy shadows, gradients or glass panels to working surfaces; the header blur and the sign-in glow are the only atmospheric touches.
- **Don't** put white text on the lighter dark-mode blues; filled buttons stay #2563eb.
- **Don't** build an organisation's branding into the product; it belongs in configuration.
