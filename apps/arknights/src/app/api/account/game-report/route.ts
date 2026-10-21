import { handleGetGameReport, handlePostGameReport } from "@/server/game-report-api";


export async function GET(request: Request) { return handleGetGameReport(request); }
export async function POST(request: Request) { return handlePostGameReport(request); }
