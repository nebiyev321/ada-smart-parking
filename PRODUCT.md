# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Vehicle owners:** ADA University students and faculty/staff who register a car, wait for admin approval, request vehicle changes and read messages about their car.
- **Guards:** campus staff at the gate who record entry/exit, search plates and check permit status.
- **Parking admins:** staff who approve or reject registrations, contact owners, suspend permits and grant early vehicle changes.
- **System admins:** staff who read the audit log and set the vehicle-change cooldown.

Today the main audience is ADA decision-makers seeing the prototype demo. The product should still look and work like the real campus service so it can ship without a rebuild once MyADA sign-in is connected.

## Product Purpose
ADA Smart Parking is a parking-permit service that runs as its own service beside MyADA. It replaces informal parking management with registered vehicles, admin-approved permits, gate logging and an audit trail. Success right now means the prototype convinces ADA to adopt it. Later, success means students, staff and guards use it daily.

## Positioning
It is built around ADA's own rules and identity: MyADA accounts, ADA affiliation-based permit terms (students until 30 June, faculty and staff one year), and ADA campus roles (guard, parking admin, system admin). A generic parking SaaS can't truthfully claim that fit.

## Operating Context
- Sign-in is mocked. A username (MyADA ID) issues an HMAC token, and the password field is not checked. `app/auth.py` is the only file to swap for real MyADA OIDC/SSO.
- The demo-account picker shows only when `PARKING_DEMO_LOGIN=1`. It's on by default locally and off by default when deployed.
- Guards use it at the gate, likely on a phone or tablet. Admins and owners use desktop or phone.
- It's deployed on Vercel at ada-smart-parking.vercel.app, with a FastAPI backend and a single-page vanilla HTML/CSS/JS frontend in `app/static/`.

## Capabilities and Constraints
- Sign-in page: keep the username + password form that mirrors the familiar MyADA sign-in, plus the demo-account picker while it's a prototype.
- "Forgot your password?" links to ADA's real password page (online.ada.edu.az/password).
- One active vehicle per person, admin approval for new and changed vehicles, a 90-day change cooldown with admin override, and gate reads that are never auto-blocked.
- Not built yet: real SSO, registration-certificate upload, real email or MyADA notifications, camera or RFID hardware.

## Brand Commitments
- The ADA logomark (`app/static/ada-mark.svg`) and ADA blue are binding. Everything else about the look is open.
- Product name: "ADA Smart Parking", shown beside MyADA.

## Evidence on Hand
- Six demo accounts (see README): Leyla Mammadova, Murad Aliyev (students), Dr. Nigar Huseynova (faculty), Rashad Karimov (guard), Aysel Guliyeva (parking admin), Tural Hasanov (system + parking admin).
- Screenshots in `docs/screenshots/`.
- No testimonials, usage numbers or adoption claims exist, so don't invent any.

## Product Principles
1. Feel like part of ADA: users should trust it as a campus service at first glance.
2. Be honest about the prototype: demo affordances are labeled as such and never pass for real security.
3. Built to ship: demo-first now, but nothing should need redesigning when real sign-in arrives.
4. The gate never auto-blocks: decisions stay with people, and the UI informs them.

## Accessibility & Inclusion
No product-specific standard has been set. Follow WCAG 2.2 AA as a baseline, since this is a university service used by all students and staff.
