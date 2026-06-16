import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { HypertensionGapSection } from './HypertensionGapSection';
import { SpecialtyCategorySelect } from './SpecialtyCategorySelect';
import { DEFAULT_ANALYTICS_SPECIALTY } from './analyticsConstants';
import { buildScenarioDistrictUrl, type DistrictSelection } from '../../lib/scenario-navigation';

export function AnalyticsPage() {
  const navigate = useNavigate();
  const [specialtyCategory, setSpecialtyCategory] = useState(DEFAULT_ANALYTICS_SPECIALTY);

  const handleDistrictClick = useCallback(
    (district: DistrictSelection) => {
      navigate(buildScenarioDistrictUrl(district, { specialtyCategory }));
    },
    [navigate, specialtyCategory],
  );

  return (
    <div className="space-y-10 w-full max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Analytics</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Cleaned facility metrics from{' '}
          <code className="text-xs">dais_2026.hackathon.facility</code>.
        </p>
      </div>

      <SpecialtyCategorySelect
        value={specialtyCategory}
        onValueChange={setSpecialtyCategory}
      />

      <HypertensionGapSection
        specialtyCategory={specialtyCategory}
        onDistrictClick={handleDistrictClick}
      />
    </div>
  );
}
