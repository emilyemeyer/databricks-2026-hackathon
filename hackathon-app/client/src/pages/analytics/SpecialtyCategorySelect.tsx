import { useState } from 'react';
import { Check, ChevronsUpDown, Layers2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import { cn } from '../../lib/utils';
import {
  ALL_SPECIALTY_CATEGORIES,
  DEFAULT_ANALYTICS_SPECIALTY,
  isAllSpecialtyCategories,
  specialtyCategoryLabel,
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
  const [open, setOpen] = useState(false);
  const { data, loading, error } = useAnalyticsQuery('specialty_categories');

  const categories = (data ?? [])
    .map((row) => row.specialty_category)
    .filter((category): category is string => Boolean(category?.trim()));

  const resolvedValue =
    value || (categories.length > 0 ? ALL_SPECIALTY_CATEGORIES : DEFAULT_ANALYTICS_SPECIALTY);
  const viewingAll = isAllSpecialtyCategories(resolvedValue);
  const selectedLabel = specialtyCategoryLabel(resolvedValue);

  const handleSelect = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
  };

  return (
    <Card className={cn('shadow-sm border-border/60', className)}>
      <CardContent className="p-4 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Layers2 className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">Specialty category</h3>
                {!loading && !error && (
                  <Badge variant="secondary" className="font-normal">
                    {categories.length} mapped
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Choose which specialty area drives demand and supply on this page.
              </p>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[18rem] lg:items-end">
            {loading ? (
              <Skeleton className="h-10 w-full sm:w-72" />
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="analytics-specialty-category"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    aria-label="Select specialty category"
                    className={cn(
                      'h-10 w-full justify-between gap-2 sm:w-72',
                      viewingAll && 'border-primary/30 bg-primary/5',
                    )}
                  >
                    <span className="truncate text-left font-medium">{selectedLabel}</span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(100vw-2rem,20rem)] p-0" align="end">
                  <Command>
                    <CommandInput placeholder="Search categories…" />
                    <CommandList>
                      <CommandEmpty>No category found.</CommandEmpty>
                      <CommandGroup heading="Overview">
                        <CommandItem
                          value="all categories overview"
                          onSelect={() => handleSelect(ALL_SPECIALTY_CATEGORIES)}
                          className="gap-2"
                        >
                          <Check
                            className={cn(
                              'h-4 w-4 shrink-0',
                              viewingAll ? 'opacity-100 text-primary' : 'opacity-0',
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">All categories</p>
                            <p className="text-xs text-muted-foreground">
                              Combined demand and supply across every mapped specialty
                            </p>
                          </div>
                        </CommandItem>
                      </CommandGroup>
                      {categories.length > 0 && (
                        <>
                          <CommandSeparator />
                          <CommandGroup heading="Single specialty">
                            {categories.map((category) => {
                              const isSelected = resolvedValue === category;
                              return (
                                <CommandItem
                                  key={category}
                                  value={category}
                                  onSelect={() => handleSelect(category)}
                                  className="gap-2"
                                >
                                  <Check
                                    className={cn(
                                      'h-4 w-4 shrink-0',
                                      isSelected ? 'opacity-100 text-primary' : 'opacity-0',
                                    )}
                                  />
                                  <span className="truncate">{category}</span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
            {!loading && !error && (
              <p className="text-xs text-muted-foreground lg:text-right">
                Viewing <span className="font-medium text-foreground">{selectedLabel}</span>
              </p>
            )}
          </div>
        </div>

        {!loading && !error && (
          <div className="mt-4 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            {viewingAll ? (
              <>
                <span className="font-medium text-foreground">All categories</span> averages every
                mapped NFHS indicator for demand and counts facilities with any mapped specialty
                for supply. Pick a single category to slice both metrics to one specialty area.
              </>
            ) : (
              <>
                Demand uses NFHS indicators from{' '}
                <code className="rounded bg-background px-1 py-0.5 text-[11px]">health_indicator</code>{' '}
                mapped via{' '}
                <code className="rounded bg-background px-1 py-0.5 text-[11px]">
                  health_indicator_specialty
                </code>
                . Supply counts facilities whose specialties map to{' '}
                <span className="font-medium text-foreground">{selectedLabel}</span> in{' '}
                <code className="rounded bg-background px-1 py-0.5 text-[11px]">
                  specialty_category_mapping
                </code>
                .
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
