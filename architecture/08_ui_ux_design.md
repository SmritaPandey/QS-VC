# QS-VC: UI/UX Design

---

## 1. Design System

### Brand Identity

| Element | Specification |
|---|---|
| **Primary Color** | `#0057FF` (Electric Blue) |
| **Secondary** | `#00D4AA` (Teal Accent) |
| **Dark Mode BG** | `#0D1117` → `#161B22` gradient |
| **Light Mode BG** | `#FFFFFF` → `#F6F8FA` |
| **Typography** | Inter (UI), JetBrains Mono (code/captions) |
| **Corner Radius** | 12px (cards), 8px (buttons), 24px (modals) |
| **Elevation** | Subtle shadows + glassmorphism panels |
| **Motion** | 200ms ease-out transitions, 60fps animations |
| **Iconography** | Phosphor Icons (consistent, variable weight) |

---

## 2. Meeting Interface Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ┌────────────────────────────────────────────────────────────────────────┐   │
│ │ TOP BAR                                                                │   │
│ │ [🔒 E2EE] [QS-1234-5678]  Q1 Planning Review  [🕐 00:45:23]  [≡ ⋯] │   │
│ └────────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│ ┌──────────────────────────────────────────────┐  ┌───────────────────────┐ │
│ │                                              │  │ SIDE PANEL            │ │
│ │                                              │  │ (toggleable)          │ │
│ │            VIDEO GRID AREA                   │  │                       │ │
│ │                                              │  │ [Chat] [People]       │ │
│ │  ┌──────────┐ ┌──────────┐ ┌──────────┐     │  │ [Captions] [Q&A]     │ │
│ │  │ Alice    │ │ Bob      │ │ Carol    │     │  │ [Whiteboard]          │ │
│ │  │ (You)    │ │ 🎤 ▓▓▓▒░│ │          │     │  │                       │ │
│ │  │ 🎤 ▓▓▒░ │ │          │ │          │     │  │ ┌───────────────────┐ │ │
│ │  └──────────┘ └──────────┘ └──────────┘     │  │ │ Chat Messages     │ │ │
│ │  ┌──────────┐ ┌──────────┐ ┌──────────┐     │  │ │                   │ │ │
│ │  │ Dave     │ │ Eve      │ │ Frank    │     │  │ │ Alice: Let's      │ │ │
│ │  │          │ │ 📱       │ │          │     │  │ │ discuss Q1...     │ │ │
│ │  └──────────┘ └──────────┘ └──────────┘     │  │ │                   │ │ │
│ │                                              │  │ │ Bob: Agreed,      │ │ │
│ │  LAYOUT MODES:                               │  │ │ I think we...     │ │ │
│ │  • Gallery (default): up to 49 tiles         │  │ │                   │ │ │
│ │  • Speaker: active speaker large + strip     │  │ │ [📎] [Type msg..] │ │ │
│ │  • Presentation: shared content dominant     │  │ └───────────────────┘ │ │
│ │  • Side-by-side: content + speaker           │  │                       │ │
│ │                                              │  └───────────────────────┘ │
│ │  ┌──────────────────────────────────────┐    │                            │
│ │  │ 📝 LIVE CAPTIONS                     │    │                            │
│ │  │ Alice: Let's discuss the Q1 targets  │    │                            │
│ │  │ [🌐 Hindi: Q1 लक्ष्यों पर चर्चा...]    │              │                │
│ │  └──────────────────────────────────────┘    │                            │
│ └──────────────────────────────────────────────┘                            │
│                                                                              │
│ ┌────────────────────────────────────────────────────────────────────────┐   │
│ │ CONTROL BAR                                                            │   │
│ │                                                                        │   │
│ │  [🎤 Mute] [📹 Video] [🖥️ Share] [✋ Raise] [😊 React] [⋯ More]    │   │
│ │                                                                        │   │
│ │  [🔴 Leave]        [👥 Breakout]  [⏺️ Record]  [📋 Whiteboard]       │   │
│ │                                                                        │   │
│ │  More Menu:                                                            │   │
│ │  • 🌐 Language & Translation Settings                                 │   │
│ │  • 🎨 Virtual Background                                              │   │
│ │  • 📊 Meeting Stats                                                   │   │
│ │  • ⚙️ Audio/Video Settings                                            │   │
│ │  • 📱 Companion Mode                                                  │   │
│ │  • 🔊 Speaker View / Gallery View                                     │   │
│ │  • 📝 AI Summary (request)                                            │   │
│ └────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Video Tile Design

