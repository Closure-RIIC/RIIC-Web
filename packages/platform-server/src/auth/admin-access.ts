import { configuredAdminIds } from "./config.ts";

export const WEBSITE_ADMIN_ROLE = "admin";
export const WEBSITE_REVIEWER_ROLE = "reviewer";
export const WEBSITE_USER_ROLE = "user";

export type WebsiteAdminAccess = {
  userId: string;
  isAdmin: boolean;
  isReviewer: boolean;
  canAccessReview: boolean;
  isBootstrapAdmin: boolean;
  canManageAdminRoles: boolean;
};

export function websiteAdminAccess(
  userId: string,
  role: unknown,
  bootstrapAdminIds = configuredAdminIds(),
): WebsiteAdminAccess {
  const isBootstrapAdmin = bootstrapAdminIds.has(userId);
  const isAdmin = isBootstrapAdmin || role === WEBSITE_ADMIN_ROLE;
  const isReviewer = !isAdmin && role === WEBSITE_REVIEWER_ROLE;
  return {
    userId,
    isAdmin,
    isReviewer,
    canAccessReview: isAdmin || isReviewer,
    isBootstrapAdmin,
    canManageAdminRoles: isAdmin,
  };
}

export function canChangeWebsiteAdminRole(
  actor: WebsiteAdminAccess,
  target: WebsiteAdminAccess,
): boolean {
  return actor.canManageAdminRoles && !target.isBootstrapAdmin;
}

export function canModerateWebsiteUser(
  actor: WebsiteAdminAccess,
  target: WebsiteAdminAccess,
): boolean {
  return actor.isAdmin && (!target.isBootstrapAdmin || actor.isBootstrapAdmin);
}

export function isEligibleForWebsiteAdmin(emailVerified: boolean, banned: boolean | null): boolean {
  return emailVerified && !banned;
}
