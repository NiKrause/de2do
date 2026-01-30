# Storacha Brand Assets 🌶️

This directory contains the official Storacha brand typography and logo assets, locally bundled for optimal performance.

## Typography System

Following the Storacha Brand Guidelines, we use a three-tier font system:

### 1. **Epilogue** - Headers & Large Text
- `epilogue-400.ttf` - Regular
- `epilogue-500.ttf` - Medium
- `epilogue-600.ttf` - SemiBold
- `epilogue-700.ttf` - Bold
- **Usage**: Headlines, titles, buttons, emphasis text

### 2. **DM Sans** - Body Text
- `dm-sans-400.ttf` - Regular
- `dm-sans-500.ttf` - Medium
- `dm-sans-600.ttf` - SemiBold
- `dm-sans-700.ttf` - Bold
- **Usage**: Body text, descriptions, general UI text

### 3. **DM Mono** - Code & Small Text
- `dm-mono-400.ttf` - Regular
- `dm-mono-500.ttf` - Medium
- **Usage**: Code blocks, technical text, callouts, monospace data

## Brand Colors

All colors defined in `storacha-fonts.css` as CSS custom properties:

- **Primary Red**: `#E91315` (Red 1) - Logo, primary buttons
- **Primary Blue**: `#0176CE` (Blue 1) - Links, secondary actions
- **Primary Yellow**: `#FFC83F` (Yellow 1) - Highlights, warnings
- **Light Red**: `#EFE3F3` (Red 2) - Light backgrounds
- **Light Blue**: `#BDE0FF` (Blue 2) - Light backgrounds
- **Light Yellow**: `#FFE4AE` (Yellow 2) - Light backgrounds

## Logo

- `storacha-logo.svg` - Official Storacha rooster logo (Original, Light Mode)
- Used in both the main integration component and floating action button

## Files

- `storacha-fonts.css` - Complete font definitions and brand CSS variables
- `README.md` - This documentation

## Usage

The fonts are automatically loaded via the CSS import in `+page.svelte`:

```html
<link rel="stylesheet" href="/fonts/storacha-fonts.css" />
```

## Brand Theme: "Keep it Spicy!" 🌶️

The implementation embraces Storacha's playful, spicy personality with:
- Rooster mascot integration
- Spicy emojis throughout the UI
- "Keep it Spicy" messaging
- Hot color palette (reds, yellows)
- Proper contrast ratios for accessibility

---

*All assets comply with Storacha Brand Guidelines v1.0 (AUG 07 2024)*