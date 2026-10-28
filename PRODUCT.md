# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Vehicle owners:** members of the organisation (residents, employees, students, contractors) who register a car, wait for admin approval, request vehicle changes, issue visitor passes and read messages about their car.
- **Guards:** site staff at the gate who record entry/exit, search plates and check permit status.
- **Parking admins:** staff who approve or reject registrations, contact owners, suspend permits and grant early vehicle changes.
- **System admins:** staff who read the audit log and set the rules: vehicle-change cooldown, renewal window and permit length.

## Product Purpose
Smart Parking is a parking-permit service for any organisation's site: a campus, an office park, a residential complex. It replaces informal parking management with registered vehicles, admin-approved permits, gate logging, one-day visitor passes and an audit trail. Success means guards, admins and members use it daily, and an organisation can adopt it by connecting its own sign-in.

## Positioning
Rules that differ between sites are settings, not code: permit length (a number of days, or a fixed yearly end date such as an academic year), the change cooldown, the renewal window and the site's time zone. Member groups (member, contractor, staff) and staff roles (guard, parking admin, system admin) fit most organisations without changes.

## Operating Context
- Sign-in is mocked. An account ID issues an HMAC token, and the password field is not checked. `app/auth.py` is the only file to swap for real OIDC/SSO.
- The demo-account picker shows only when `PARKING_DEMO_LOGIN=1`. It's on by default locally and off by default when deployed.
- Guards use it at the gate, likely on a phone or tablet, often outdoors. Admins and owners use desktop or phone.
- Deployed on Vercel, with a FastAPI backend and a single-page vanilla HTML/CSS/JS frontend in `app/static/`.
- The first deployment is in Azerbaijan: number plates are drawn to AZS 599-2015, the interface is in English and Azerbaijani, and the site clock defaults to +04:00.

## Capabilities and Constraints
- Sign-in page: a username + password form shaped like a typical organisation sign-in, plus the demo-account picker while it's a prototype.
- One active vehicle per person, admin approval for new and changed vehicles, a 90-day change cooldown with admin override, and gate reads that are never auto-blocked.
- Not built yet: real SSO, registration-certificate upload, real email or in-app notifications, camera or RFID hardware.

## Brand Commitments
- Product name: "Smart Parking". The mark is a white "P" on a blue rounded square (`app/static/mark.svg`).
- No organisation's own branding is built in; a site can add its logo beside the mark later.

## Evidence on Hand
- Six demo accounts (see README): Leyla Mammadova, Murad Aliyev (members), Nigar Huseynova (contractor), Rashad Karimov (guard), Aysel Guliyeva (parking admin), Tural Hasanov (system + parking admin).
- Screenshots in `docs/screenshots/` show the earlier ADA-branded design.
- No testimonials, usage numbers or adoption claims exist, so don't invent any.

## Product Principles
1. Trustworthy at first glance: calm, legible, and clearly an official service of the site it runs on.
2. Be honest about the prototype: demo affordances are labeled as such and never pass for real security.
3. Built to ship: demo-first now, but nothing should need redesigning when real sign-in arrives.
4. The gate never auto-blocks: decisions stay with people, and the UI informs them.

## Accessibility & Inclusion
Follow WCAG 2.2 AA as a baseline: 4.5:1 text contrast in both themes, visible focus, 44px touch targets, reduced-motion fallbacks.
