/** Remove markdown wrappers (*, **, __, *__…__*) from specialty codes. */
export function cleanSpecialtyMarkup(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.replace(/^[*_]+/, '').replace(/[*_]+$/, '');
}
