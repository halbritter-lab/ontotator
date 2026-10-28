# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Curators and annotators** annotate clinical texts with ontology terms (HPO and others), often for hours at a time, on desktop screens.
- **Adjudicators** compare and decide between independent annotations of the same text.
- **Project leads** set up projects, work packages and assignments and follow progress.

All of them read carefully and decide term by term. Mistakes matter: an annotation states a clinical finding about a patient.

## Product Purpose

Ontotator is a self-hosted, multi-user web service for annotating and reviewing ontology concepts (such as the Human Phenotype Ontology, MONDO and other OBO ontologies) on clinical text documents. It supports independent annotation, origin-neutral review of proposals from people or tools, and the extraction of results for scientific use. Success means correct, traceable annotations produced without fatigue or avoidable slips.

## Positioning

The clinical text is the primary object; controls support it. Review treats human proposals and machine predictions identically, keeps their provenance visible, and never leaks proposals into independent annotation.

## Operating Context

- Long sessions at a desktop screen; reading the text closely, marking evidence spans, searching terms, deciding proposals one by one.
- Keyboard use is common (review decisions, case navigation, shortcuts).
- Runs in offline and closed networks: no request may leave the app's origin (no CDN, no external fonts).
- Surfaces: login, dashboard ("My tasks"), the editor (reading), admin and workflow pages (compact).

## Capabilities and Constraints

- React 18 single-page app with plain CSS and no UI library; FastAPI backend serves the built UI.
- English UI only.
- Light theme only.
- Ontologies, documents and annotations are pinned and hashed; Unicode codepoint offsets are exact.
- Clinical texts come in several languages (de, en, es, fr, nl, pl, pt) and contain symbols such as µ, ±, ≥ and Greek letters.

## Evidence on Hand

- Synthetic test packages and ontology fixtures under `tests/fixtures/` and `tests/browser_server.py`. There are no real patient texts, customer names or testimonials in the repository; future work must not invent them.

## Product Principles

1. The text comes first: nothing may move, hide or crowd the clinical text while it is being read or marked.
2. Every decision is explicit and traceable; nothing is decided silently.
3. Meaning never depends on colour alone.
4. Calm over clever: an interface used for hours must not tire.

## Accessibility & Inclusion

WCAG 2.2 AA. Functional text is at least 12 px. Mark states must stay distinguishable under colour-vision deficiencies. Full keyboard operation of the editor.
