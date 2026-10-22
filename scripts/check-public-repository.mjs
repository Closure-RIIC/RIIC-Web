import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import process from "node:process";

const MAX_TRACKED_FILE_BYTES = 50 * 1024 * 1024;

const PRIVATE_HELPER_PATHS = new Set([
  "scripts/deploy-release.sh",
  "scripts/deploy-release.test.sh",
  "scripts/postgres-backup.test.sh",
  "scripts/prepare-release.sh",
  "scripts/prepare-release.test.sh",
  "scripts/solver-contract-smoke.mjs",
]);

const PRIVATE_DOCUMENT_PATHS = new Set([
  "docs/AUTHENTICATION_DATABASE.md",
  "docs/BUSINESS_DATA_STORAGE.md",
  "docs/DEVELOPMENT_GUIDE.md",
  "docs/DEVELOPMENT_RELEASE_GUARDRAILS.md",
  "docs/FRONTEND_PRODUCTION_READINESS_REPORT.md",
  "docs/INFRA_CLI_ADVICE_REPORT.md",
  "docs/LOGIN_USER_FLOW_PHASES_2_3_PLAN.md",
  "docs/PRODUCTION_RELEASE_RUNBOOK.md",
  "docs/UPDATE_SOLVER.md",
]);

const SECRET_PATTERNS = [
  {
    label: "private key",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/gu,
  },
  {
    label: "GitHub token",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gu,
  },
  {
    label: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  },
  {
    label: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu,
  },
  {
    label: "npm token",
    pattern: /\bnpm_[A-Za-z0-9]{30,}\b/gu,
  },
];

const trackedFiles = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "buffer",
  maxBuffer: 32 * 1024 * 1024,
});

if (trackedFiles.status !== 0) {
  process.stderr.write(trackedFiles.stderr?.toString("utf8") ?? "Unable to list tracked files.\n");
  process.exit(trackedFiles.status ?? 1);
}

const paths = trackedFiles.stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function isForbiddenPath(filePath) {
  const normalized = normalizePath(filePath);
  const baseName = normalized.split("/").at(-1) ?? normalized;
  const isEnvironmentFile = /(^|\/)\.env(?:\.|$)/u.test(normalized)
    && normalized !== ".env.example"
    && !/^(?:apps|services)\/[^/]+\/\.env\.example$/u.test(normalized)
    && normalized !== "deploy/postgres/example.env";

  return (
    baseName === "AGENTS.md" ||
    baseName === "AGENTS.override.md" ||
    /^bin\/infra-cli(?:\.exe)?$/iu.test(normalized) ||
    /^(?:apps\/[^/]+\/)?public\/videos\/help\/.*\.(?:mp4|webm|mov)$/iu.test(normalized) ||
    PRIVATE_HELPER_PATHS.has(normalized) ||
    PRIVATE_DOCUMENT_PATHS.has(normalized) ||
    /(^|\/)docs\/(?:internal|superpowers)(?:\/|$)/iu.test(normalized) ||
    /(^|\/)(?:server\/(?:feedback|storage)|bin\/data)(?:\/|$)/iu.test(normalized) ||
    /\.(?:key|pem|p12|pfx|jks)$/iu.test(baseName) ||
    isEnvironmentFile
  );
}

function textLine(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

const forbiddenPaths = paths.filter(isForbiddenPath);
const largeFiles = [];
const sensitiveStrings = [];
const actionPolicyErrors = [];
const privateHostPattern = /(?:[a-z0-9-]+\.)+ts\.net(?::\d+)?/giu;

for (const filePath of paths) {
  const contents = await readFile(filePath).catch((error) => {
    // A renamed/deleted tracked file can remain in the index until staging.
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (contents === null) continue;
  if (contents.byteLength > MAX_TRACKED_FILE_BYTES) {
    largeFiles.push(`${filePath} (${contents.byteLength} bytes)`);
  }
  if (contents.includes(0)) {
    continue;
  }

  const text = contents.toString("utf8");
  for (const match of text.matchAll(privateHostPattern)) {
    sensitiveStrings.push(`${filePath}:${textLine(text, match.index)} private Tailscale hostname`);
  }
  for (const { label, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      sensitiveStrings.push(`${filePath}:${textLine(text, match.index)} ${label}`);
    }
  }

  if (/^\.github\/workflows\/[^/]+\.ya?ml$/u.test(normalizePath(filePath))) {
    if (/^\s*pull_request_target\s*:/mu.test(text)) {
      actionPolicyErrors.push(`${filePath}: pull_request_target is forbidden`);
    }

    const externalUsePattern = /^\s*-?\s*uses:\s*["']?([^\s"'#]+)["']?(?:\s+#.*)?$/gmu;
    for (const match of text.matchAll(externalUsePattern)) {
      const reference = match[1];
      if (reference.startsWith("./") || reference.startsWith("docker://")) {
        continue;
      }
      if (!/@[0-9a-f]{40}$/u.test(reference)) {
        actionPolicyErrors.push(
          `${filePath}:${textLine(text, match.index)} external action is not pinned to a full commit SHA`,
        );
      }
    }
  }
}

function report(label, items) {
  if (!items.length) {
    return;
  }
  process.stderr.write(`${label}:\n${items.map((item) => `- ${item}`).join("\n")}\n`);
}

report("Public repository contains forbidden paths", forbiddenPaths);
report("Public repository contains oversized tracked files", largeFiles);
report("Public repository contains sensitive strings", sensitiveStrings);
report("GitHub Actions policy violations", actionPolicyErrors);

if (forbiddenPaths.length || largeFiles.length || sensitiveStrings.length || actionPolicyErrors.length) {
  process.exit(1);
}

process.stdout.write(
  `Public repository hygiene passed: ${paths.length} tracked files checked; tests are allowed, private deployment assets are not.\n`,
);
