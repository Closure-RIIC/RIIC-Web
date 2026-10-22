export interface ApiProblem {
  code?: string;
  message: string;
  retryable: boolean;
}

export function apiProblem(value: unknown): ApiProblem {
  const error = value && typeof value === "object" && "error" in value ? value.error : null;
  if (!error || typeof error !== "object") return { message: "Service is unavailable", retryable: false };
  return {
    message: "message" in error && typeof error.message === "string" ? error.message : "Service is unavailable",
    retryable: "retryable" in error && error.retryable === true,
    ...("code" in error && typeof error.code === "string" ? { code: error.code } : {}),
  };
}

export type GameId = "arknights" | "endfield";
export interface DataIdentity { userId: string; game: GameId; accountId: string; serverId: string; roleId: string; version: number }
export function dataIdentityKey(identity: DataIdentity): string {
  return JSON.stringify([identity.userId, identity.game, identity.accountId, identity.serverId, identity.roleId, identity.version]);
}
