---
name: Botanical Paper Studio
colors:
  surface: '#faf9f5'
  surface-dim: '#dbdad6'
  surface-bright: '#faf9f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f4f0'
  surface-container: '#efeeea'
  surface-container-high: '#e9e8e4'
  surface-container-highest: '#e3e2df'
  on-surface: '#1b1c1a'
  on-surface-variant: '#44483e'
  inverse-surface: '#2f312e'
  inverse-on-surface: '#f2f1ed'
  outline: '#74796d'
  outline-variant: '#c4c8bb'
  surface-tint: '#4b6638'
  primary: '#415b2f'
  on-primary: '#ffffff'
  primary-container: '#597445'
  on-primary-container: '#d9f9be'
  inverse-primary: '#b1d098'
  secondary: '#516440'
  on-secondary: '#ffffff'
  secondary-container: '#d3eabc'
  on-secondary-container: '#576a45'
  tertiary: '#4e5749'
  on-tertiary: '#ffffff'
  tertiary-container: '#666f60'
  on-tertiary-container: '#e9f2e0'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cdecb3'
  primary-fixed-dim: '#b1d098'
  on-primary-fixed: '#0a2000'
  on-primary-fixed-variant: '#344d23'
  secondary-fixed: '#d3eabc'
  secondary-fixed-dim: '#b8cea1'
  on-secondary-fixed: '#0f2004'
  on-secondary-fixed-variant: '#3a4c2a'
  tertiary-fixed: '#dce5d3'
  tertiary-fixed-dim: '#c0c9b8'
  on-tertiary-fixed: '#161e13'
  on-tertiary-fixed-variant: '#41493c'
  background: '#faf9f5'
  on-background: '#1b1c1a'
  surface-variant: '#e3e2df'
typography:
  display-lg:
    fontFamily: Outfit
    fontSize: 48px
    fontWeight: '600'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Outfit
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Outfit
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Outfit
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Outfit
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 26px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  meta-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  meta-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  space-2xs: 0.25rem
  space-xs: 0.5rem
  space-sm: 0.75rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
  gutter-canvas: 1.5rem
  sidebar-width: 22rem
  toolbar-height: 3.5rem
---

## Brand & Style
The design system embodies an organic, tactile, and tranquil atmosphere tailored for generative AI creators, illustrators, and visual designers. Rejecting the dark neon and hyper-technological aesthetic common to modern AI tools, it approaches digital synthesis like an artisanal atelier: rooted in physical craft, patience, and natural inspiration.

The visual style blends **Modern Organic Minimalism** with **Warm Paper Tactility**. Surfaces evoke heavy, uncoated fine-art paper sheets laid upon a clean studio desk. The emotional tone is deliberate, calming, and deeply focused, designed to reduce cognitive exhaustion during long creative sessions.

## Colors
The palette is built upon a warm, eye-friendly paper base that minimizes eye fatigue while maintaining high legibility and color accuracy for canvas previews.

- **Primary (`#597445`)**: Earthy botanical moss green. Used for key interactive drivers, primary action buttons, active generation states, and focal indicators.
- **Secondary (`#8A9F76`)**: Soft sage green. Applied to secondary controls, selected toggle states, and supporting accents.
- **Tertiary (`#DCE5D3`)**: Muted leaf tint. Used for badge fills, light interactive highlights, and soft focus states.
- **Neutral Canvas (`#FDFCF8`)**: Unbleached warm art paper. Serves as the global backdrop and root workspace canvas.
- **Neutral Surface Elevated (`#F7F5EE`)**: Subtle warm step up for floating panels, toolbars, and input containers.
- **Text & Borders**: Primary text resolves to deep organic charcoal (`#2A2F28`), secondary/muted labels to olive-leaf gray (`#798A6F`), and borders maintain a delicate vegetative framing (`rgba(89, 116, 69, 0.36)`).

## Typography
The system employs a three-tier typographic hierarchy balancing personality, legibility, and technical precision:

1. **Outfit (Headlines & Titles)**: Provides geometric clarity with gentle curved terminations that harmonize with botanical forms without distracting from visual canvas content.
2. **Inter (UI & Body Copy)**: Provides neutral, effortless readability across prompt fields, parameter labels, and contextual settings.
3. **JetBrains Mono (Metadata & Technical Data)**: Manages generative seed numbers, aspect ratios, model checkpoints, processing times, and dimension readouts.

