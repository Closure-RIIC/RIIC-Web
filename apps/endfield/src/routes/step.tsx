import { createFileRoute } from "@tanstack/react-router";
import { StepPage } from "../components/StepPage";

export const Route = createFileRoute("/step")({ component: StepPage });
