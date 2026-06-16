import { cleanSpecialtyMarkup } from '../../../shared/specialty-clean';

/** Coerce warehouse / JSON values to safe React-renderable strings (no specialty cleanup). */
export function toRawString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 1) {
      const [key, nested] = entries[0];
      if (typeof nested === 'string' && nested.trim()) return nested;
      return key;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Display helper for specialty codes (strips markdown wrappers like *__foo__). */
export function toSpecialtyDisplayString(value: unknown): string {
  return cleanSpecialtyMarkup(toRawString(value));
}

/** @deprecated Prefer toRawString or toSpecialtyDisplayString for clarity. */
export function toDisplayString(value: unknown): string {
  return toRawString(value);
}

/** Skip values that are JSON blobs, not real specialty codes. */
export function isRenderableSpecialtyCode(value: string): boolean {
  const trimmed = toSpecialtyDisplayString(value);
  if (!trimmed) return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  return true;
}

export function parseJsonRecord(value: unknown): Record<string, string> {
  if (value == null) return {};

  let raw: Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  } else if (typeof value === 'object') {
    raw = value as Record<string, unknown>;
  } else {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw).map(([key, nested]) => [key, toRawString(nested)]),
  );
}
