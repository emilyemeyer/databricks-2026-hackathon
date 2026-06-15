export type ScenarioFacilityInput = {
  district_name: string;
  state_ut: string;
  capability: string;
  capacity: number;
};

export type ScenarioFacility = ScenarioFacilityInput & {
  id: number;
  scenario_id: number;
  sort_order: number;
};

export type ScenarioSummary = {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  facility_count: number;
};

export type SavedScenario = {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  facilities: ScenarioFacility[];
};
