import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "../components/DocsPage";
export const Route = createFileRoute("/docs")({ component: DocsPage });
