import { appendFile, readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DOCUMENTATION_METADATA = new Set([
  ".editorconfig",
  ".gitignore",
  "LICENSE",
]);

const RELEASE_WORKFLOWS = new Set([
  ".github/workflows/deploy.yml",
  ".github/workflows/frontend-quality.yml",
]);

const CI_ONLY_SCRIPTS = new Set([
  "scripts/build-tooling.test.mjs",
  "scripts/ci-change-scope.mjs",
  "scripts/ci-change-scope.test.mjs",
]);

const OPERATOR_DATA_FILES = new Set([
  "src/generated/arkntools/operator-catalog.json",
  "src/generated/arkntools/operator-pinyin.json",
  "src/generated/arkntools/operator-rarities.json",
  "src/generated/arkntools/building-skill-catalog.json",
  "src/generated/arkntools/term-catalog.json",
  "src/generated/arkntools/source.json",
  "src/generated/mastery-data.json",
  "src/generated/gacha-up.json",
  "fixtures/operbox_full_e2.json",
]);

function isOperatorData(filePath) {
  return OPERATOR_DATA_FILES.has(filePath)
    || /^public\/images\/operator-portraits\/[A-Za-z0-9_&]+\.webp$/.test(filePath)
    || /^public\/images\/building-skills\/[A-Za-z0-9_&]+\.png$/.test(filePath)
    || /^public\/images\/products\/[A-Za-z0-9_&]+\.webp$/.test(filePath);
}

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isDocumentationOrMetadata(filePath) {
  return (
    filePath.startsWith("docs/") ||
    (!filePath.includes("/") && filePath.toLowerCase().endsWith(".md")) ||
    DOCUMENTATION_METADATA.has(filePath) ||
    filePath.startsWith("LICENSE.")
  );
}

function isReleaseWorkflow(filePath) {
  return RELEASE_WORKFLOWS.has(filePath);
}

function isCiOnly(filePath) {
  return filePath.startsWith(".github/") || CI_ONLY_SCRIPTS.has(filePath);
}

function isBrowserTest(filePath) {
  return (
    filePath.startsWith("e2e/") ||
    /^playwright(?:\.[^/]+)?\.config\.[cm]?[jt]s$/.test(filePath)
  );
}

function isTestOnly(filePath) {
  return (
    isBrowserTest(filePath) ||
    /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath) ||
    /^scripts\/[^/]+\.test\.sh$/.test(filePath)
  );
}

function fullScope(paths, reason) {
  return {
    scope: "full",
    reason,
    changedFiles: paths,
    documentationOnly: false,
    runCore: true,
    runBrowser: true,
    deployRequired: true,
  };
}

export function classifyChanges(rawPaths, { forceFull = false } = {}) {
  const paths = [...new Set(rawPaths.map(normalizePath).filter(Boolean))].sort();

  if (forceFull) {
    return fullScope(paths, "manual-or-unsupported-event");
  }

  if (paths.length === 0) {
    return fullScope(paths, "empty-change-set");
  }

  const documentationOnly = paths.every(isDocumentationOrMetadata);
  if (documentationOnly) {
    return {
      scope: "documentation",
      reason: "documentation-and-repository-metadata-only",
      changedFiles: paths,
      documentationOnly: true,
      runCore: false,
      runBrowser: false,
      deployRequired: false,
    };
  }

  if (paths.some(isOperatorData) && paths.every((filePath) => isOperatorData(filePath) || isDocumentationOrMetadata(filePath))) {
    return {
      scope: "operator-data",
      reason: "managed-operator-data-only",
      changedFiles: paths,
      documentationOnly: false,
      runCore: true,
      runBrowser: false,
      deployRequired: true,
    };
  }

  const releaseWorkflowChanged = paths.some(isReleaseWorkflow);
  const browserTestsChanged = paths.some(isBrowserTest);
  const runtimeChanged = paths.some(
    (filePath) =>
      !isDocumentationOrMetadata(filePath) &&
      !isCiOnly(filePath) &&
      !isTestOnly(filePath),
  );

  const nonRuntimeOnly = paths.every(
    (filePath) =>
      isDocumentationOrMetadata(filePath) ||
      isCiOnly(filePath) ||
      isTestOnly(filePath),
  );

  if (!nonRuntimeOnly || runtimeChanged) {
    return fullScope(paths, "runtime-or-unclassified-change");
  }

  return {
    scope: browserTestsChanged ? "browser-tests" : "tooling-or-tests",
    reason: releaseWorkflowChanged
      ? "release-workflow-change"
      : browserTestsChanged
        ? "browser-test-only-change"
        : "tooling-or-unit-test-only-change",
    changedFiles: paths,
    documentationOnly: false,
    runCore: true,
    runBrowser: browserTestsChanged,
    deployRequired: releaseWorkflowChanged,
  };
}

function outputLines(result) {
  return [
    `scope=${result.scope}`,
    `reason=${result.reason}`,
    `documentation_only=${result.documentationOnly}`,
    `run_core=${result.runCore}`,
    `run_browser=${result.runBrowser}`,
    `deploy_required=${result.deployRequired}`,
  ].join("\n");
}

function summaryMarkdown(result) {
  const paths = result.changedFiles.length
    ? result.changedFiles.map((filePath) => `- \`${filePath}\``).join("\n")
    : "- No changed paths were available; full validation was selected.";

  return `### Change scope\n\n| Scope | Reason | Core | Chromium | Deploy |\n| --- | --- | --- | --- | --- |\n| ${result.scope} | ${result.reason} | ${result.runCore} | ${result.runBrowser} | ${result.deployRequired} |\n\n<details>\n<summary>Changed paths (${result.changedFiles.length})</summary>\n\n${paths}\n\n</details>\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const optionValue = (name) => {
    const index = args.indexOf(name);
    if (index === -1 || index === args.length - 1) {
      return null;
    }
    return args[index + 1];
  };

  const inputPath = optionValue("--input");
  const outputPath = optionValue("--github-output");
  const summaryPath = optionValue("--summary");
  const forceFull = args.includes("--force-full");
  const paths = inputPath
    ? (await readFile(inputPath)).toString("utf8").split("\0")
    : [];
  const result = classifyChanges(paths, { forceFull });
  if (args.includes("--require-operator-data") && result.scope !== "operator-data") {
    throw new Error("Operator-data release includes non-data changes or an empty diff; use the full release workflow.");
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (outputPath) {
    await appendFile(outputPath, `${outputLines(result)}\n`, "utf8");
  }
  if (summaryPath) {
    await appendFile(summaryPath, summaryMarkdown(result), "utf8");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
