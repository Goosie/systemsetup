// Feature flags — zet een feature uit door false te maken.
// CLI kill switch: node scripts/toggle-feature.mjs <naam> false
// Daarna wordt de app automatisch herbouwd en is de feature verdwenen.
export const features = {
  donationButton: true,
  nostrVoting: true,
  nostrLogin: true,
} as const

export type FeatureKey = keyof typeof features
export const isEnabled = (f: FeatureKey): boolean => features[f]
