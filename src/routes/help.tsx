import { createFileRoute, Outlet } from "@tanstack/react-router";
import HelpLayout from "@/app/help/layout";
export const Route = createFileRoute("/help")({ component: () => <HelpLayout><Outlet /></HelpLayout> });
