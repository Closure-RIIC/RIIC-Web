import { createFileRoute, Outlet } from "@tanstack/react-router";
import WorkbenchLayout from "@/app/(workbench)/layout";
export const Route = createFileRoute("/_workbench")({ component: () => <WorkbenchLayout><Outlet /></WorkbenchLayout> });
