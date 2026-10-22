import { createFileRoute } from "@tanstack/react-router";
import { SchedulePage } from "../components/SchedulePage";
export const Route = createFileRoute("/")({ component: SchedulePage });
