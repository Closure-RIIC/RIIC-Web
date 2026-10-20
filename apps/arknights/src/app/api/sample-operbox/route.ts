import { getSampleOperbox } from "@/server/infra";
import { createRequestId, failureResponse, successResponse } from "@/server/api-contract";
import type { OperBoxEntry, SampleOperboxData } from "@/types";


export async function GET() {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const sample = await getSampleOperbox();
    if (!Array.isArray(sample.operbox)) throw new Error("Invalid sample data");
    return successResponse<SampleOperboxData>({
      sourceName: "243 全精二示例",
      operbox: sample.operbox as OperBoxEntry[],
    }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, "/api/sample-operbox", startedAt, "AIC-SYS-5000");
  }
}

