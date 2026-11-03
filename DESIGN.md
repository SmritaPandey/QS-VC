---
name: QS-VC public homepage
description: Existing QS-VC identity and the implemented public homepage presentation. Scope excludes operational meeting screens.
colors:
  navy: "#102A43"
  teal: "#006D77"
  canvas: "#F5F8FA"
  surface: "#FFFFFF"
  muted: "#526676"
typography:
  display:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "clamp(48px, 5.7vw, 82px)"
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: "-0.035em"
  body:
    fontFamily: "IBM Plex Sans, IBM Plex Sans Devanagari, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  input: "8px"
  plane: "16px"
  action: "999px"
spacing:
  small: "8px"
  group: "24px"
  block: "48px"
  section: "96px"
components:
  homepage-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.action}"
    height: "48px"
    width: "252px"
---

## Overview

**Creative North Star: "A clear view of the conversation."**

Scope: public homepage and the shared labelled-action component. These are descriptive implementation rules, not a release acceptance or a replacement for meeting-room styling. Navy identity, teal actions and IBM Plex remain the existing product commitments.

## Colors

Navy anchors text and the illustrative meeting. Teal identifies actions and selected caption samples. White and pale neutral surfaces define the light appearance; a navy dark appearance supports the device's dark preference. The default is System, with light as the fallback. Explicit Light and Dark choices override the device preference. The operational meeting canvas stays dark. The existing animated logo retains its approved gradient.

## Typography

Self-hosted IBM Plex Sans and Devanagari are reused. Body and metadata use 400; homepage headings and interface labels use 500; existing brand treatment uses 600. Mobile body text uses 16px. Projected scene microtext remains a known finish issue and is not a reusable typography rule.

## Layout

The homepage container reaches 1440px with fluid gutters. At widths below 1100px the introduction stacks. Feature rows stack below900px, with copy before images. Short viewports and reduced motion use the same complete static composition. No claims of physical-device coverage follow from these breakpoints.

## Elevation & Depth

The homepage uses upright product views. Four feature rows alternate visual placement on desktop and place explanatory copy before the visual on small screens. Camera rotation and perspective are removed. A soft offset shadow belongs to the scene planes. Ordinary reading sections stay flat. One-time viewport entry reveals use a28px vertical rise. Reduced motion shows the complete content without reveal travel.

## Shapes

Meeting planes use gently rounded corners. The primary homepage action is a pill; invitation fields retain discernible borders. Portrait artwork keeps its existing aspect-aware crop.

## Components

Labelled primary and secondary actions share one component and stylesheet across public pages, authentication, launcher, workspace, scheduling, preview and meeting-end actions. Their outer footprint stays stable. On hover or keyboard focus its inner label shrinks by 52px while a 48px arrow circle scales in. The arrow then slides into place. Coarse-pointer and reduced-motion rules show the revealed state without requiring hover. A visible exterior focus outline remains.

The hero caption sample is interactive and announced politely. Story scene text is illustrative, with inactive panels hidden from accessibility APIs. The existing navigation, ambient background, startup loader and static footer retain their own owners.

## Do's and Don'ts

- Do keep illustrative labels and language-availability qualifications attached to demonstrations.
- Do preserve ordinary links and readable chapter text outside camera transforms.
- Do support system-aware light and dark appearances and retain the static footer wordmark.
- Don’t promote unverified security, scale, translation quality or deployment claims from visual examples. Describe the application directly without demo framing.
- Don’t treat this incomplete finish review as accessibility certification.