```
┌────────────────────────────────────────┐
│                                        │
│          VIDEO FEED                    │
│                                        │
│  ┌──┐                                 │  ← Network quality indicator
│  │🟢│                                 │     (🟢🟡🔴, Zoom-style)
│  └──┘                                 │
│                                        │
│                        ┌─────────────┐ │
│                        │ 📌 Pin      │ │  ← Hover actions (fade in)
│                        │ 🔇 Mute     │ │
│                        │ 📹 Stop Vid │ │
│                        │ 🖥️ Spotlight│ │
│                        └─────────────┘ │
│                                        │
│  ▓▓▓▓▓▓▒▒▒░░░░░░░░░░░░░░░░░░░░░░░░░  │  ← Audio level meter
│  ┌──────────────────────────────────┐  │
│  │ 🎤 Alice Chen (Host)            │  │  ← Name badge + role
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

---

## 4. Pre-Meeting Experience

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                  ┌─────────────────────────┐                     │
│                  │                         │                     │
│                  │    CAMERA PREVIEW       │                     │
│                  │    (with effects)       │                     │
│                  │                         │                     │
│                  │   [ Blur BG ] [ Image ] │                     │
│                  │                         │                     │
│                  └─────────────────────────┘                     │
│                                                                  │
│         🎤 Microphone: [Built-in ▾]    🔊 Speaker: [Default ▾] │
│         📹 Camera: [Logitech C920 ▾]                            │
│                                                                  │
│         [Test Speaker]  [Test Mic]                               │
│                                                                  │
│         ┌─────────────────────────────┐                          │
│         │ 🌐 Caption Language: [English ▾]                       │
│         │ 🔊 Hear in: [English ▾]                                │
│         │ ✅ Enable AI Captions                                  │
│         │ ✅ Enable Translation                                  │
│         └─────────────────────────────┘                          │
│                                                                  │
│        ┌──────────────┐  ┌──────────────┐                       │
│        │  🎤 Join with │  │  🔇 Join     │                       │
│        │     Audio     │  │   Muted      │                       │
│        └──────────────┘  └──────────────┘                       │
│                                                                  │
│  Meeting: Q1 Planning Review                                     │
│  Host: Alice Chen | 3 participants waiting                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Admin Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ┌─────────────┐                                                            │
│ │ QS-VC Admin │    [🏠 Overview] [👥 Users] [📊 Analytics] [⚙️ Settings]  │
│ └─────────────┘    [🔐 Security] [📋 Audit] [💳 Licenses]                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Active   │  │ Online   │  │ Avg. MOS │  │ AI Usage │  │ Storage      │ │
│  │ Meetings │  │ Users    │  │ Score    │  │ (STT)    │  │ Used         │ │
│  │   127    │  │  2,341   │  │   4.3    │  │   78%    │  │  2.3 TB      │ │
│  │ ↑ 12%    │  │ ↑ 5%     │  │ ↑ 0.1   │  │ ↑ 15%   │  │  of 10 TB    │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────────┘ │
│                                                                             │
│  ┌────────────────────────────┐  ┌──────────────────────────────────────┐  │
│  │ 🗺️ GLOBAL MEETING MAP      │  │ 📈 QUALITY TRENDS (30 days)         │  │
│  │                            │  │                                      │  │
│  │   [World map with live     │  │   MOS ─────────────                  │  │
│  │    meeting dots, sized     │  │        4.5 ┤      ╱ ╲               │  │
│  │    by participant count]   │  │        4.0 ┤─────╱───╲────          │  │
│  │                            │  │        3.5 ┤                         │  │
│  │   🟢 Mumbai: 45 meetings  │  │            └──────────────►          │  │
│  │   🟢 Delhi: 23 meetings   │  │   Bandwidth ─────────────           │  │
│  │   🟡 US-East: 15 meetings │  │                                      │  │
│  └────────────────────────────┘  └──────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 🖥️ SFU NODE HEALTH                                                  │  │
│  │                                                                      │  │
│  │  Node           Region    CPU   BW    Rooms  Status                 │  │
│  │  sfu-mum-01     Mumbai    45%   62%   38     🟢 Healthy            │  │
│  │  sfu-mum-02     Mumbai    72%   81%   52     🟡 High Load          │  │
│  │  sfu-che-01     Chennai   23%   30%   15     🟢 Healthy            │  │
│  │  sfu-del-01     Delhi     55%   48%   28     🟢 Healthy            │  │
│  │  sfu-use-01     US-East   38%   45%   22     🟢 Healthy            │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Mobile App Layout

```
┌──────────────────────────┐
│ ┌──────────────────────┐ │
│ │ 🔒 Q1 Planning 00:23 │ │  ← Compact top bar
│ └──────────────────────┘ │
│                          │
│ ┌──────────────────────┐ │
│ │                      │ │
│ │   ACTIVE SPEAKER     │ │  ← Full-width main video
│ │   (large)            │ │
│ │                      │ │
│ │                      │ │
│ └──────────────────────┘ │
│                          │
│ ┌────┐ ┌────┐ ┌────┐    │  ← Thumbnail strip (scrollable)
│ │Bob │ │Eve │ │Dan │ ►  │
│ └────┘ └────┘ └────┘    │
│                          │
│ ┌──────────────────────┐ │
│ │ 📝 Captions here...  │ │  ← Live captions overlay
│ └──────────────────────┘ │
│                          │
│ ┌──────────────────────┐ │
│ │ 🎤  📹  🖥️  ✋  ⋯   │ │  ← Floating control bar
│ │       [🔴 Leave]     │ │
│ └──────────────────────┘ │
└──────────────────────────┘

