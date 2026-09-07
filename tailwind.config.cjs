/** Compile the original Stitch utility vocabulary for every React page. */
module.exports = {
  "darkMode": "class",
  "theme": {
    "extend": {
      "colors": {
        "background": "rgb(var(--sc-background) / <alpha-value>)",
        "primary-fixed": "rgb(var(--sc-primary-fixed) / <alpha-value>)",
        "secondary-fixed": "rgb(var(--sc-secondary-fixed) / <alpha-value>)",
        "on-surface-variant": "rgb(var(--sc-on-surface-variant) / <alpha-value>)",
        "error-container": "rgb(var(--sc-error-container) / <alpha-value>)",
        "inverse-on-surface": "rgb(var(--sc-inverse-on-surface) / <alpha-value>)",
        "tertiary-fixed-dim": "rgb(var(--sc-tertiary-fixed-dim) / <alpha-value>)",
        "secondary-container": "rgb(var(--sc-secondary-container) / <alpha-value>)",
        "secondary-fixed-dim": "rgb(var(--sc-secondary-fixed-dim) / <alpha-value>)",
        "outline": "rgb(var(--sc-outline) / <alpha-value>)",
        "on-background": "rgb(var(--sc-on-background) / <alpha-value>)",
        "outline-variant": "rgb(var(--sc-outline-variant) / <alpha-value>)",
        "on-tertiary": "rgb(var(--sc-on-tertiary) / <alpha-value>)",
        "surface-tint": "rgb(var(--sc-surface-tint) / <alpha-value>)",
        "on-primary-container": "rgb(var(--sc-on-primary-container) / <alpha-value>)",
        "surface-bright": "rgb(var(--sc-surface-bright) / <alpha-value>)",
        "primary-container": "rgb(var(--sc-primary-container) / <alpha-value>)",
        "tertiary-container": "rgb(var(--sc-tertiary-container) / <alpha-value>)",
        "surface": "rgb(var(--sc-surface) / <alpha-value>)",
        "tertiary": "rgb(var(--sc-tertiary) / <alpha-value>)",
        "on-surface": "rgb(var(--sc-on-surface) / <alpha-value>)",
        "surface-container-lowest": "rgb(var(--sc-surface-container-lowest) / <alpha-value>)",
        "on-error-container": "rgb(var(--sc-on-error-container) / <alpha-value>)",
        "surface-container-high": "rgb(var(--sc-surface-container-high) / <alpha-value>)",
        "on-primary-fixed": "rgb(var(--sc-on-primary-fixed) / <alpha-value>)",
        "surface-dim": "rgb(var(--sc-surface-dim) / <alpha-value>)",
        "secondary": "rgb(var(--sc-secondary) / <alpha-value>)",
        "on-secondary-container": "rgb(var(--sc-on-secondary-container) / <alpha-value>)",
        "on-tertiary-fixed-variant": "rgb(var(--sc-on-tertiary-fixed-variant) / <alpha-value>)",
        "on-error": "rgb(var(--sc-on-error) / <alpha-value>)",
        "on-tertiary-container": "rgb(var(--sc-on-tertiary-container) / <alpha-value>)",
        "surface-variant": "rgb(var(--sc-surface-variant) / <alpha-value>)",
        "on-primary": "rgb(var(--sc-on-primary) / <alpha-value>)",
        "on-primary-fixed-variant": "rgb(var(--sc-on-primary-fixed-variant) / <alpha-value>)",
        "inverse-primary": "rgb(var(--sc-inverse-primary) / <alpha-value>)",
        "surface-container-highest": "rgb(var(--sc-surface-container-highest) / <alpha-value>)",
        "surface-container-low": "rgb(var(--sc-surface-container-low) / <alpha-value>)",
        "error": "rgb(var(--sc-error) / <alpha-value>)",
        "on-secondary-fixed-variant": "rgb(var(--sc-on-secondary-fixed-variant) / <alpha-value>)",
        "on-secondary": "rgb(var(--sc-on-secondary) / <alpha-value>)",
        "tertiary-fixed": "rgb(var(--sc-tertiary-fixed) / <alpha-value>)",
        "on-secondary-fixed": "rgb(var(--sc-on-secondary-fixed) / <alpha-value>)",
        "primary": "rgb(var(--sc-primary) / <alpha-value>)",
        "inverse-surface": "rgb(var(--sc-inverse-surface) / <alpha-value>)",
        "on-tertiary-fixed": "rgb(var(--sc-on-tertiary-fixed) / <alpha-value>)",
        "primary-fixed-dim": "rgb(var(--sc-primary-fixed-dim) / <alpha-value>)",
        "surface-container": "rgb(var(--sc-surface-container) / <alpha-value>)"
      },
      "borderRadius": {
        "DEFAULT": "0.25rem",
        "lg": "0.5rem",
        "xl": "0.75rem",
        "full": "9999px"
      },
      "spacing": {
        "space-2xs": "0.25rem",
        "space-xl": "2rem",
        "space-lg": "1.5rem",
        "gutter-canvas": "1.5rem",
        "sidebar-width": "22rem",
        "space-md": "1rem",
        "toolbar-height": "3.5rem",
        "space-2xl": "3rem",
        "space-xs": "0.5rem",
        "space-sm": "0.75rem"
      },
      "fontFamily": {
        "body-sm": [
          "Inter"
        ],
        "headline-sm": [
          "Outfit"
        ],
        "body-md": [
          "Inter"
        ],
        "headline-lg": [
          "Outfit"
        ],
        "display-lg": [
          "Outfit"
        ],
        "headline-md": [
          "Outfit"
        ],
        "headline-lg-mobile": [
          "Outfit"
        ],
        "body-lg": [
          "Inter"
        ],
        "meta-md": [
          "JetBrains Mono"
        ],
        "meta-sm": [
          "JetBrains Mono"
        ]
      },
      "fontSize": {
        "body-sm": [
          "12px",
          {
            "lineHeight": "18px",
            "fontWeight": "400"
          }
        ],
        "headline-sm": [
          "18px",
          {
            "lineHeight": "26px",
            "fontWeight": "500"
          }
        ],
        "body-md": [
          "14px",
          {
            "lineHeight": "22px",
            "fontWeight": "400"
          }
        ],
        "headline-lg": [
          "32px",
          {
            "lineHeight": "40px",
            "letterSpacing": "-0.015em",
            "fontWeight": "600"
          }
        ],
        "display-lg": [
          "48px",
          {
            "lineHeight": "56px",
            "letterSpacing": "-0.02em",
            "fontWeight": "600"
          }
        ],
        "headline-md": [
          "24px",
          {
            "lineHeight": "32px",
            "letterSpacing": "-0.01em",
            "fontWeight": "500"
          }
        ],
        "headline-lg-mobile": [
          "26px",
          {
            "lineHeight": "34px",
            "letterSpacing": "-0.01em",
            "fontWeight": "600"
          }
        ],
        "body-lg": [
          "16px",
          {
            "lineHeight": "26px",
            "fontWeight": "400"
          }
        ],
        "meta-md": [
          "12px",
          {
            "lineHeight": "16px",
            "letterSpacing": "0.02em",
            "fontWeight": "500"
          }
        ],
        "meta-sm": [
          "10px",
          {
            "lineHeight": "14px",
            "letterSpacing": "0.04em",
            "fontWeight": "400"
          }
        ]
      }
    }
  },
  "content": [
    "./index.html",
    "./src/**/*.{ts,tsx}"
  ]
};
