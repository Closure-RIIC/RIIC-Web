import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { URL } from "node:url";

const repoRoot = new URL("../", import.meta.url);

async function readRepoFile(relativePath) {
  return readFile(new URL(relativePath, repoRoot), "utf8");
}

test("CI avoids duplicate installation audits without weakening its security gate", async () => {
  const workflow = (await readRepoFile(".github/workflows/frontend-quality.yml")).replaceAll("\r\n", "\n");
  const packageJson = JSON.parse(await readRepoFile("package.json"));
  for (const job of ["static_checks", "database_checks", "release_artifact", "browser_e2e", "browser_boundaries"]) {
    const section = workflow.split(`  ${job}:\n`)[1]?.split(/^ {2}\w+:/m)[0];
    assert.ok(section, job);
    assert.match(section, /run: npm ci --no-audit --no-fund/);
  }
  const scheduled = workflow.split("  webkit_e2e:\n")[1].split(/^ {2}\w+:/m)[0];
  assert.match(scheduled, /run: npm ci\s*$/m);
  assert.doesNotMatch(scheduled, /--no-audit/);
  assert.match(workflow, /name: Security audit\s+run: npm run audit:security/);
  assert.equal(packageJson.scripts["audit:security"], "npm audit --audit-level=high");
  assert.match(workflow, /verify_result "\$RUN_CORE" "\$STATIC_RESULT" static/);
});

test("batched deployment inspections make one SSH call and fail closed on invalid responses", async (t) => {
  const workflow = (await readRepoFile(".github/workflows/deploy.yml")).replaceAll("\r\n", "\n");
  const gitExecPath = process.platform === "win32"
    ? spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout?.trim()
    : null;
  const gitBash = gitExecPath ? resolve(gitExecPath, "../../../bin/bash.exe") : null;
  const bash = process.env.TEST_BASH_PATH
    ?? (gitBash && existsSync(gitBash) ? gitBash : "bash");
  assert.equal(spawnSync(bash, ["--version"], { encoding: "utf8" }).status, 0,
    "Bash is required for deployment behavior tests; set TEST_BASH_PATH on Windows.");
  const digest = "a".repeat(64);
  for (const [name, good, bad] of [
    ["verify_helper", `root:root:755|6|${digest}`, [
      `root:root:777|6|${digest}`, `root:root:755|5|${digest}`,
      "root:root:755|6", "root:root:755|6|invalid",
    ]],
    ["verify_remote_archive", `123|${digest}`, [
      `124|${digest}`, `123|${"b".repeat(64)}`, "123", "123|invalid",
    ]],
  ]) {
    const body = workflow.match(new RegExp(`^          ${name}\\(\\) \\{[\\s\\S]*?^          \\}`, "m"))?.[0];
    assert.ok(body, name);
    assert.equal((body.match(/30s ssh/g) ?? []).length, 1);
    assert.match(body, /test -f '[^']+'\s+test ! -L/);
    assert.match(body, /set -eu/);
    assert.match(body, /timeout --kill-after=5s 30s ssh/);
    if (name === "verify_helper") {
      const permissionsCheck = body.indexOf("'root:root:755'");
      assert.ok(permissionsCheck >= 0 && permissionsCheck < body.indexOf("--contract-version"));
    }
    const script = `set -euo pipefail
      timeout() { shift 2; "$@"; }
      ssh() {
        printf 'FAKE_SSH_CALL\\n' >&2
        if [[ -n "$REMOTE_TEST_FAILURE" ]]; then
          "$BASH" -c '
            test() {
              if [[ "$1" == "-f" ]]; then [[ "$REMOTE_TEST_FAILURE" != "regular" ]]; return; fi
              if [[ "$1" == "!" && "$2" == "-L" ]]; then [[ "$REMOTE_TEST_FAILURE" != "symlink" ]]; return; fi
              builtin test "$@"
            }
            stat() { printf "UNSAFE_STAT_REACHED\\n" >&2; return 1; }
          '"\${!#}"
          return
        fi
        printf '%s' "$INSPECTION_RESPONSE"
        return "$SSH_EXIT"
      }
      ssh_options=(-o BatchMode=yes -o ConnectTimeout=15 -o ConnectionAttempts=2 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
      ssh_target=fixture@example.invalid
      remote_archive=/tmp/fixture.tar.gz
      ${body}
      ${name} deploy /usr/local/sbin/arknights-infra-deploy 6
    `;
    const run = (response, status = 0, remoteTestFailure = "") => spawnSync(bash, ["--noprofile", "--norc", "-c", script], {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, INSPECTION_RESPONSE: response, SSH_EXIT: String(status), REMOTE_TEST_FAILURE: remoteTestFailure,
        DEPLOY_SSH_USER: "fixture", DEPLOY_HOST: "example.invalid",
        GITHUB_STEP_SUMMARY: "/dev/null", DEPLOY_ARCHIVE_BYTES: "123", DEPLOY_ARCHIVE_SHA256: digest },
    });
    await t.test(`${name} accepts valid metadata in one request`, () => {
      const result = run(good);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr.trim(), "FAKE_SSH_CALL");
    });
    for (const response of [...bad, "", `${good}|extra`, `${good}|`, `${good}\nextra`]) {
      await t.test(`${name} rejects ${JSON.stringify(response)}`, () => {
        const result = run(response);
        assert.notEqual(result.status, 0, result.stdout);
      });
    }
    await t.test(`${name} propagates SSH failure even with valid output`, () => {
      assert.notEqual(run(good, 42).status, 0);
    });
    for (const failure of ["regular", "symlink"]) {
      await t.test(`${name} stops the remote script before stat when ${failure} check fails`, () => {
        const result = run("", 0, failure);
        assert.notEqual(result.status, 0);
        assert.equal(result.stderr.trim(), "FAKE_SSH_CALL");
      });
    }
  }
});

test("Next.js commands use the default Turbopack bundler", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json"));
  const playwrightConfig = await readRepoFile("playwright.config.ts");
  const productionPlaywrightConfig = await readRepoFile("playwright.production.config.ts");

  assert.equal(packageJson.scripts.build, "next build");
  assert.doesNotMatch(packageJson.scripts.dev, /--webpack\b/);
  assert.doesNotMatch(playwrightConfig, /--webpack\b/);
  assert.doesNotMatch(productionPlaywrightConfig, /--webpack\b/);
});

test("PostgreSQL integration tests register the TypeScript path alias loader", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json"));

  assert.match(packageJson.scripts["test:auth-integration"], /--import \.\/scripts\/register-hooks\.mjs/);
});

test("business backfill shares the 30-day retention constant for scanning and expiry", async () => {
  const source = await readRepoFile("scripts/backfill-business-data.mts");

  assert.match(source, /import \{ BUSINESS_DATA_TTL_MS \}/);
  assert.match(source, /const cutoff = Date\.now\(\) - BUSINESS_DATA_TTL_MS/);
  assert.equal((source.match(/\+ BUSINESS_DATA_TTL_MS/g) ?? []).length, 2);
  assert.doesNotMatch(source, /30 \* 24 \* 60 \* 60 \* 1000/);
});

