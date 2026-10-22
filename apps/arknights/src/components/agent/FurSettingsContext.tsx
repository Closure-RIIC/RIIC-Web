"use client";

import { createContext } from "react";
import type { FurSettings } from "./fur-settings";

// The gallery provides high quality; Agent reads the same appearance with its own budget.
export const FurSettingsContext = createContext<FurSettings | undefined>(undefined);
