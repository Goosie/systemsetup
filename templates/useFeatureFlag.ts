import { isEnabled, type FeatureKey } from '@/config/features'

// Gebruik: const donationsEnabled = useFeatureFlag('donationButton')
// Als de flag false is, render het component gewoon niet.
export function useFeatureFlag(name: FeatureKey): boolean {
  return isEnabled(name)
}
