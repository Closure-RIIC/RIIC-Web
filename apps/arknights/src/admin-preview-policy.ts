export function adminPreviewEnabled(environment: { NODE_ENV?: string; ADMIN_UI_PREVIEW?: string }): boolean {
  return environment.NODE_ENV === "development" && environment.ADMIN_UI_PREVIEW === "1";
}
