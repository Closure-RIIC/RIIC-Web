import { handleGetAdminSolverMetrics } from "@/server/admin-solver-metrics-api";


export async function GET(request: Request) {
  return handleGetAdminSolverMetrics(request);
}
