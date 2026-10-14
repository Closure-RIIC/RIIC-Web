import { handleBatchReviewFeedback, handleDeleteAdminFeedback, handleListAdminRecords } from "@/server/admin-records-api";


export async function GET(request: Request) {
  return handleListAdminRecords(request, "feedback", "/api/admin/feedback");
}

export async function DELETE(request: Request) {
  return handleDeleteAdminFeedback(request);
}

export async function PATCH(request: Request) {
  return handleBatchReviewFeedback(request);
}
