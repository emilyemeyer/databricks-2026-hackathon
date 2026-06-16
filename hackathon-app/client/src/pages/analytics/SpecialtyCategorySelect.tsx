import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import {
  ALL_SPECIALTY_CATEGORIES,
  DEFAULT_ANALYTICS_SPECIALTY,
  isAllSpecialtyCategories,
} from './analyticsConstants';

type SpecialtyCategorySelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
};

export function SpecialtyCategorySelect({
  value,
  onValueChange,
  className,
}: SpecialtyCategorySelectProps) {
  const { data, loading, error } = useAnalyticsQuery('specialty_categories');

  const categories = (data ?? [])
    .map((row) => row.specialty_category)
    .filter((category): category is string => Boolean(category?.trim()));

  const resolvedValue =
    value || (categories.length > 0 ? ALL_SPECIALTY_CATEGORIES : DEFAULT_ANALYTICS_SPECIALTY);

  return (
    <div className={className}>
      <Label htmlFor="analytics-specialty-category" className="text-sm font-medium">
        Specialty category
      </Label>
      {loading ? (
        <Skeleton className="mt-2 h-9 w-full max-w-md" />
      ) : error ? (
        <p className="mt-2 text-sm text-destructive">{error}</p>
      ) : (
        <Select value={resolvedValue} onValueChange={onValueChange}>
          <SelectTrigger id="analytics-specialty-category" className="mt-2 max-w-md">
            <SelectValue placeholder="Select a specialty category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SPECIALTY_CATEGORIES}>All categories</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground max-w-2xl">
        {isAllSpecialtyCategories(resolvedValue) ? (
          <>
            <strong>All categories</strong> averages every mapped NFHS indicator (demand) and counts
            facilities with any mapped specialty (supply). Pick a single category to slice demand and
            supply to one specialty area.
          </>
        ) : (
          <>
            Demand uses NFHS indicators from <code className="text-xs">health_indicator</code> mapped
            via <code className="text-xs">health_indicator_specialty</code>. Supply counts
            facilities whose specialties map to the same category in{' '}
            <code className="text-xs">specialty_category_mapping</code>.
          </>
        )}
      </p>
    </div>
  );
}