test("production builds prepare a solver-free standalone runtime with static assets", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json"));
  const nextConfig = await readRepoFile("next.config.ts");
  const prepareStandalone = await readRepoFile("scripts/prepare-standalone.mjs");
  const startStandalone = await readRepoFile("scripts/start-standalone.mjs");
  const stageStandalone = await readRepoFile("scripts/stage-standalone-release.mjs");

  assert.match(nextConfig, /output: "standalone"/);
  assert.match(nextConfig, /generateBuildId: async \(\) => process\.env\.APP_BUILD_ID \?\? "local-development"/);
  assert.match(nextConfig, /deploymentId: process\.env\.APP_BUILD_ID/);
  assert.match(nextConfig, /APP_CLIENT_BUILD_ID: process\.env\.APP_BUILD_ID \?\? "local-development"/);
  assert.equal(packageJson.scripts.postbuild, "node scripts/prepare-standalone.mjs");
  assert.equal(packageJson.scripts.start, "node scripts/start-standalone.mjs");
  assert.equal(packageJson.scripts["release:stage"], "node scripts/stage-standalone-release.mjs");
  assert.match(prepareStandalone, /process\.env\.RIIC_NEXT_DIST_DIR \|\| "\.next"/);
  assert.match(prepareStandalone, /standaloneRoot, "public"/);
  assert.match(prepareStandalone, /standaloneRoot, "\.next", "static"/);
  assert.match(prepareStandalone, /\["infra-cli", "infra-cli\.exe"\]/);
  assert.match(prepareStandalone, /\["\.env", "\.env\.production", "\.env\.local", "\.env\.production\.local"\]/);
  assert.match(prepareStandalone, /standalone website output must not contain/);
  assert.match(prepareStandalone, /node_modules\/drizzle-orm/);
  assert.match(prepareStandalone, /scripts\/backfill-business-data\.mts/);
  assert.match(prepareStandalone, /scripts\/migrate-db\.mts/);
  assert.match(prepareStandalone, /scripts\/check-auth-readiness\.mts/);
  assert.match(prepareStandalone, /src\/server\/business-backfill\.ts/);
  assert.match(startStandalone, /ARKNIGHTS_INFRA_HOSTNAME \|\| "0\.0\.0\.0"/);
  assert.match(startStandalone, /process\.env\.PORT = String\(numericPort\)/);
  assert.match(startStandalone, /\.next\/standalone\/server\.js/);
  assert.match(stageStandalone, /kind: "riic-web-standalone"/);
  assert.match(stageStandalone, /standalone release root must not contain/);
  assert.match(stageStandalone, /\["bin\/infra-cli", "infra-cli"\]/);
  assert.match(stageStandalone, /\["\.env\.production\.local", "\.env\.production\.local"\]/);
  assert.match(stageStandalone, /dereference: true/);
  assert.doesNotMatch(stageStandalone, /outputRoot, "\.next", "cache"/);
});

