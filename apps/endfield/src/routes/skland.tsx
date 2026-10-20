import { createFileRoute } from "@tanstack/react-router";
import { SklandPage } from "../components/SklandPage";

export const Route = createFileRoute("/skland")({ component: SklandPage });
