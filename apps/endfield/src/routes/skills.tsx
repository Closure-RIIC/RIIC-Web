import { createFileRoute } from "@tanstack/react-router";
import { RosterPage } from "../components/RosterPage";
export const Route = createFileRoute("/skills")({ component: () => <RosterPage skillsOnly /> });
