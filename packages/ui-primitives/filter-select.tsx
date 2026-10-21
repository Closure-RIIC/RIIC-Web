"use client";

import { useState, type ComponentProps } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "./combobox";
import { cn } from "./utils";

export type FilterOption = { value: string | number; label: string; disabled?: boolean };
export type FilterSelectProps = Pick<ComponentProps<"input">, "id" | "aria-label" | "aria-describedby" | "placeholder" | "disabled" | "name"> & {
  options: FilterOption[];
  value: string | number;
  onValueChange: (value: string) => void;
  className?: string;
  emptyText?: string;
};

/** Searchable single selection, using the same primitive as Skland account switching. */
export function FilterSelect({ options, value, onValueChange, className, emptyText = "没有匹配选项", disabled, name, ...inputProps }: FilterSelectProps) {
  const [query, setQuery] = useState<string | null>(null);
  const selected = options.find(option => String(option.value) === String(value)) ?? null;
  const filtered = query === null ? options : options.filter(option => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <Combobox
    items={options}
    filteredItems={filtered}
    value={selected}
    inputValue={query ?? selected?.label ?? ""}
    itemToStringLabel={option => option.label}
    itemToStringValue={option => String(option.value)}
    isItemEqualToValue={(option, current) => String(option.value) === String(current.value)}
    disabled={disabled}
    name={name}
    autoHighlight
    onInputValueChange={setQuery}
    onOpenChange={open => { if (!open) setQuery(null); }}
    onValueChange={option => {
      if (option && !option.disabled) {
        setQuery(null);
        if (String(option.value) !== String(value)) onValueChange(String(option.value));
      }
    }}
  >
    <ComboboxInput {...inputProps} disabled={disabled} data-filter-select className={cn("h-9 w-full min-w-0 bg-background max-sm:min-h-11", className)} />
    <ComboboxContent>
      <ComboboxEmpty>{emptyText}</ComboboxEmpty>
      <ComboboxList>{(option: FilterOption) => <ComboboxItem key={option.value} value={option} disabled={option.disabled}>{option.label}</ComboboxItem>}</ComboboxList>
    </ComboboxContent>
  </Combobox>;
}
