import {
  handleLegacyAdminRecordsGet,
  handleLegacyAdminRecordsPatch,
} from "@/server/admin-records-api";


export async function GET(request: Request) {
  return handleLegacyAdminRecordsGet(request);
}

export async function PATCH(request: Request) {
  return handleLegacyAdminRecordsPatch(request);
}
