# Public Copy Review — launch surfaces

**Mode:** audit+fix  
**Scope:** `landing/index.html`, `landing/src/main.ts`, `landing/README.md`,
`docs/launch/x-launch-package.md`  
**Audience:** developers already using multiple local coding agents  
**Date:** 2026-07-26

## Counts

| P0 | P1 | P2 | Pass (reviewed) |
| ---: | ---: | ---: | ---: |
| 0 | 3 | 0 | 54 |

### Narrative

| N-P0 | N-P1 | N-P2 |
| ---: | ---: | ---: |
| 0 | 0 | 0 |

## Post-fix status

| Unresolved P0 | Unresolved P1 | Blocked | Deferred |
| ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 |

**Surfaces scanned:** landing hero, proof, workflow, trust, support matrix,
install, install notes, FAQ, metadata, landing developer README, and the drafted
X package.  
**Controls reviewed:** header anchors, language toggle, two hero CTAs, install
download and notes CTAs, and four FAQ disclosures.

## Findings and applied rewrites

### P1-001 — Hero CTA implied an immediate download

- **Surface:** landing hero
- **Current:** `Get the private alpha`
- **User question:** What happens when I press this?
- **Issue:** The link scrolls to a signed-but-unnotarized install review; it
  does not immediately download the DMG.
- **Applied:** `Review the private alpha` /
  `프라이빗 알파 설치 확인`
- **Result:** pre-click expectation now matches the install section.

### P1-002 — Support note exposed a security implementation phrase

- **Surface:** support matrix footnote
- **Current:** permission and receipt contracts must `fail closed`
- **User question:** Why can I not run these providers yet?
- **Issue:** “Fail closed” names an engineering policy, not the condition the
  user will be able to verify.
- **Applied:** direct execution stays off until the product can show exactly
  what was authorized and return a run record the user can revisit.
- **Result:** the limitation is expressed as predictable control and evidence.

### P1-003 — Install note predicted login screens unconditionally

- **Surface:** pre-install notes
- **Current:** first run opens Codex and Claude browser logins
- **User question:** What will happen after install?
- **Issue:** already-connected users see verified status instead; unconnected
  users open one official flow by pressing `Connect subscription`.
- **Applied:** the note now states the exact conditional action and what
  Morrow checks.
- **Result:** the install promise matches the tested onboarding path.

## Narrative architecture

### Cluster map in display order

| # | Section | Job |
| ---: | --- | --- |
| 1 | Hero | pain, one install outcome, review CTA |
| 2 | Actual product flow | strongest real-UI proof |
| 3 | Bedtime briefing | four user actions |
| 4 | Quiet by design | control and predictability |
| 5 | Provider support | honest capability boundary |
| 6 | Private alpha | exact install decision |
| 7 | Install notes | blockers and next events |
| 8 | FAQ | category, authorization, data route, evidence limit |

### Click path

1. `Review the private alpha`
2. read the notarization boundary
3. `Download private alpha`
4. complete four-step onboarding
5. ask Morrow or review an overnight plan
6. receive provider receipt plus bounded workspace evidence

### Strongest proof

- **Content:** 22-second current-app cut showing Morrow Watch,
  recommendation, exact approval, and Morning Review.
- **Rank:** section 2.
- **Result:** pass; proof appears before workflow philosophy and support detail.

The page has one entry path, so no artificial two-path fork is needed. The
outcome promise appears in the hero and brand close; intermediate sections add
new evidence instead of paraphrasing it.

## Certification

**Result: PASS**

| Edit | Result | Next event | No internals | No jargon | Why press | Verb + object | Expectation matches | Auxiliary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1-001 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | CTA ✓ |
| P1-002 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Trust ✓ |
| P1-003 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Trust ✓ |

- Unresolved P0: **0**
- Unresolved P1: **0**
- Blocked P0/P1: **0**
- Scope verification: all applied edits are within the enumerated launch
  surfaces.

**Certified by:** `public-copy-review` Phase 3
