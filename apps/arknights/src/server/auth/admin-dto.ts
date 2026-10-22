import type { AdminSessionData, AdminUserData } from "@riic/arknights-domain/types";
import { websiteAdminAccess } from "@riic/platform-server/auth/admin-access";
import { sumPoints } from "../billing/points.ts";

type AdminUserRecord = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string | null;
  banned: boolean | null;
  banReason: string | null;
  createdAt: Date;
  sklandBindingCount: number;
  sklandActiveBindingCount: number;
  sklandRenewalDueCount: number;
  paidPoints?: number | null;
  monthlyPoints?: number | null;
  monthlyExpiresAt?: Date | null;
};

type AdminSessionRecord = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

export function toAdminUserData(record: AdminUserRecord, bootstrapAdminIds: Set<string>): AdminUserData {
  const access = websiteAdminAccess(record.id, record.role, bootstrapAdminIds);
  const monthlyExpiresAt = record.monthlyExpiresAt ?? null;
  const monthlyActive = monthlyExpiresAt !== null && monthlyExpiresAt.getTime() > Date.now();
  const paidPoints = Math.max(0, Number(record.paidPoints ?? 0));
  const monthlyPoints = monthlyActive ? Math.max(0, Number(record.monthlyPoints ?? 0)) : 0;
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    emailVerified: record.emailVerified,
    banned: record.banned,
    banReason: record.banReason,
    createdAt: record.createdAt.toISOString(),
    isAdmin: access.isAdmin,
    isReviewer: access.isReviewer,
    isBootstrapAdmin: access.isBootstrapAdmin,
    sklandBindingCount: record.sklandBindingCount,
    sklandActiveBindingCount: record.sklandActiveBindingCount,
    sklandRenewalDueCount: record.sklandRenewalDueCount,
    paidPoints,
    monthlyPoints,
    monthlyExpiresAt: monthlyActive ? monthlyExpiresAt.toISOString() : null,
    totalPoints: sumPoints(paidPoints, monthlyPoints),
  };
}

export function toAdminSessionData(record: AdminSessionRecord): AdminSessionData {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
  };
}
