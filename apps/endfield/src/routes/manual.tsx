import { createFileRoute } from "@tanstack/react-router";
import { ManualPage } from "../components/ManualPage";
export const Route = createFileRoute("/manual")({ component: ManualPage });
