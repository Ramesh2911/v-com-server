const ApiError = require('../../utils/ApiError');

// Admin-manageable module card theme presets.
// colors.background = card banner background, colors.text = primary text on it,
// colors.accent = chip/button accent, colors.on_accent = text on accent.
const MODULE_THEME_PRESETS = {
  quick: {
    label: 'Quick',
    colors: { background: '#0F172A', text: '#FFFFFF', accent: '#FFFFFF', on_accent: '#0F172A' },
  },
  special: {
    label: 'Special',
    colors: { background: '#DBEAFE', text: '#0F172A', accent: '#0F172A', on_accent: '#FFFFFF' },
  },
  professional: {
    label: 'Professional',
    colors: { background: '#FFFFFF', text: '#1F2937', accent: '#FFF3D6', on_accent: '#1F2937' },
  },
};

// '' / null / undefined → null (clears theme, app falls back to default gradient)
function normalizeTheme(value) {
  if (value === undefined) return undefined; // field not provided → caller keeps existing
  if (value === null || value === '') return null;
  const v = String(value).trim().toLowerCase();
  if (!MODULE_THEME_PRESETS[v]) {
    throw ApiError.badRequest(`Invalid theme — allowed: ${Object.keys(MODULE_THEME_PRESETS).join(', ')}`);
  }
  return v;
}

function themeColors(theme) {
  return theme && MODULE_THEME_PRESETS[theme] ? MODULE_THEME_PRESETS[theme].colors : null;
}

// attach resolved colors to a module row
function withTheme(row) {
  return { ...row, colors: themeColors(row.theme) };
}

module.exports = { MODULE_THEME_PRESETS, normalizeTheme, themeColors, withTheme };