Gestures:
• Swipe up: open chat panel
• Swipe left/right: switch views
• Double tap: pin/unpin speaker
• Pinch: zoom on shared content
```

---

## 7. Room System UI (Touch Panel)

```
┌──────────────────────────────────────────────┐
│  QS-VC Room System                            │
│──────────────────────────────────────────────│
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │                                        │  │
│  │    ROOM DISPLAY (main screen)          │  │
│  │    • Shows gallery / active speaker    │  │
│  │    • 4K output to room display         │  │
│  │    • Shows captions at bottom          │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Touch Panel (10" tablet):                   │
│  ┌────────────────────────────────────────┐  │
│  │  [Next Meeting: Q1 Review @ 10:00 AM] │  │
│  │        ┌──────────────────┐            │  │
│  │        │  📞 Join Meeting │            │  │
│  │        └──────────────────┘            │  │
│  │  [Schedule] [Share Screen] [Settings]  │  │
│  │  [Camera: PTZ Controls]               │  │
│  │  [🎤 Room Mic: Active]                │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

---

## 8. Accessibility (WCAG 2.2 AA)

| Feature | Implementation |
|---|---|
| **Screen Reader** | Full ARIA labels, live regions for captions |
| **Keyboard Nav** | All controls keyboard-accessible, focus indicators |
| **High Contrast** | System high-contrast mode support |
| **Caption Sizing** | Adjustable font size (S/M/L/XL) |
| **Color Blind** | No color-only information, pattern differentiation |
| **Motor** | Large touch targets (48px min), voice commands |
| **Cognitive** | Simple layouts, consistent navigation, minimize cognitive load |
