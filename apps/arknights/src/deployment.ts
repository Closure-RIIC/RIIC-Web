export type AppDeploymentEnvironment = "production" | "development" | "local";

type DeploymentEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  | "APP_DEPLOYMENT_ENV"
  | "SKLAND_FEATURE_ENABLED"
  | "BETA_DEBUG_TOOLS_ENABLED"
  | "BETA_RATE_LIMIT_ENABLED"
  | "NODE_ENV"
>>;

export function appDeploymentEnvironment(
  environment: DeploymentEnvironment = process.env
): AppDeploymentEnvironment {
  if (environment.APP_DEPLOYMENT_ENV === "production") return "production";
  if (environment.APP_DEPLOYMENT_ENV === "development") return "development";
  return environment.NODE_ENV === "production" ? "production" : "local";
}

export function isSklandFeatureEnabled(
  environment: DeploymentEnvironment = process.env
): boolean {
  if (appDeploymentEnvironment(environment) === "production") {
    return environment.APP_DEPLOYMENT_ENV === "production"
      && environment.SKLAND_FEATURE_ENABLED === "1";
  }
  if (environment.SKLAND_FEATURE_ENABLED === "0") return false;
  return true;
}

export function isDebugToolsFeatureEnabled(
  environment: DeploymentEnvironment = process.env
): boolean {
  return appDeploymentEnvironment(environment) !== "production"
    && environment.BETA_DEBUG_TOOLS_ENABLED === "1";
}

export function areRequestRateLimitsEnabled(
  environment: DeploymentEnvironment = process.env
): boolean {
  if (appDeploymentEnvironment(environment) === "production") return true;
  return environment.BETA_RATE_LIMIT_ENABLED === "1";
}