test("the plan worker centrally dispatches an eight-task pipeline across four isolated solver lanes", async () => {
  const [workerRuntime, planTask, infra] = await Promise.all([
    readRepoFile("scripts/plan-worker-runtime.mts"),
    readRepoFile("src/server/plan-task.ts"),
    readRepoFile("src/server/infra.ts"),
  ]);

  assert.match(planTask, /PLAN_TASK_WORKER_CONCURRENCY = 4/);
  assert.match(workerRuntime, /PLAN_TASK_PIPELINE_DEPTH = 2/);
  assert.match(infra, /export async function warmPlanServeLane[\s\S]+getPlanServeClient\(serveLane\)[\s\S]+await serveClient\.ping\(\)[\s\S]+inspectSolverDeploymentReadiness/);
  assert.match(workerRuntime, /warmPlanServeLane[\s\S]+length: PLAN_TASK_WORKER_CONCURRENCY[\s\S]+warmPlanServeLane\(serveLane\)[\s\S]+recoverStaleRunningTasks[\s\S]+recordPlanWorkerHeartbeat/);
  const startup = workerRuntime.slice(workerRuntime.indexOf("export async function runPlanWorker"));
  const firstHeartbeat = startup.indexOf("await recordPlanWorkerHeartbeat");
  const storageProbe = startup.indexOf("await assertPlanArtifactStorageReady()");
  assert.ok(storageProbe >= 0 && storageProbe < startup.indexOf("warmPlanServeLane(serveLane)"));
  assert.ok(storageProbe < firstHeartbeat);
  const heartbeatTimer = startup.indexOf("const heartbeatTimer = setInterval");
  const artifactRecovery = startup.indexOf("void resumePendingPlanArtifactFinalizations");
  assert.ok(firstHeartbeat >= 0 && firstHeartbeat < heartbeatTimer);
  assert.ok(heartbeatTimer < artifactRecovery);
  const artifactResume = infra.slice(
    infra.indexOf("export async function resumePendingPlanArtifactFinalizations"),
    infra.indexOf("export async function waitForPlanArtifactFinalizers"),
  );
  assert.match(artifactResume, /batchSize = 64[\s\S]+await Promise\.all[\s\S]+await readdir\(runDir\)/);
  assert.doesNotMatch(artifactResume, /existsSync/);
  assert.match(workerRuntime, /capacity = PLAN_TASK_WORKER_CONCURRENCY \* PLAN_TASK_PIPELINE_DEPTH/);
  assert.match(workerRuntime, /runPlanWorkerDispatcher[\s\S]+Math\.min\(\.\.\.laneLoads\)[\s\S]+laneLoads\.findIndex[\s\S]+dependencies\.claim[\s\S]+dependencies\.execute\(task, serveLane\)/);
  assert.match(workerRuntime, /listenForPlanTaskAvailability[\s\S]+using 2s fallback polling/);
  assert.match(workerRuntime, /event: "plan_task_timing"[\s\S]+solverDurationMs[\s\S]+workerDurationMs[\s\S]+workerOutsideSolverMs/);
  assert.match(workerRuntime, /runPlan\([\s\S]+\{ serveLane, deferArtifacts: true \}/);
  assert.match(workerRuntime, /resumePendingPlanArtifactFinalizations[\s\S]+waitForPlanArtifactFinalizers\(30_000\)/);
  assert.match(infra, /deferArtifacts = Boolean\(options\.deferArtifacts && !ephemeralRunDir\)/);
  assert.match(infra, /updatePlanRunArtifactBestEffort[\s\S]+artifact-finalized\.json/);
  assert.match(infra, /__infraCliPlanServeClients\?: Map<number, InfraCliServeClient>/);
  assert.match(workerRuntime, /stopInfraServeClients\("计划任务 Worker 正在退出。"\)/);
  assert.match(workerRuntime, /stopInfraServeClients[\s\S]+getDatabase\(\)\.\$client[\s\S]+\[plan-worker\] stopped/);
  assert.match(infra, /for \(const client of globalForInfra\.__infraCliPlanServeClients\?\.values\(\) \?\? \[\]\) client\.stop\(reason\)/);
});

test("database migrations build queue indexes online after additive schema changes", async () => {
  const [migration, migrateScript, schema] = await Promise.all([
    readRepoFile("drizzle/0012_public_cardiac.sql"),
    readRepoFile("scripts/migrate-db.mts"),
    readRepoFile("src/server/db/schema.ts"),
  ]);

  assert.doesNotMatch(migration, /(?:DROP|CREATE) INDEX/);
  assert.match(migrateScript, /ONLINE_PLAN_TASK_INDEX_MANIFEST_VERSION = 1/);
  assert.match(migrateScript, /name: "plan_task_active_expires_idx"/);
  assert.match(migrateScript, /name: "plan_task_account_active_idx"/);
  assert.match(migrateScript, /name: "plan_task_ip_active_idx"/);
  assert.match(migrateScript, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.match(migrateScript, /pg_index\.indisvalid/);
  assert.match(migrateScript, /pg_get_indexdef/);
  assert.match(migrateScript, /normalizeIndexDefinition\(installed\.definition\) !== sql\.expected/);
  assert.match(migrateScript, /SET lock_timeout = '5s'/);
  assert.match(migrateScript, /pg_advisory_lock\(hashtext\(\$1\)\)/);
  assert.match(migrateScript, /await migrate\(drizzle\(\{ client \}\)[\s\S]+ensureOnlinePlanTaskIndexes\(client\)/);
  assert.match(migrateScript, /pg_advisory_unlock\(hashtext\(\$1\)\)/);
  assert.match(schema, /plan_task_active_expires_idx[\s\S]+\.concurrently\(\)/);
});

test("Next.js owns graceful shutdown while systemd accepts its signal exit statuses", async () => {
  const processCleanup = await readRepoFile("src/server/process-cleanup.ts");
  const systemdDropIn = await readRepoFile("deploy/next-graceful-exit.conf");
  const systemdGuide = await readRepoFile("deploy/SYSTEMD.md");

  assert.doesNotMatch(processCleanup, /SIGINT|SIGTERM/);
  assert.match(processCleanup, /target\.once\("exit", onExit\)/);
  assert.equal(systemdDropIn, "[Service]\nSuccessExitStatus=130 143\n");
  assert.match(systemdGuide, /drain in-flight requests/);
  assert.match(systemdGuide, /systemctl daemon-reload/);
});

test("CI enforces route and document preload JavaScript budgets after building", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json"));
  const workflow = await readRepoFile(".github/workflows/frontend-quality.yml");
  const budgetCheck = await readRepoFile("scripts/check-bundle-budget.mjs");

  assert.equal(packageJson.scripts["check:bundle-budget"], "node scripts/check-bundle-budget.mjs");
  assert.match(workflow, /Build standalone application and worker[\s\S]+Release output checks[\s\S]+npm run check:bundle-budget/);
  assert.match(budgetCheck, /MAX_SKLAND_DISABLED_ROUTE_INITIAL_JS_BYTES = 1_257_000/);
  assert.match(budgetCheck, /MAX_SKLAND_ENABLED_ROUTE_INITIAL_JS_BYTES = 1_293_000/);
  assert.match(budgetCheck, /MAX_SKLAND_ROUTE_INITIAL_JS_BYTES = 1_732_000/);
  assert.match(budgetCheck, /MAX_SKLAND_DISABLED_DOCUMENT_INITIAL_JS_BYTES = 1_370_000/);
  assert.match(budgetCheck, /MAX_SKLAND_ENABLED_DOCUMENT_INITIAL_JS_BYTES = 1_406_000/);
  assert.match(budgetCheck, /MAX_SKLAND_DISABLED_DOCUMENT_INITIAL_GZIP_JS_BYTES = 442_000/);
  assert.match(budgetCheck, /MAX_SKLAND_ENABLED_DOCUMENT_INITIAL_GZIP_JS_BYTES = 448_000/);
  assert.match(budgetCheck, /const sklandEnabled = sklandRoute\.firstLoadChunkPaths\.some/);
  assert.match(budgetCheck, /MAX_SECONDARY_ROUTE_INITIAL_JS_BYTES = 1_672_000/);
  assert.match(budgetCheck, /MAX_MANUAL_ROUTE_INITIAL_JS_BYTES = 1_692_000/);
  assert.match(budgetCheck, /MAX_DOCUMENT_INITIAL_JS_FILES = 18/);
  assert.match(budgetCheck, /WORKBENCH_ROUTES = \["\/", "\/manual", "\/training", "\/mastery", "\/recruitment", "\/skills", "\/skland", "\/account"\]/);
  assert.match(budgetCheck, /firstLoadUncompressedJsBytes/);
  assert.match(budgetCheck, /server\/app\/index\.html/);
  assert.match(budgetCheck, /return renderBuildDocument\(\)/);
  assert.match(budgetCheck, /gzipSync/);
  assert.match(budgetCheck, /COMPACT_SCHEDULE_MARKER = "data-compact-schedule-view"/);
  assert.match(budgetCheck, /compact schedule code leaked into the initially loaded application chunk/);
});

test("Next and the verified deployment keep real public GET responses compressed", async () => {
  const nextConfig = await readRepoFile("next.config.ts");
  const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");
  const rootLayout = await readRepoFile("src/app/layout.tsx");
  const publicVerification = await readRepoFile("scripts/verify-public-compression.mjs");

  assert.match(nextConfig, /compress: true/);
  assert.match(nextConfig, /const uncachedDocumentRoutes = \[/);
  assert.match(nextConfig, /const uncachedDocumentRoutes = \[[\s\S]+"\/manual"/);
  assert.match(nextConfig, /private, no-cache, no-store, max-age=0, must-revalidate/);
  assert.match(rootLayout, /"riic-build-id": process\.env\.APP_CLIENT_BUILD_ID \?\? "local-development"/);
  assert.match(publicVerification, /public HTML build ID is/);
  assert.match(publicVerification, /public HTML must not be stored by a shared cache/);
  assert.match(deployWorkflow, /Deploy and verify[\s\S]+Verify public response compression/);
  assert.match(deployWorkflow, /node scripts\/verify-public-compression\.mjs\s*$/m);
  assert.doesNotMatch(deployWorkflow, /verify-public-compression\.mjs "\$DEPLOY_PUBLIC_HEALTH_URL"/);
});

test("CI gates releases on Chromium and a WebKit Skland smoke test, then schedules the full WebKit suite", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json"));
  const workflow = await readRepoFile(".github/workflows/frontend-quality.yml");
  const playwrightConfig = await readRepoFile("playwright.config.ts");
  const e2eFiles = await readdir(new URL("../e2e/", import.meta.url));
  const readinessSpecs = e2eFiles.filter((file) => /^production-readiness-.+\.spec\.ts$/.test(file));
  const readinessTestCount = (await Promise.all(readinessSpecs.map((file) => readRepoFile(`e2e/${file}`))))
    .reduce((count, source) => count + (source.match(/^test\(/gm)?.length ?? 0), 0);

  assert.equal(
    packageJson.scripts["test:e2e:webkit:skland-qr"],
    "playwright test e2e/production-readiness-skland.spec.ts --project=webkit --grep \"Skland login exposes both methods\"",
  );
  assert.match(workflow, /browser_e2e:[\s\S]+shard: \[1\/4, 2\/4, 3\/4, 4\/4\][\s\S]+npm run test:e2e -- --shard=\$\{\{ matrix\.shard \}\}/);
  assert.match(workflow, /browser_boundaries:[\s\S]+npm run test:e2e:webkit:skland-qr[\s\S]+npm run test:e2e:production-profile/);
  assert.match(workflow, /webkit_e2e:[\s\S]+github\.event_name == 'schedule'[\s\S]+npm run test:e2e:webkit/);
  assert.match(workflow, /quality:[\s\S]+needs: \[changes, repository_hygiene, static_checks, database_checks, release_artifact, browser_e2e, browser_boundaries\]/);
  assert.doesNotMatch(workflow, /quality:[\s\S]+needs: \[[^\]]*webkit_e2e/);
  assert.match(workflow, /deploy:[\s\S]+needs: \[changes, quality, release_artifact\]/);
  assert.doesNotMatch(workflow, /^\s*pull_request\s*:/m);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.equal(readinessSpecs.length, 4);
  assert.equal(readinessTestCount, 117);
  assert.equal(e2eFiles.includes("production-readiness.spec.ts"), false);
  assert.match(playwrightConfig, /fullyParallel: true/);
  assert.match(playwrightConfig, /workers: process\.env\.CI \? 2 : undefined/);
  assert.match(playwrightConfig, /timeout: process\.env\.CI \? 10_000 : 5_000/);
});

test("CI change scope keeps one required quality gate and fails closed", async () => {
  const workflow = await readRepoFile(".github/workflows/frontend-quality.yml");
  const classifier = await readRepoFile("scripts/ci-change-scope.mjs");

  assert.doesNotMatch(workflow, /paths-ignore:/);
  assert.match(workflow, /changes:[\s\S]+name: Change scope/);
  assert.match(workflow, /repository_hygiene:[\s\S]+npm run check:public-repository/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /node scripts\/ci-change-scope\.mjs/);
  assert.doesNotMatch(workflow, /PR_BASE_SHA|PR_HEAD_SHA/);
  assert.match(workflow, /git diff --name-only -z "\$PUSH_BEFORE_SHA\.\.\$HEAD_SHA"/);
  assert.match(workflow, /"\$\{classifier\[@\]\}" --force-full/);
  assert.match(workflow, /git merge-base --is-ancestor "\$OPERATOR_DATA_BASE_SHA" "\$HEAD_SHA"/);
  assert.match(workflow, /git diff --name-only -z "\$OPERATOR_DATA_BASE_SHA\.\.\$HEAD_SHA"/);
  assert.match(workflow, /"\$\{classifier\[@\]\}" --require-operator-data/);
  assert.match(workflow, /static_checks:[\s\S]+needs: changes[\s\S]+needs\.changes\.outputs\.run_core == 'true'/);
  assert.match(workflow, /database_checks:[\s\S]+needs: changes[\s\S]+needs\.changes\.outputs\.run_core == 'true'/);
  assert.match(workflow, /release_artifact:[\s\S]+needs: changes[\s\S]+needs\.changes\.outputs\.run_core == 'true'/);
  assert.match(workflow, /browser_e2e:[\s\S]+needs: changes[\s\S]+needs\.changes\.outputs\.run_browser == 'true'/);
  assert.match(workflow, /quality:[\s\S]+test "\$CHANGES_RESULT" = "success"[\s\S]+test "\$HYGIENE_RESULT" = "success"[\s\S]+"\$DEPLOY_REQUIRED" == "true"[\s\S]+"\$required" == "true"[\s\S]+verify_result "\$RUN_CORE" "\$STATIC_RESULT"[\s\S]+verify_result "\$RUN_BROWSER" "\$BROWSER_E2E_RESULT"/);
  assert.match(workflow, /deploy:[\s\S]+needs\.changes\.outputs\.deploy_required == 'true'/);

  assert.match(classifier, /fullScope\(paths, "empty-change-set"\)/);
  assert.match(classifier, /fullScope\(paths, "runtime-or-unclassified-change"\)/);
  assert.match(classifier, /runCore: true,[\s\S]+runBrowser: true,[\s\S]+deployRequired: true/);
});

test("public deployment automation is repository-bound, opt-in, and secret-safe", async () => {
  const qualityWorkflow = await readRepoFile(".github/workflows/frontend-quality.yml");
  const policyWorkflow = await readRepoFile(".github/workflows/main-release-policy.yml");
  const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");
  const preflightWorkflow = await readRepoFile(".github/workflows/deployment-preflight.yml");
  const assetWorkflow = await readRepoFile(".github/workflows/sync-arkntools-assets.yml");
  const workflows = [qualityWorkflow, policyWorkflow, deployWorkflow, preflightWorkflow, assetWorkflow];
  const deployJobEnvironment = deployWorkflow.slice(
    deployWorkflow.indexOf("    env:"),
    deployWorkflow.indexOf("    steps:"),
  );
  const preflightJobEnvironment = preflightWorkflow.slice(
    preflightWorkflow.indexOf("    env:"),
    preflightWorkflow.indexOf("    steps:"),
  );
  const runtimeDiagnostics = preflightWorkflow.slice(
    preflightWorkflow.indexOf("      - name: Read-only incident diagnostics"),
    preflightWorkflow.indexOf("      - name: Remove SSH credentials from the runner"),
  );

  assert.doesNotMatch(qualityWorkflow, /^\s*pull_request\s*:/m);
  assert.match(policyWorkflow, /pull_request:[\s\S]+branches: \[main\]/);
  assert.match(policyWorkflow, /HEAD_REPOSITORY[\s\S]+EXPECTED_REPOSITORY: KnightCodeSquareMatrix\/RIIC-Web[\s\S]+"\$HEAD_REF" == release\/\*/);
  assert.match(policyWorkflow, /types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
  assert.match(policyWorkflow, /DIRECT_MAIN_RELEASE: \$\{\{ contains\(github\.event\.pull_request\.labels\.\*\.name, 'direct-main-release'\)[\s\S]+"\$DIRECT_MAIN_RELEASE" == "1"[\s\S]+develop ancestry is intentionally skipped/);
  assert.match(policyWorkflow, /git merge-base --is-ancestor refs\/remotes\/origin\/develop "\$HEAD_SHA"/);
  assert.match(qualityWorkflow, /workflow_dispatch:[\s\S]+deploy:[\s\S]+expected_sha:[\s\S]+type: string/);
  assert.match(qualityWorkflow, /deployment_authorized: \$\{\{ steps\.deploy_authorization\.outputs\.authorized \}\}/);
  assert.match(qualityWorkflow, /Authorize deployment trigger[\s\S]+EVENT_NAME: \$\{\{ github\.event_name \}\}[\s\S]+DEPLOY_REQUESTED: \$\{\{ inputs\.deploy \}\}[\s\S]+test "\$GITHUB_SHA" = "\$EXPECTED_SHA"[\s\S]+authorized=true[\s\S]+printf 'authorized=%s\\n'/);
  assert.match(qualityWorkflow, /Upload release for deployment[\s\S]+needs\.changes\.outputs\.deployment_authorized == 'true'/);
  assert.match(qualityWorkflow, /deploy:\r?\n {4}needs: \[changes, quality, release_artifact\][\s\S]+always\(\) &&[\s\S]+needs\.changes\.result == 'success'[\s\S]+needs\.quality\.result == 'success'[\s\S]+needs\.release_artifact\.result == 'success'[\s\S]+needs\.changes\.outputs\.deployment_authorized == 'true'[\s\S]+needs\.changes\.outputs\.deploy_required == 'true'[\s\S]+uses: \.\/\.github\/workflows\/deploy\.yml[\s\S]+deployment_authorized: \$\{\{ needs\.changes\.outputs\.deployment_authorized == 'true' \}\}[\s\S]+deploy_required: \$\{\{ needs\.changes\.outputs\.deploy_required == 'true' \}\}/);
  assert.match(deployWorkflow, /^on:\r?\n {2}workflow_call:/m);
  assert.doesNotMatch(deployWorkflow, /^ {2}(?:push|workflow_dispatch):/m);
  assert.doesNotMatch(deployWorkflow, /allow_workflow_dispatch|github\.event_name/);
  assert.match(deployWorkflow, /deployment_authorized:[\s\S]+type: boolean[\s\S]+deploy_required:[\s\S]+type: boolean/);
  assert.match(deployWorkflow, /inputs\.deployment_authorized &&[\s\S]+inputs\.deploy_required &&[\s\S]+github\.ref_name == 'main'[\s\S]+vars\.DEPLOY_AUTOMATION_ENABLED == '1'[\s\S]+github\.repository == 'KnightCodeSquareMatrix\/RIIC-Web'/);
  assert.match(deployWorkflow, /DEPLOY_APPROVED_SOLVER_SHA256: \$\{\{ github\.ref_name == 'develop' && vars\.DEPLOY_APPROVED_SOLVER_SHA256 \|\| '' \}\}[\s\S]+DEPLOY_EXPECTED_REPOSITORY: KnightCodeSquareMatrix\/RIIC-Web[\s\S]+DEPLOY_RELEASE_HELPER_CONTRACT: "6"/);
  assert.doesNotMatch(deployWorkflow, /DEPLOY_PREPARE_HELPER_CONTRACT|arknights-infra-prepare-release/);
  assert.match(deployWorkflow, /DEPLOY_PUBLIC_HEALTH_URL: \$\{\{ secrets\.DEPLOY_PUBLIC_HEALTH_URL \}\}/);
  assert.doesNotMatch(deployWorkflow, /DEPLOY_PUBLIC_HEALTH_URL: \$\{\{ vars\./);
  assert.doesNotMatch(deployJobEnvironment, /\$\{\{ secrets\./);
  assert.doesNotMatch(preflightJobEnvironment, /\$\{\{ secrets\./);
  assert.match(preflightWorkflow, /Preflight is read-only: no archive, release directory, symlink switch, or service restart was requested/);
  assert.match(preflightWorkflow, /mode:[\s\S]+baseline[\s\S]+cutover-ready/);
  assert.match(preflightWorkflow, /PREFLIGHT_MODE: \$\{\{ inputs\.mode \}\}/);
  assert.match(preflightWorkflow, /DEPLOY_ENVIRONMENT: \$\{\{ inputs\.environment \}\}/);
  assert.match(preflightWorkflow, /if \[\[ "\$PREFLIGHT_MODE" == "cutover-ready" \]\][\s\S]+test "\$actual_contract" = "\$expected_contract"/);
  assert.match(preflightWorkflow, /DEPLOY_APPROVED_SOLVER_SHA256: \$\{\{ inputs\.environment == 'development' && vars\.DEPLOY_APPROVED_SOLVER_SHA256 \|\| '' \}\}[\s\S]+DEPLOY_RELEASE_HELPER_CONTRACT: "6"/);
  assert.match(preflightWorkflow, /"\$PREFLIGHT_MODE" == "cutover-ready" && "\$DEPLOY_ENVIRONMENT" == "production"[\s\S]+cat '\$DEPLOY_APP_ROOT\/shared\/bin\/infra-cli\.sha256'[\s\S]+sudo -n \/usr\/local\/sbin\/arknights-infra-deploy/);
  assert.match(preflightWorkflow, /Inspect deploy helper, solver, and disk[\s\S]+verify_helper deploy \/usr\/local\/sbin\/arknights-infra-deploy/);
  assert.match(preflightWorkflow, /sudo -n \/usr\/local\/sbin\/arknights-infra-deploy[\s\S]+--preflight "\$deployment_environment" "\$app_root"[\s\S]+"\$expected_repository" "\$approved_solver_sha256"/);
  assert.match(preflightWorkflow, /solver_source=not-inspected-root-only/);
  assert.doesNotMatch(preflightWorkflow, /DEPLOY_PREPARE_HELPER_CONTRACT|arknights-infra-prepare-release|cache_repository|expected_origin|public_cache_ready|cache_public_origin_ready|repository\.git|git --git-dir/);
  assert.doesNotMatch(preflightWorkflow, /current_release\/\.env\.production\.local|current_release="\$\(readlink/);
  assert.match(runtimeDiagnostics, /if: inputs\.mode == 'baseline'/);
  assert.match(runtimeDiagnostics, /ps -u "\$run_user" -o pid=,ppid=,etimes=,rss=,comm=/);
  assert.match(runtimeDiagnostics, /awk -F: '\$1 == "0" \{ print \$3 \}' "\/proc\/\$pid\/cgroup"/);
  assert.match(runtimeDiagnostics, /grep -v '@\\\.service\$'/);
  assert.match(runtimeDiagnostics, /systemctl show --no-pager[\s\S]+journalctl --no-pager/);
  assert.doesNotMatch(
    runtimeDiagnostics,
    /^\s+(?:sudo|systemctl (?:start|stop|restart)|kill |rm )/m,
  );
  assert.match(preflightWorkflow, /Remove SSH credentials from the runner[\s\S]+rm -f -- "\$HOME\/\.ssh\/id_ed25519" "\$HOME\/\.ssh\/known_hosts"/);
  assert.match(deployWorkflow, /printf '%s\\n' "\$DEPLOY_PUBLIC_HEALTH_URL" \| ssh[\s\S]+'\$public_health_argument'/);
  assert.match(deployWorkflow, /'\$DEPLOY_EXPECTED_REPOSITORY'[\s\S]+'\$DEPLOY_SOLVER_SHA256'[\s\S]+'\$DEPLOY_TREE_SHA'/);
  assert.doesNotMatch(deployWorkflow, /'\$DEPLOY_PUBLIC_HEALTH_URL'/);
  assert.match(deployWorkflow, /Remove SSH credentials from the runner[\s\S]+rm -f -- "\$HOME\/\.ssh\/id_ed25519" "\$HOME\/\.ssh\/known_hosts"/);
  assert.match(deployWorkflow, /Verify public response compression[\s\S]+DEPLOY_PUBLIC_HEALTH_URL: \$\{\{ secrets\.DEPLOY_PUBLIC_HEALTH_URL \}\}[\s\S]+node scripts\/verify-public-compression\.mjs/);
  assert.match(assetWorkflow, /BASE_BRANCH: main/);
  assert.match(assetWorkflow, /UPDATE_BRANCH: release\/automation\/arkntools-assets/);
  assert.match(assetWorkflow, /gh pr (?:list|create)[\s\S]+--base "\$BASE_BRANCH"/);
  assert.match(assetWorkflow, /--label "direct-main-release"/);
  assert.match(assetWorkflow, /gh api --method PUT[\s\S]+pulls\/\$PR_NUMBER\/merge/);
  assert.match(assetWorkflow, /gh workflow run frontend-quality\.yml[\s\S]+--ref "\$BASE_BRANCH"[\s\S]+deploy=true[\s\S]+expected_sha="\$MERGED_SHA"/);
  assert.match(assetWorkflow, /develop_parity:[\s\S]+BASE_BRANCH: develop[\s\S]+SOURCE_BRANCH: main/);

  for (const workflow of workflows) {
    assert.doesNotMatch(workflow, /^\s*pull_request_target\s*:/m);
    for (const match of workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
      assert.ok(match[1].startsWith("./") || /@[0-9a-f]{40}$/.test(match[1]));
    }
  }
});

test("CI builds once and deploy transfers the verified solver-free standalone artifact", async () => {
  const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");
  const qualityWorkflow = await readRepoFile(".github/workflows/frontend-quality.yml");

  assert.match(deployWorkflow, /Use Node\.js 22[\s\S]+actions\/setup-node@[0-9a-f]{40}[\s\S]+node-version: 22/);
  assert.match(deployWorkflow, /Resolve verified release identity[\s\S]+git rev-parse 'HEAD\^\{tree\}'[\s\S]+DEPLOY_TREE_SHA=%s/);
  assert.match(deployWorkflow, /Validate deployment configuration[\s\S]+\[\[ "\$DEPLOY_TREE_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(qualityWorkflow, /Build standalone application and worker[\s\S]+APP_BUILD_ID: \$\{\{ github\.sha \}\}[\s\S]+APP_DEPLOYMENT_ENV:[\s\S]+SKLAND_FEATURE_ENABLED: "1"[\s\S]+ACCOUNT_CLOUD_SYNC_ENABLED: "1"[\s\S]+npm run build && npm run worker:build && node --check dist\/plan-worker\.cjs/);
  assert.match(qualityWorkflow, /RELEASE_SHA="\$GITHUB_SHA" RELEASE_TREE_SHA="\$release_tree_sha"[\s\S]+npm run release:stage -- --output "\$release_root"/);
  assert.match(qualityWorkflow, /tar --sort=name[\s\S]+--mtime="@\$source_date_epoch"[\s\S]+--mode='u\+rwX,go\+rX,go-w'[\s\S]+gzip --best --no-name --rsyncable[\s\S]+gzip -t "\$archive"/);
  assert.match(qualityWorkflow, /actions\/upload-artifact@[0-9a-f]{40}[\s\S]+name: riic-web-release-\$\{\{ github\.sha \}\}[\s\S]+compression-level: 0/);
  assert.match(deployWorkflow, /actions\/download-artifact@[0-9a-f]{40}[\s\S]+name: \$\{\{ inputs\.artifact_name \}\}/);
  assert.match(deployWorkflow, /Validate and extract release artifact[\s\S]+sha256sum --check --strict SHA256SUMS[\s\S]+metadata\.releaseSha, expectedSha[\s\S]+metadata\.releaseTreeSha, expectedTree/);
  assert.doesNotMatch(deployWorkflow, /npm ci|npm run build|npm run worker:build|npm run release:stage/);
  assert.match(deployWorkflow, /archive_sha256="\$\(sha256sum "\$local_archive"[\s\S]+DEPLOY_ARCHIVE_SHA256=%s/);
  assert.match(
    deployWorkflow,
    /Sync standalone release tree[\s\S]+release_tree_cache="\.cache\/riic-web\/\$\{DEPLOYMENT_ENV\}-standalone-tree"[\s\S]+--recursive[\s\S]+--times[\s\S]+--perms[\s\S]+--checksum[\s\S]+--compress[\s\S]+--delete-delay[\s\S]+--partial[\s\S]+--inplace[\s\S]+"\$DEPLOY_ARTIFACT_ROOT\/"[\s\S]+"\$ssh_target:\$release_tree_cache\/"/,
  );
  assert.match(deployWorkflow, /find "\$DEPLOY_ARTIFACT_ROOT"[\s\S]+! -type f ! -type d[\s\S]+release tree contains unsupported filesystem entries/);
  assert.match(deployWorkflow, /remote_cache_path=\\"\\\$HOME\/\$release_tree_cache\\"[\s\S]+test ! -L \\"\\\$remote_cache_path\\"[\s\S]+stat -c '%U:%a'/);
  assert.match(deployWorkflow, /tar --sort=name[\s\S]+--mtime='@\$SOURCE_DATE_EPOCH'[\s\S]+--mode='u\+rwX,go\+rX,go-w'[\s\S]+-C \\"\\\$remote_cache_path\\" \.[\s\S]+gzip --best --no-name --rsyncable[\s\S]+test \\"\\\$remote_sha256\\" = '\$DEPLOY_ARCHIVE_SHA256'[\s\S]+mv -fT/);
  assert.doesNotMatch(deployWorkflow, /archive_cache=|remote_prefix_sha256|upload_chunk_bytes/);
  assert.doesNotMatch(deployWorkflow, /\bscp\b/);
  assert.match(deployWorkflow, /DEPLOY_RELEASE_HELPER_CONTRACT: "6"/);
  assert.match(deployWorkflow, /'\$DEPLOY_SOLVER_SHA256' \\\n\s+'\$DEPLOY_TREE_SHA'/);
  assert.match(deployWorkflow, /Remove staged release artifacts from the runner[\s\S]+if: always\(\)[\s\S]+"\$RUNNER_TEMP"\/riic-web-release-\[0-9\]\*-\[0-9\]\*/);
  assert.doesNotMatch(deployWorkflow, /git (?:archive|bundle)|repository\.git|DEPLOY_PREVIOUS_SHA|remote_bundle/);
  const transfer = deployWorkflow.slice(deployWorkflow.indexOf("      - name: Sync standalone release tree"));
  assert.doesNotMatch(transfer, /bin\/infra-cli/);
});

test("deployment resumes an interrupted cache without accepting symlinks or non-directories", { skip: process.platform === "win32" }, async () => {
  const workflow = (await readRepoFile(".github/workflows/deploy.yml")).replaceAll("\r\n", "\n");
  const section = workflow.split("      - name: Sync standalone release tree")[1].split("\n      - name:")[0];
  const body = section.split("        run: |\n")[1].replace(/^ {10}/gm, "");
  const setup = body.slice(body.indexOf("timeout --kill-after=5s 30s ssh"), body.indexOf("timeout --kill-after=10s 5400s rsync"));
  assert.ok(setup);
  const script = [
    "set -euo pipefail",
    'export REVIEWER_CACHE_HOME="$(mktemp -d)"',
    'trap \'rm -rf -- "$REVIEWER_CACHE_HOME"\' EXIT',
    'release_tree_cache=".cache/riic-web/production-standalone-tree"',
    'cache="$REVIEWER_CACHE_HOME/$release_tree_cache"',
    'mkdir -p "$cache"',
    'chmod 700 "$(dirname "$cache")"',
    // rsync --perms can copy the source root's 755 mode before cancellation.
    'chmod 755 "$cache"',
    'printf partial > "$cache/retained-file"',
    'rsync() { :; }; export -f rsync',
    'timeout() { shift 2; "$@"; }',
    'ssh_options=(); ssh_target=fixture',
    'ssh() { local remote; for remote; do :; done; printf "%s" "$remote" | sed \'s/\\$HOME/\\$REVIEWER_CACHE_HOME/g\' | bash; }',
    setup,
    'test "$(stat -c %a "$cache")" = 700',
    'test "$(cat "$cache/retained-file")" = partial',
    'mv "$cache" "${cache}-saved"',
    'ln -s "${cache}-saved" "$cache"',
    'if ( set -e; ' + setup + ' ); then echo "Accepted symlink" >&2; exit 1; fi',
    'rm "$cache"; touch "$cache"',
    'if ( set -e; ' + setup + ' ); then echo "Accepted regular file" >&2; exit 1; fi',
  ].join("\n");
  const result = spawnSync("bash", ["--noprofile", "--norc", "-c", script], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
});

test("production pins the server solver only after preflight and development retains its approved digest", async () => {
  const workflow = (await readRepoFile(".github/workflows/deploy.yml")).replaceAll("\r\n", "\n");
  const section = workflow.split("      - name: Resolve solver for deployment\n")[1]?.split("\n      - name:")[0];
  const body = section?.split("        run: |\n")[1]?.replace(/^ {10}/gm, "");
  assert.ok(body);
  const gitExecPath = process.platform === "win32"
    ? spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout?.trim()
    : null;
  const gitBash = gitExecPath ? resolve(gitExecPath, "../../../bin/bash.exe") : null;
  const bash = process.env.TEST_BASH_PATH ?? (gitBash && existsSync(gitBash) ? gitBash : "bash");
  const script = [
    "set -euo pipefail",
    'GITHUB_ENV="$(mktemp)"',
    'trap \'cat "$GITHUB_ENV"; rm -f -- "$GITHUB_ENV"\' EXIT',
    'timeout() { shift 2; "$@"; }',
    "ssh() {",
    "  printf 'SSH_CALL\\n' >&2",
    "  local remote_command; for remote_command; do :; done",
    '  if [[ "$remote_command" == *"--preflight"* ]]; then',
    "    printf 'PREFLIGHT_CALL\\n' >&2",
    '    return "$PREFLIGHT_EXIT"',
    "  fi",
    '  printf "%s" "$SERVER_DIGEST"',
    '  return "$SSH_EXIT"',
    "}",
    body,
  ].join("\n");
  const serverDigest = "a".repeat(64);
  const approvedDigest = "b".repeat(64);
  const run = (overrides = {}) => spawnSync(bash, ["--noprofile", "--norc", "-c", script], {
    encoding: "utf8", timeout: 10_000,
    env: {
      ...process.env, DEPLOYMENT_ENV: "production", DEPLOY_APP_ROOT: "/opt/arknights-infra",
      DEPLOY_EXPECTED_REPOSITORY: "KnightCodeSquareMatrix/RIIC-Web",
      DEPLOY_APPROVED_SOLVER_SHA256: "", DEPLOY_HOST: "example.invalid", DEPLOY_SSH_USER: "fixture",
      SERVER_DIGEST: serverDigest, SSH_EXIT: "0", PREFLIGHT_EXIT: "0",
      GITHUB_STEP_SUMMARY: "/dev/null", ...overrides,
    },
  });
  for (const configured of ["", approvedDigest]) {
    const result = run({ DEPLOY_APPROVED_SOLVER_SHA256: configured });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "DEPLOY_SOLVER_SHA256=" + serverDigest);
    assert.match(result.stderr, /PREFLIGHT_CALL/);
  }
  for (const overrides of [
    { SERVER_DIGEST: "" }, { SERVER_DIGEST: "invalid" },
    { SERVER_DIGEST: serverDigest + "\n" + approvedDigest }, { SSH_EXIT: "1" },
    { DEPLOY_APP_ROOT: "/opt/arknights-infra-dev" },
  ]) {
    const result = run(overrides);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /DEPLOY_SOLVER_SHA256=/);
    assert.doesNotMatch(result.stderr, /PREFLIGHT_CALL/);
  }
  const rejected = run({ PREFLIGHT_EXIT: "1" });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /PREFLIGHT_CALL/);
  assert.doesNotMatch(rejected.stdout, /DEPLOY_SOLVER_SHA256=/);
  const development = run({ DEPLOYMENT_ENV: "development", DEPLOY_APPROVED_SOLVER_SHA256: approvedDigest });
  assert.equal(development.status, 0, development.stderr);
  assert.equal(development.stdout.trim(), "DEPLOY_SOLVER_SHA256=" + approvedDigest);
  assert.doesNotMatch(development.stderr, /SSH_CALL/);
  assert.notEqual(run({ DEPLOYMENT_ENV: "development" }).status, 0);
});

test("asset synchronization isolates untrusted generation from repository write credentials", async () => {
  const workflow = await readRepoFile(".github/workflows/sync-arkntools-assets.yml");
  const generate = workflow.slice(workflow.indexOf("  generate:"), workflow.indexOf("  publish:"));
  const publish = workflow.slice(workflow.indexOf("  publish:"));

  assert.match(workflow, /schedule:\n {4}# 00:00 UTC = 08:00 Asia\/Shanghai \(UTC\+8\)\.\n {4}- cron: "0 0 \* \* \*"/);
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.match(generate, /persist-credentials: false/);
  assert.doesNotMatch(generate, /contents: write|pull-requests: write|actions: write|GH_TOKEN:/);
  assert.match(generate, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(publish, /permissions:\n {6}actions: write\n {6}contents: write\n {6}issues: write\n {6}pull-requests: write/);
  assert.match(publish, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(publish, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(publish, /git apply --check --index "\$publication\/managed\.patch"/);
  assert.match(publish, /patch_bytes > 0 && patch_bytes <= 104857600/);
  assert.match(publish, /awk '\$1 != "100644"/);
  assert.match(publish, /Publication artifact changed a forbidden path/);
  assert.match(publish, /Resource pull request changed a forbidden path/);
  assert.match(publish, /git restore --source "refs\/remotes\/origin\/\$SOURCE_BRANCH" --staged --worktree --/);
  assert.doesNotMatch(publish, /npm (?:ci|run)|node scripts\//);
});

test("mastery, gacha UP data and the full fixture follow every managed-resource publication and parity gate", async () => {
  const workflow = await readRepoFile(".github/workflows/sync-arkntools-assets.yml");
  assert.match(workflow, /npm run assets:mastery -- \.tmp\/arknights-game-data\/zh_CN\/gamedata\/excel\/character_table\.json --game-source-sha=/);
  assert.match(workflow, /game_sha=\$\(git -C \.tmp\/arknights-game-data rev-parse HEAD\)/);
  assert.match(workflow, /\/assets\/img\/avatar/);
  assert.match(workflow, /\/item\/AP_BASE\.png/);
  assert.equal((workflow.match(/echo "base_sha=\$remote_base_sha" >> "\$GITHUB_OUTPUT"/g) ?? []).length, 2);
  assert.equal((workflow.match(/-f operator_data_base_sha="\$\{\{ steps\.merge\.outputs\.base_sha \}\}"/g) ?? []).length, 2);
  const guards = workflow.match(/public\/images\/operator-portraits\/\*\|[^\n]+;;/g) ?? [];
  assert.equal(guards.length, 4);
  for (const guard of guards) assert.match(guard, /\|src\/generated\/mastery-data\.json\|src\/generated\/gacha-up\.json\|fixtures\/operbox_full_e2\.json\) ;;/);
  const regularFileChecks = workflow.match(/git ls-files -s --[^\n]+/g) ?? [];
  assert.equal(regularFileChecks.length, 3);
  for (const check of regularFileChecks) {
    assert.ok(check.includes("src/generated/mastery-data.json"));
    assert.ok(check.includes("src/generated/gacha-up.json"));
    assert.ok(check.includes("fixtures/operbox_full_e2.json"));
  }
  assert.match(workflow, /git restore --source[^\n]+[\s\S]*?src\/generated\/arkntools \\\n\s+src\/generated\/mastery-data\.json/);
  const generateStep = workflow.slice(workflow.indexOf("      - name: Generate and validate assets"), workflow.indexOf("      - name: Run pre-PR quality gates"));
  assert.ok(generateStep.indexOf("npm run assets:gacha-up") > generateStep.indexOf("npm run assets:sync:arkntools"));
  assert.match(workflow, /git status --porcelain --[^\n]*src\/generated\/gacha-up\.json/);
  assert.match(workflow, /git add --[^\n]*src\/generated\/gacha-up\.json/);
  assert.match(workflow, /src\/generated\/gacha-up\.json \\\n\s+fixtures\/operbox_full_e2\.json/);
  assert.match(workflow, /git show HEAD:src\/generated\/gacha-up\.json/);
  assert.match(workflow, /--before-gacha-up "\$RUNNER_TEMP\/gacha-up-before\.json"/);
});

test("CI browser jobs use the matching pinned Playwright image without runtime apt installs", async () => {
  const packageLock = JSON.parse(await readRepoFile("package-lock.json"));
  const workflow = await readRepoFile(".github/workflows/frontend-quality.yml");
  const playwrightVersion = packageLock.packages["node_modules/@playwright/test"].version;
  const escapedVersion = playwrightVersion.replaceAll(".", "\\.");
  const pinnedImage = new RegExp(`image: mcr\\.microsoft\\.com/playwright:v${escapedVersion}-noble@sha256:[a-f0-9]{64}`, "g");
  const browserJobs = workflow.slice(workflow.indexOf("  browser_e2e:"), workflow.indexOf("  quality:"));

  assert.equal(workflow.match(pinnedImage)?.length, 3);
  assert.equal(browserJobs.match(/@postgres:5432\/arknights_auth_test/g)?.length, 9);
  assert.doesNotMatch(browserJobs, /playwright install(?:-deps)?/);
  assert.doesNotMatch(browserJobs, /Initialize limited database roles/);
  assert.equal(browserJobs.match(/options: --user 1001/g)?.length, 3);
});

test("production injects the client feature flag at every browser boundary", async () => {
  const nextConfig = await readRepoFile("next.config.ts");
  const app = await readRepoFile("src/App.tsx");
  const sklandPage = await readRepoFile("src/app/(workbench)/skland/page.tsx");
  const developmentSklandCenter = await readRepoFile("src/components/pages/DevelopmentSklandStatusCenter.tsx");
  const setupDialog = await readRepoFile("src/setup-dialog.tsx");
  const workflow = await readRepoFile(".github/workflows/frontend-quality.yml");

  assert.match(nextConfig, /APP_CLIENT_SKLAND_ENABLED: isSklandFeatureEnabled\(\) \? "1" : "0"/);
  assert.match(nextConfig, /APP_CLIENT_SKLAND_API_PREFIX: isSklandFeatureEnabled\(\) \? "\/api\/skland" : ""/);
  assert.match(nextConfig, /"account-cloud-workspace-bridge": process\.env\.ACCOUNT_CLOUD_SYNC_ENABLED === "1"/);
  assert.match(nextConfig, /useAccountCloudWorkspace\.disabled\.ts/);
  assert.match(nextConfig, /"workbench-skland-route": isSklandFeatureEnabled\(\)/);
  assert.match(nextConfig, /SklandRoute\.disabled\.tsx/);
  assert.match(app, /process\.env\.APP_CLIENT_SKLAND_ENABLED === "1"/);
  assert.match(sklandPage, /process\.env\.APP_CLIENT_SKLAND_ENABLED !== "1"/);
  assert.match(setupDialog, /process\.env\.APP_CLIENT_SKLAND_ENABLED === "1"/);
  assert.match(developmentSklandCenter, /SklandStatus/);
  assert.match(workflow, /Build standalone application and worker[\s\S]+APP_DEPLOYMENT_ENV: \$\{\{ env\.DEPLOYMENT_ENV \}\}[\s\S]+SKLAND_FEATURE_ENABLED: "1"/);
  assert.match(workflow, /Release output checks[\s\S]+APP_DEPLOYMENT_ENV: production[\s\S]+SKLAND_FEATURE_ENABLED: "1"[\s\S]+npm run check:production-client/);
});

test("workbench views use five prefetched route entries under one persistent layout", async () => {
  const layout = await readRepoFile("src/app/(workbench)/layout.tsx");
  const app = await readRepoFile("src/App.tsx");
  const sidebar = await readRepoFile("src/components/layout/AppSidebar.tsx");
  const routeMap = await readRepoFile("src/workbench-routes.ts");
  const pages = await Promise.all([
    "src/app/(workbench)/page.tsx",
    "src/app/(workbench)/training/page.tsx",
    "src/app/(workbench)/skills/page.tsx",
    "src/app/(workbench)/skland/page.tsx",
    "src/app/(workbench)/account/page.tsx",
  ].map(readRepoFile));
  const loadingPages = await Promise.all([
    "src/app/(workbench)/training/loading.tsx",
    "src/app/(workbench)/skills/loading.tsx",
    "src/app/(workbench)/account/loading.tsx",
  ].map(readRepoFile));

  assert.match(layout, /import WorkbenchApp from "@\/App"/);
  assert.match(layout, /<WorkbenchApp>\{children\}<\/WorkbenchApp>/);
  assert.ok(pages.every((page) => !page.includes("dynamic(")));
  assert.ok(loadingPages.every((loadingPage) => loadingPage.includes("RouteSkeleton")));
  assert.doesNotMatch(app, /components\/pages\/(?:InfraCalculator|TrainingAdvice|SkillQuery|AccountStatusCenter|DevelopmentSklandStatusCenter)/);
  assert.match(routeMap, /training: "\/training"/);
  assert.match(routeMap, /"skill-query": "\/skills"/);
  assert.match(routeMap, /skland: "\/skland"/);
  assert.match(routeMap, /account: "\/account"/);
  assert.match(sidebar, /import Link from "next\/link"/);
  assert.doesNotMatch(sidebar, /useLinkStatus|data-navigation-pending/);
  assert.match(sidebar, /data-primary-navigation-prefetch="eager"/);
  assert.doesNotMatch(sidebar, /prefetch=\{false\}/);
  assert.match(app, /router\.prefetch\(workbenchHref\(target\)\)/);
  assert.doesNotMatch(app, /betaRequested|showBetaPanels|DebugActions|IssuePanel/);
  assert.doesNotMatch(routeMap, /\?beta|betaRequested/);
  assert.doesNotMatch(sidebar, /\?beta|betaRequested/);
});

test("the Skland entry is request-rendered so releases cannot retain stale login chunks", async () => {
  const sklandPage = await readRepoFile("src/app/(workbench)/skland/page.tsx");

  assert.match(sklandPage, /export const dynamic = "force-dynamic"/);
});

test("the critical calculator board stays initial while the compact view loads on demand", async () => {
  const calculator = await readRepoFile("src/components/pages/InfraCalculator.tsx");
  const calculatorRoute = await readRepoFile("src/components/workbench/CalculatorRoute.tsx");
  const app = await readRepoFile("src/App.tsx");

  assert.match(calculator, /import \{ ScheduleBoard, ShiftTabs \} from "@\/components"/);
  assert.doesNotMatch(calculator, /const (?:ScheduleBoard|ShiftTabs) = lazy\(/);
  assert.doesNotMatch(calculator, /const (?:ScheduleBoard|ShiftTabs) = dynamic\(/);
  assert.doesNotMatch(calculator, /<Suspense fallback=\{<DeferredResultLoading \/>\}><ScheduleBoard/);
  assert.match(calculatorRoute, /import \{ InfraCalculator \} from "@\/components\/pages\/InfraCalculator"/);
  assert.doesNotMatch(app, /PageScrollbar/);
  const components = await readRepoFile("src/components.tsx");
  assert.match(components, /useState<ScheduleViewMode \| null>\(null\)/);
  assert.match(components, /useState<boolean \| null>\(null\)/);
  assert.match(components, /window\.matchMedia\("\(min-width: 1024px\)"\)/);
  assert.match(components, /viewMode !== "compact"[\s\S]{0,300}import\("@\/components\/CompactScheduleView"\)/);
  assert.doesNotMatch(components, /import \{ CompactScheduleView \} from "@\/components\/CompactScheduleView"/);
  assert.doesNotMatch(calculator, /onViewModeChange|showBetaSidebar|showBetaPanels/);
  assert.match(app, /const hasRenderedCalculator = useRef\(false\)/);
  assert.match(calculator, /animateInitialView=\{!scheduleResult && animateEmptyScheduleEntrance\}/);
  assert.doesNotMatch(calculator, /animateInitialView=\{!scheduleResult\}/);
});

test("heavy account, operator, and scrollbar modules stay behind runtime boundaries", async () => {
  const app = await readRepoFile("src/App.tsx");
  const schedule = await readRepoFile("src/schedule.ts");
  const components = await readRepoFile("src/components.tsx");
  const scrollbar = await readRepoFile("src/components/ui/page-scrollbar.tsx");

  assert.match(app, /useWebsiteSession/);
  assert.doesNotMatch(app, /authClient\.useSession/);
  assert.match(app, /await import\("\.\/manual-schedule"\)/);
  assert.match(app, /from "\.\/manual-schedule-config"/);
  assert.doesNotMatch(app, /import \{\s*createManualScheduleDraftFromCalculator/);
  assert.doesNotMatch(schedule, /operatorPresentationFor/);
  assert.doesNotMatch(components, /from "@\/operatorPortraits"/);
  assert.match(app, /const loadWebsiteAccountDialog = \(\) => import\("@\/components\/auth\/WebsiteAccountDialog"\)/);
  assert.match(scrollbar, /import\("overlayscrollbars"\)/);
});

test("versioned product assets receive immutable cache headers", async () => {
  const nextConfig = await readRepoFile("next.config.ts");

  assert.match(nextConfig, /source: "\/images\/products\/:asset"/);
  assert.match(nextConfig, /key: "v", value: "\\\\d\+-\[0-9a-f\]\{12\}"/);
  assert.match(nextConfig, /public, max-age=31536000, immutable/);
});

test("building skill immutable cache headers require an asset version", async () => {
  const nextConfig = await readRepoFile("next.config.ts");
  const rules = [...nextConfig.matchAll(/source: "\/images\/building-skills\/:asset"([\s\S]*?)\n\s*},/g)];
  assert.equal(rules.length, 1);
  assert.match(rules[0][1], /has: \[\{ type: "query", key: "v", value: "\\\\d\+-\[0-9a-f\]\{12\}" }\]/);
  assert.match(rules[0][1], /public, max-age=31536000, immutable/);
});
