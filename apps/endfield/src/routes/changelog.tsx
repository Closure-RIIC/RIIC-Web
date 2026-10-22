import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "../components/ChangelogPage";

export const Route = createFileRoute("/changelog")({ component: ChangelogPage });
