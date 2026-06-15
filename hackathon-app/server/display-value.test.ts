import { describe, expect, it } from 'vitest';
import { parseJsonRecord, toRawString, toSpecialtyDisplayString } from '../client/src/lib/display-value';

describe('parseJsonRecord', () => {
  it('preserves facility_id markup characters', () => {
    const payload = parseJsonRecord(
      JSON.stringify({
        facility_id: '*  __Hematology',
        field_name: 'specialties_raw',
        current_value: '',
      }),
    );
    expect(payload.facility_id).toBe('*  __Hematology');
  });
});

describe('toSpecialtyDisplayString', () => {
  it('strips specialty wrappers without touching facility ids', () => {
    expect(toSpecialtyDisplayString('*__hematology__*')).toBe('hematology');
    expect(toRawString('*  __Hematology')).toBe('*  __Hematology');
  });
});
