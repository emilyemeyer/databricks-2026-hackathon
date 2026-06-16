/** Sentinel passed to SQL when aggregating across every mapped specialty category. */
export const ALL_SPECIALTY_CATEGORIES = 'ALL';

/** Default view: all mapped categories combined. */
export const DEFAULT_ANALYTICS_SPECIALTY = ALL_SPECIALTY_CATEGORIES;

export function isAllSpecialtyCategories(value: string): boolean {
  return value === ALL_SPECIALTY_CATEGORIES;
}

export function specialtyCategoryLabel(value: string): string {
  return isAllSpecialtyCategories(value) ? 'All categories' : value;
}
