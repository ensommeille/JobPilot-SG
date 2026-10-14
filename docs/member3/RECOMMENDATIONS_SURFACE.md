# Recommendations inside job discovery

## Direction contract

THESIS: Help users choose which job to inspect next using explicit skill evidence,
not a suitability percentage. Operate mode, a scoped addition to the jobs list.

OWN-WORLD: Inherit JobPilot typography, teal actions, neutral surfaces and spacing.
Use a single section with divided job rows and expandable evidence, not nested cards.

STORY: Maintain saved skills, request suggestions with optional session filters,
inspect reasons and uncertainty, then open the existing detail and application flow.

FIRST VIEWPORT: Below Discover jobs, show For you, the scope note, compact optional
filters, Find jobs for me and a profile link. General browsing remains below,
explicitly separate from recommendation filters.

FORM: Code-led local extension of the established surface; no new identity,
concept tournament or raster assets. Paired evidence is the signature interaction.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

No global DESIGN.md exists; preserve the incumbent system and record scoped review.

## Documentation verification

Verified against `PRODUCT.md`, `frontend/src/index.css`,
`frontend/src/components/JobRecommendations.tsx`, its companion CSS, and
`frontend/src/pages/JobListPage.tsx`. This is an ordinary extension of the existing
JobPilot interface; the global stylesheet remains the visual source of truth.
The preexisting absence of root `DESIGN.md` is recorded, not repaired by this
scoped task. No global design document or `.impeccable/design.json` sidecar is
introduced.

The surface inherits Plus Jakarta Sans and the existing heading hierarchy, teal
actions (`--primary`), white surfaces, neutral borders and muted text. It reuses
the shared input and primary-button treatments, spacing tokens, and large/small
corner radii. The preliminary notice uses the existing warning-soft token;
recommendations introduce no replacement palette, type scale, or shadow system.

Local CSS supplies a single bordered section, divided result rows, readable
evidence paragraphs, and native expandable disclosures pairing job-description
evidence with profile evidence. The three optional filter fields become one
column at 700px; actions wrap, long text can break, and navigation wrapping is
limited to the job-discovery page. Focus outlines, placeholder contrast, caret
color, and selection color are scoped to the recommendations surface and use
inherited tokens. The existing browsing controls remain below a distinct
"Browse all jobs" heading.

Visual evidence: `output/recommendations-desktop.png` (1440px wide) and
`output/recommendations-mobile.png` (390px wide) show the ready state with a
fictional test job and expanded supported/unknown evidence. Both captures retain
the existing identity and show legible filters, qualification caveats, evidence,
and the link into the existing job-detail flow without visible horizontal
clipping. These captures document the demonstrated state, not every request or
error state. The independent scoped UI review disposition is **ship**, with no
material issues reported.

No shipping raster assets were added: the interface is rendered from code and
existing styles. The two PNGs are verification evidence, not product imagery.

## Natural-language evidence refinement (2026-10-14)

The existing identity and CSS are unchanged. The scope note now explains named
tool/domain overlap, and the evidence disclosures separate exact skill entries,
partial overlaps with unverified conditions, explicit gaps and remaining unknowns.
Partial facts render once even though the API retains them in unknown for compatibility.
Model-labelled priorities are clearly unverified and excluded from ordering;
general traits are explicitly not ranked. Empty states do not fabricate suggestions.

Impeccable clarify/operate guided this narrow copy and grouping change, not a
redesign. Final desktop/mobile layout evidence is in
output/natural-recommendations-desktop.png and output/natural-recommendations-mobile.png.
They use a labelled fictional finance job and synthetic evidence; they demonstrate
layout, not recommendation accuracy. Independent finish review: **ship**, no
material scoped issues. Existing typography, focus treatment and wrapping remain
intact. No shipping raster or global design-system change was introduced.
