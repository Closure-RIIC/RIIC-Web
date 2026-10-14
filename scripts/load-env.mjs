import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "dotenv";
import { expand } from "dotenv-expand";

/** Preserve shell > mode-local > local > mode > base environment precedence. */
export function loadEnvConfig(directory, dev = process.env.NODE_ENV !== "production") {
  const mode = process.env.NODE_ENV === "test" ? "test" : dev ? "development" : "production";
  const names = [`.env.${mode}.local`, ...(mode === "test" ? [] : [".env.local"]), `.env.${mode}`, ".env"];
  for (const name of names) {
    const file = path.join(directory, name);
    if (existsSync(file)) expand({ parsed: parse(readFileSync(file)), processEnv: process.env });
  }
  return { combinedEnv: process.env };
}
