"use client";
import { createContext, useContext, type ReactNode } from "react";

export type PrimitiveLabels = { toggleSidebar: string; sidebar: string; sidebarDescription: string; close: string };
const LabelsContext = createContext<PrimitiveLabels>({ toggleSidebar: "Toggle sidebar", sidebar: "Sidebar", sidebarDescription: "Mobile navigation", close: "Close" });

/** The application supplies translated labels; primitives do not own a locale runtime. */
export function PrimitiveLabelsProvider({ labels, children }: { labels: PrimitiveLabels; children: ReactNode }) {
  return <LabelsContext.Provider value={labels}>{children}</LabelsContext.Provider>;
}
export const usePrimitiveLabels = () => useContext(LabelsContext);
