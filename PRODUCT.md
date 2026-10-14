# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Job seekers using JobPilot SG and original InternSG application pages.

## Product Purpose

Aggregate jobs and assist applicants with profile-based, user-reviewed answers.

## Capabilities and Constraints

Current v0.6: users maintain reusable application details on the JobPilot profile.
The extension reads that account's latest saved data for each application. Previous
device data is only imported after explicit review and never overwrites platform
values. Introductions are user-written, with no model generation. The extension
connects through explicit platform approval using a single-use PKCE code and a
restricted session. There is no second password form. Logout revokes that connection.
The historical pilot notes below do not override these current decisions.

The user approved an InternSG-only extension: login, inspect fields, edit and confirm,
then fill empty supported fields. Existing values must not be overwritten. Nationality
widgets now have explicit replacement confirmation for nationality and study country together.
Supplementary details are stored locally per API origin and account ID. CAPTCHA and consent
remain manual. Version 0.3 permits the site submit button only after a separate final review
and explicit authorization; duplicate attempts are locally blocked and delivery stays unverified.
Live summaries use a backend
provider; no provider secret is shipped to the extension. This is an extension of the
existing product, not a redesign. Deployment and live acceptance remain to be verified.

## Brand Commitments

Retain the established JobPilot frontend identity and English interface copy.
