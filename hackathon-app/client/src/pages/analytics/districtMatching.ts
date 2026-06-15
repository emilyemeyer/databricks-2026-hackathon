type GeoJsonFeature = {
  type: 'Feature';
  properties: Record<string, string>;
  geometry: unknown;
};

export type GeoJsonCollection = {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
};

const STATE_ALIASES: Record<string, string> = {
  DELHI: 'NCT OF DELHI',
  'NCT OF DELHI': 'NCT OF DELHI',
  MAHARASHTRA: 'MAHARASHTRA',
  MAHARastra: 'MAHARASHTRA',
  'JAMMU & KASHMIR': 'JAMMU & KASHMIR',
  'JAMMU AND KASHMIR': 'JAMMU & KASHMIR',
  'ANDAMAN & NICOBAR ISLANDS': 'ANDAMAN & NICOBAR ISLANDS',
  'ANDAMAN AND NICOBAR ISLANDS': 'ANDAMAN & NICOBAR ISLANDS',
  ODISHA: 'ODISHA',
  ORISSA: 'ODISHA',
  PUDUCHERRY: 'PUDUCHERRY',
  PONDICHERRY: 'PUDUCHERRY',
  CHHATTISGARH: 'CHHATTISGARH',
  CHATTISGARH: 'CHHATTISGARH',
  UTTARAKHAND: 'UTTARAKHAND',
  UTTARANCHAL: 'UTTARAKHAND',
  'DADRA & NAGAR HAVELI AND DAMAN & DIU': 'DADRA & NAGAR HAVELI AND DAMAN & DIU',
  'DADRA AND NAGAR HAVELI AND DAMAN AND DIU': 'DADRA & NAGAR HAVELI AND DAMAN & DIU',
};

/** Map NFHS / dataset spellings to the canonical keys used in the district GeoJSON. */
const DISTRICT_ALIASES: Record<string, string> = {
  FIROZPUR: 'FEROZEPUR',
  FEROZEPUR: 'FEROZEPUR',
  MUKTSAR: 'SRI MUKTSAR SAHIB',
  'SRI MUKTSAR SAHIB': 'SRI MUKTSAR SAHIB',
  'SAHIBZADA AJIT SINGH NAGAR': 'SAS NAGAR',
  'SAS NAGAR': 'SAS NAGAR',
  BANGALORE: 'BENGALURU URBAN',
  'BANGALORE URBAN': 'BENGALURU URBAN',
  'BENGALURU': 'BENGALURU URBAN',
  'BENGALURU URBAN': 'BENGALURU URBAN',
  MYSORE: 'MYSURU',
  MYSURU: 'MYSURU',
  GURGAON: 'GURUGRAM',
  GURUGRAM: 'GURUGRAM',
  ALLAHABAD: 'PRAYAGRAJ',
  PRAYAGRAJ: 'PRAYAGRAJ',
  BARODA: 'VADODARA',
  VADODARA: 'VADODARA',
};

export function normalizeStateKey(state: string): string {
  const upper = state
    .trim()
    .toUpperCase()
    .replace(/\s+AND\s+/g, ' & ')
    .replace(/\s+/g, ' ');
  return STATE_ALIASES[upper] ?? upper;
}

export function normalizeDistrictKey(district: string): string {
  const base = district
    .trim()
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');
  return DISTRICT_ALIASES[base] ?? base;
}

export function districtRegionKey(districtName: string, stateUt: string): string {
  return `${normalizeDistrictKey(districtName)}__${normalizeStateKey(stateUt)}`;
}

export function parseRegionKeyDisplay(regionKey: string): { district: string; state: string } {
  const idx = regionKey.indexOf('__');
  if (idx === -1) {
    return { district: regionKey, state: '' };
  }
  const districtPart = regionKey.slice(0, idx);
  const statePart = regionKey.slice(idx + 2);
  return {
    district: districtPart ? titleCaseLabel(districtPart) : '',
    state: statePart ? titleCaseLabel(statePart) : '',
  };
}

function titleCaseLabel(value: string): string {
  return value
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .replace(/\bNct\b/g, 'NCT')
    .replace(/\bOf\b/g, 'of');
}

export function prepareDistrictGeoJson(geoJson: GeoJsonCollection): GeoJsonCollection {
  return {
    ...geoJson,
    features: geoJson.features
      .filter((feature) => Boolean(feature.properties.district?.trim()))
      .map((feature) => {
        const district = feature.properties.district;
        const state = feature.properties.st_nm ?? '';
        return {
          ...feature,
          properties: {
            ...feature.properties,
            name: districtRegionKey(district, state),
          },
        };
      }),
  };
}