## Layout & Spacing
The layout follows a flexible multi-pane studio layout centered around an unbounded creative canvas.

- **Desktop (1280px+)**: Tri-pane structure with an anchored navigation/preset drawer (64px collapsed / 240px expanded), central infinite viewport, and a right-docked parameter inspector (352px / `22rem`) separated by clean translucent dividers.
- **Tablet (768px - 1279px)**: Floating overlay inspector drawer; central viewport retains priority. Bottom prompt drawer anchors at the lower edge.
- **Mobile (<768px)**: Single viewport focus. Studio tools collapse into a bottom-sheet interface; prompts and output galleries switch to modal stacks.

Spacing follows an 8px baseline grid with 4px sub-increments for compact tool clusters (`space-2xs`, `space-xs`). Panels maintain a spacious `1.5rem` internal margin to evoke fine paper margins.

## Elevation & Depth
Depth relies on physical paper layering rather than heavy technological glows or stark drop shadows.

- **Base Layer**: Root canvas (`#FDFCF8`) with optional subtle SVG noise simulating pressed paper grain.
- **Surface Layer (Cards & Panels)**: Elevated paper panels at `#F7F5EE` wrapped in an organic perimeter stroke: `1px solid rgba(89, 116, 69, 0.36)`.
- **Floating Modals & Dropdowns**: Translucent paper tint with `backdrop-filter: blur(12px)` and organic, vegetal diffused drop shadow: `0 12px 36px rgba(85, 95, 75, 0.10)`.
- **Active Canvas Elements**: Focused images and active generation frames lift using a double edge: `0 0 0 1px #597445, 0 16px 40px rgba(85, 95, 75, 0.14)`.

## Shapes
The shape language uses moderate roundedness (`0.5rem` / 8px for basic inputs and buttons; `1rem` / 16px for floating palettes and studio cards). This level softens the digital interface into smooth organic paper cards without turning overly pill-like or juvenile. Micro-badges and tool tags adopt subtle 6px corner radii to maintain tight data density.

## Components

### Buttons
- **Primary**: Solid `#597445` background with `#FDFCF8` text. Subtly lifts on hover (`translateY(-1px)`) with shadow `0 4px 12px rgba(89, 116, 69, 0.25)`.
- **Secondary**: `#F7F5EE` background, `1px solid rgba(89, 116, 69, 0.36)`, text `#2A2F28`. On hover, background shifts to `#EAEFE3`.
- **Ghost**: Transparent fill, muted text `#798A6F`, transitions to `#2A2F28` with `#F2F4ED` background.

### Input Fields & Prompt Box
- Large multi-line prompt surfaces adopt a soft paper well: background `#FDFCF8`, border `1px solid rgba(89, 116, 69, 0.36)`, interior padding `1rem`. Focused state applies `border-color: #597445` alongside an ambient focus ring: `box-shadow: 0 0 0 3px rgba(89, 116, 69, 0.12)`.
- Placeholder text utilizes `#798A6F` in italicized Inter.

### Chips & Parameter Tags
- Style tags (e.g., "Botanical Sketch", "Gouache", "8K Raw") sit in compact rounded containers (radius `0.5rem`), background `#EFEFE8`, text `#2A2F28`, and dynamic dismiss/add actions. Active/selected chips fill with `#DCE5D3` and a border of `#597445`.

### Checkboxes & Radio Buttons
- Custom square-rounded boxes (4px radius) and circular radios with `border: 1.5px solid rgba(89, 116, 69, 0.5)`. Checked state transitions seamlessly to solid `#597445` with crisp `#FDFCF8` botanical checkmarks.

### Cards & Canvas Viewport Frames
- Asset tiles feature a paper-matte frame with `1px solid rgba(89, 116, 69, 0.20)` and an inner matte margin of 8px around generated images. Metadata tags underneath feature JetBrains Mono in muted green (`#798A6F`).

### Sliders (CFG Scale, Steps, Denoising)
- Minimalist grooved track (`4px` height) colored `#E2E7DC`. Active progress fill in `#597445`. Thumb is an organic circular pebble (16px) with a soft shadow `0 2px 6px rgba(85, 95, 75, 0.20)`.