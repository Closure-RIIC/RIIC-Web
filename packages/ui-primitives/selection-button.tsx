"use client";

import type { ComponentProps } from "react";
import { Button } from "./button";

export function SelectionButton({ selected, onSelectedChange, ...props }: Omit<ComponentProps<typeof Button>, "aria-pressed" | "onClick"> & {
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  return <Button type="button" variant={selected ? "default" : "outline"} {...props}
    data-selection-button aria-pressed={selected} onClick={() => onSelectedChange(!selected)} />;
}
