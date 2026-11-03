# System-aware appearance

Scope: QS-VC shared application appearance, startup canvas and existing route utilities. Standard MADY flow. User requested light/dark and automatic system-dark detection. The system preference is the default, resolving to light when no dark preference is available.

## Acceptance

1. System resolves on arrival before the startup canvas paints and responds to OS changes.
2. Explicit Light/Dark overrides system changes; selecting System resumes following the OS.
3. Manual choices persist only when existing optional preference storage is allowed. Denial removes the saved choice; storage failure preserves usable memory-only behavior.
4. Public, workspace, forms, reading, recordings, menus and startup surfaces use coherent theme colors. Operational meeting/video canvases retain their intentional dark presentation.
5. Icon-only Appearance controls remain reachable on public and signed-in/standalone route utilities without replacing existing navigation. Activating the native selector exposes labelled System, Light and Dark options; the accessible label and selected value remain available to assistive technology.
6. Preserve content, navy/teal identity, IBM Plex 400/500/600 roles, media, motion, signature actions and unrelated working-tree edits. No backend changes, commit or deployment.

## Evidence boundaries

Source baseline: current theme tokens reside on `.app-theme`; `.meeting-room` has a deliberate dark palette. Public/workspace CSS and startup markup contain hard-coded light colors. Root token replacement alone is insufficient.

Rendered baseline was attempted: IAB browser creation/listing reported local browser use disabled in Work settings. Existing native Chrome action required reconnection; reconnection was aborted before dispatch. No browser setting was changed and no alternative browser automation was used to bypass this restriction. Rendered evidence remains unverified unless later explicitly recorded.

Required rendered matrix: 320, 360, 390, 768, 1024, 1440 and 844 × 390 CSS pixels, both themes; focus, native selection, first paint, reload, live OS changes, reduced motion, contrast, font loading, computed weights, viewport bold-word share and screenshot squint checks. Source/unit/build checks cannot establish these results.

## Roles and methods

- Lead: integration and truthful source/local/deployed claims.
- UX Strategist: incumbent-based journey and placement, no theme onboarding.
- Engineer: shared owners and native APIs, no new dependencies (Ponytail).
- QA: independent scoped six-category audit plus H2 evidence gaps.
- Examiner: independent strategy and final judgment; Learner at completion.

Latest user request supersedes DESIGN.md's public-light-only statement for this task. The rest of the established direction is preserved. No repo AGENTS.md, docs/design/DESIGN_LEAD.md or scoped preferences file was found; no foundation checker is claimed.

## Source checks and repair batch

Engineer reported 11 tests passed: seven execute the exact shared theme bootstrap, two storage-consent checks and two CookieBanner regression checks. The production web build, JavaScript syntax check and frontend whitespace check passed before the QA repair batch. These are source/simulated-runtime evidence, not browser evidence.

QA and Lead identified three related regressions in the initial source batch: meeting primary action ink inherited pale text on a bright teal fill; portrait/caption artwork text inherited the dark page background; and pale artwork text inherited a border token below text contrast. Engineer owns one repair batch restoring the intentional local artwork inks. Confirmation and final verdict are recorded separately.

Confirmation: the Engineer restored all three local artwork ink roles and the final production web build passed. QA independently inspected the repaired selectors, confirmed the frontend whitespace check, and independently ran all eleven targeted tests successfully. Existing React Router SSR warnings and the existing bundle-size warning remain. No new dependency, backend change, commit or deployment was made.

## Scoped independent engineering audit

| Category | Result |
| --- | --- |
| Correctness | Source and exact-script VM checks passed after the three contrast repairs. |
| Security/data loss | No issue found. Optional preference storage respects consent; authentication is untouched. |
| Expected load/concurrency | Ordinary browser use; bounded page-lifetime listeners and cross-tab synchronization covered. |
| Missing tests | Eleven targeted checks passed, including system fallback/live change, explicit override, consent, blocked/corrupt storage, tab synchronization and subscription cleanup. |
| Speed | No new dependencies, polling or layout-measurement loops. No browser performance result is claimed. |
| Lean structure | One first-paint/runtime owner and a native select reused across route utilities. |

Rendered H2 acceptance remains Untested for the browser-access reason above. Final independent judgment is in examiner-verdict.md. The MADY signature is expressed through the existing product view, Plex typography and restrained navy/teal materials; this update adds no decorative moment. Its useful interaction is automatic appearance continuity from startup to page, verified only in the exact-script tests so far.

## Icon selector refinement

User requested https://collectui.com/designers/withAnimationUI as a selector reference, with only the current icon visible and the other appearances available as options. Direct web opening failed; one focused search did not expose that designer's actual control. No reference animation or geometry was observed, and no fidelity claim is made.

Quick tier: Lead → Engineer → QA → independent final Examiner → Learner. Scope is the shared ThemeSelect component and its control geometry only. Native selection preserves keyboard, touch, current-value semantics and existing preference behavior. Current preference maps to computer, sun or moon from the existing icon family; visual text is hidden while the native choices remain labelled. Target stays 44 × 44 CSS pixels, with focus/hover and reduced-motion support. Earlier theme behavior, palette, media and consent decisions remain unchanged. No deployment authorized by this refinement.
