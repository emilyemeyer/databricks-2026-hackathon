export type DistrictSelection = {
  district_name: string;
  state_ut: string;
};

export function buildScenarioDistrictUrl(
  district: DistrictSelection,
  options?: { specialtyCategory?: string },
): string {
  const params = new URLSearchParams({
    state_ut: district.state_ut,
    district_name: district.district_name,
  });
  if (options?.specialtyCategory) {
    params.set('specialty_category', options.specialtyCategory);
  }
  return `/scenario?${params.toString()}#add-facility`;
}
