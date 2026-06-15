import { describe, expect, it } from 'vitest';
import { cleanSpecialtyMarkup } from '../shared/specialty-clean';

describe('cleanSpecialtyMarkup', () => {
  it('strips *__…__* wrappers', () => {
    expect(cleanSpecialtyMarkup('*__ophthalmology__*')).toBe('ophthalmology');
  });

  it('strips **…** wrappers', () => {
    expect(cleanSpecialtyMarkup('**cardiology**')).toBe('cardiology');
  });

  it('strips mixed markdown wrappers', () => {
    expect(cleanSpecialtyMarkup('**__pediatrics__**')).toBe('pediatrics');
    expect(cleanSpecialtyMarkup('*__**neurology**__*')).toBe('neurology');
  });

  it('leaves normal specialty codes unchanged', () => {
    expect(cleanSpecialtyMarkup('internalMedicine')).toBe('internalMedicine');
    expect(cleanSpecialtyMarkup('anesthesia_pain_management')).toBe('anesthesia_pain_management');
  });
});
