import type { AdminFeedbackRecordData, AdminSkillAnnotationData, AdminSolverMetricsData, AdminUserData } from "@/types";
import type { AdminRelease, ReleaseDraft } from "@/releases/types";
import type { DiagnosticReport } from "@/diagnostics";
import type { AdminFetch } from "../admin/admin-context";

/** Browser-local sample transport. Never falls back to a network request. */
export function createAdminPreviewRequest(isAdmin: boolean, en: boolean): AdminFetch {
  const now = Date.now();
  const date = (hoursAgo = 0) => new Date(now - hoursAgo * 3_600_000).toISOString();
  const names = ["折纸舟", "白露与灯塔", "南桥", "Kestrel", "雨落龙门", "松间照", "Mira K.", "槐序", "北港信使", "听风的博士", "蓝盐", "Linh Nguyễn", "苇岸", "停云之外", "顾星河", "Nadia R.", "苔原来信"];
  const users: AdminUserData[] = names.map((name, index) => ({
    id: `preview-user-${index}`, name, email: `doctor.${index + 1}@example.test`,
    emailVerified: index % 7 !== 6, banned: index % 9 === 8,
    banReason: index % 9 === 8 ? (en ? "Sample suspended account" : "演示：账户已暂停") : null,
    createdAt: date(index * 37 + 3), isAdmin: index < 2, isReviewer: index === 2 || index === 5,
    isBootstrapAdmin: index === 0, sklandBindingCount: index % 3,
    sklandActiveBindingCount: index % 3, sklandRenewalDueCount: index === 4 ? 1 : 0,
    paidPoints: 120 + index * 45, monthlyPoints: index % 4 === 0 ? 100 : 0,
    monthlyExpiresAt: index % 4 === 0 ? date(-24 * (10 - index)) : null,
    totalPoints: 120 + index * 45 + (index % 4 === 0 ? 100 : 0),
  }));
  const revokedSessions = new Set<string>();
  const notes = en
    ? ["Trading station operator order differs after export.", "A manufacturing rotation leaves a slot empty.", "Compare Fiammetta target assignment across shifts.", "Review dormitory autofill in the downloaded plan.", "The solve took longer after changing the layout."]
    : ["贸易站导出后的干员顺序与排班展示不同。", "制造站轮换后有一个位置留空，希望核对替换排班。", "需要比较不同班次的菲亚梅塔充能目标。", "已确认宿舍自动填充设置与下载文件一致。", "调整布局后求解耗时变长，需要查看运行记录。"];
  let feedback: AdminFeedbackRecordData[] = notes.map((note, index) => ({
    id: `preview-feedback-${index + 1}`, diagnosticId: `preview-run-${index + 1}`,
    kind: index === 4 ? "performance_issue" : "room_issue",
    facility: (["trading", "manufacture", "control", "dormitory", "solver"] as const)[index],
    room: null, note, status: (["unreviewed", "reproduced", "reviewed", "fixed", "unreviewed"] as const)[index],
    adminNote: null, hasLinkedRun: true, createdAt: date(index * 2 + 1), updatedAt: date(index), expiresAt: date(-168),
  }));
  const annotations: AdminSkillAnnotationData[] = [];
  const draft: ReleaseDraft = {
    version: "0.7.1", date: date().slice(0, 10),
    title: { zh: "排班与导出体验更新（演示）", en: "Scheduling and export updates (sample)" }, notify: true,
    sections: [{ kind: "fixed", items: [{ zh: "MAA 导出的无人机与菲亚梅塔统一使用 pre 顺序。", en: "MAA exports use pre order for drones and Fiammetta." }] }],
  };
  const releases: AdminRelease[] = [{ id: "preview-release-1", draft, published: structuredClone(draft), firstPublishedAt: date(6), publishedAt: date(6), updatedAt: date(6), revision: 1 }];
  const success = (data: unknown) => Response.json({ success: true, data, requestId: "local-preview" });
  const failure = (status = 400) => Response.json({ success: false, error: { code: "PREVIEW_ONLY", message: en ? "This action is unavailable in the local preview. No live request was sent." : "此操作暂未接入本地演示，未发送真实请求。" } }, { status });
  const metrics = (): AdminSolverMetricsData => ({
    generatedAt: new Date().toISOString(),
    solver: {
      windowMinutes: 15, trendWindowMinutes: 60, trendBucketMinutes: 5,
      successCount: 237, failureCount: 3, completedCount: 240, errorRate: 3 / 240, throughputPerMinute: 16,
      averageDurationMs: 2438, p95DurationMs: 5812, averageSolverDurationMs: 1864, p95SolverDurationMs: 4721,
      averageWorkerDurationMs: 2438, sourceCounts: { maa: 91, skland: 142, sample: 7 },
      trend: [13, 21, 18, 29, 25, 31, 24, 38, 33, 42, 36, 39].map((count, index) => ({
        bucketStartedAt: date((12 - index) / 12), successCount: count,
        failureCount: index % 4 === 0 ? 1 : 0, completedCount: count + (index % 4 === 0 ? 1 : 0),
        errorRate: index % 4 === 0 ? 1 / (count + 1) : 0, averageDurationMs: 1630 + (index % 5) * 317,
      })),
    },
    queue: { bufferedCount: 2, pendingCount: 3, runningCount: 4, averageWaitMs: 431, p95WaitMs: 1207 },
    cache: { enabled: true, hitCount: 173, missCount: 67, lookupCount: 240, hitRate: 173 / 240, readyEntryCount: 1286, fillingEntryCount: 2 },
  });

  return async (input, init) => {
    const signal = init?.signal;
    signal?.throwIfAborted();
    await new Promise(resolve => setTimeout(resolve, 90));
    signal?.throwIfAborted();
    const url = new URL(input instanceof Request ? input.url : String(input), "http://admin-preview.invalid");
    const path = url.pathname;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (!path.startsWith("/api/admin/")) return failure(404);
    if (!isAdmin && ["/api/admin/users", "/api/admin/releases", "/api/admin/skill-annotations"].some(prefix => path.startsWith(prefix))) return failure(403);

    if (path === "/api/admin/users" && method === "GET") {
      const query = (url.searchParams.get("q") ?? "").toLocaleLowerCase();
      return success({ users: users.filter(user => `${user.name} ${user.email}`.toLocaleLowerCase().includes(query)), summary: { verifiedUsers: users.filter(user => user.emailVerified).length }, permissions: { canManageAdminRoles: true } });
    }
    if (path.startsWith("/api/admin/users/")) {
      const [, , , , id, resource] = path.split("/");
      const user = users.find(user => user.id === id);
      if (!user) return failure(404);
      if (resource === "sessions") {
        if (method === "DELETE") { revokedSessions.add(id); return success({ revoked: true }); }
        if (method === "GET") return success({ sessions: revokedSessions.has(id) || user.banned ? [] : [{ id: `session-${id}`, createdAt: date(2), updatedAt: date(), expiresAt: date(-48), ipAddress: "192.0.2.8", userAgent: "Preview browser · Windows" }] });
      }
      if (method === "PATCH" && !user.isBootstrapAdmin) {
        if (typeof body.banned === "boolean") user.banned = body.banned;
        if (typeof body.isAdmin === "boolean") user.isAdmin = body.isAdmin;
        if (typeof body.isReviewer === "boolean") user.isReviewer = body.isReviewer;
        return success({ updated: true });
      }
      return failure();
    }
    if (path === "/api/admin/solver-metrics" && method === "GET") return success(metrics());
    if (path === "/api/admin/diagnostics" && method === "GET") {
      const report: DiagnosticReport = {
        from: date(Number(url.searchParams.get("hours") ?? 1)), to: date(), configured: true, truncated: false, total: 7,
        groups: [
          { fingerprint: "preview-validation", category: "validation", code: "AIC-REQ-1001", route: "/api/plan", method: "POST", reason: en ? "Sample: incomplete layout input" : "演示：布局输入不完整", count: 5, first: date(0.7), last: date(0.1) },
          { fingerprint: "preview-auth", category: "authentication", code: "AIC-AUTH-2008", route: "/api/account", method: "GET", reason: en ? "Sample: expired session" : "演示：登录会话已过期", count: 2, first: date(0.5), last: date(0.2) },
        ], recent: [],
      };
      return success(report);
    }
    if (path === "/api/admin/feedback") {
      if (method === "PATCH") {
        for (const entry of body.items ?? []) {
          const item = feedback.find(item => item.id === entry.id);
          if (item) { item.status = body.status; item.adminNote = body.note; item.updatedAt = new Date().toISOString(); }
        }
        return success({ updated: true });
      }
      if (method === "DELETE" && isAdmin) {
        const ids: string[] = body.ids ?? [];
        feedback = feedback.filter(item => !ids.includes(item.id));
        return success({ deletedIds: ids, deletedCount: ids.length, privateArtifactsDeleted: 0 });
      }
      if (method === "GET") {
        const filtered = feedback.filter(item =>
          (!url.searchParams.get("status") || item.status === url.searchParams.get("status")) &&
          (!url.searchParams.get("facility") || item.facility === url.searchParams.get("facility")) &&
          item.note.toLocaleLowerCase().includes((url.searchParams.get("q") ?? "").toLocaleLowerCase()));
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 50);
        return success({ items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit });
      }
    }
    if (path.startsWith("/api/admin/feedback/") && method === "GET") {
      const item = feedback.find(item => path.endsWith("/" + item.id));
      if (!item) return failure(404);
      return success({ feedback: item, history: [], solverExecutableSha256: null, reproduction: { available: false, unavailableReason: "not_recorded", diagnosticId: item.diagnosticId, sourceName: null, error: null, stderrExcerpt: null, stdoutExcerpt: null, layout: null, operbox: null, rotation: null, rotationCount: null, fiammettaEnabled: null } });
    }
    if (path === "/api/admin/plan-runs" && method === "GET") return success({ items: [], total: 0, limit: 50, offset: 0 });
    if (path === "/api/admin/quality" && method === "GET") {
      if (url.searchParams.get("kind") === "related") return success({ links: [], matches: [], operators: [] });
      if (url.searchParams.has("kind")) return failure();
      return success({ isAdmin, drafts: [], batches: [], versions: [
        { id: "preview-current", label: en ? "Sample current version" : "演示：当前版本", executableSha256: "a".repeat(64), createdAt: date(4) },
        { id: "preview-baseline", label: en ? "Sample baseline" : "演示：对照版本", executableSha256: "b".repeat(64), createdAt: date(96) },
      ], worker: { at: date() } });
    }
    if (path === "/api/admin/releases" && method === "GET") return success({ environment: "local", releases });
    if (path === "/api/admin/releases" && method === "POST") {
      const release: AdminRelease = { id: `preview-release-${releases.length + 1}`, draft: body, published: null, firstPublishedAt: null, publishedAt: null, updatedAt: date(), revision: 1 };
      releases.unshift(release);
      return success({ release });
    }
    if (path.startsWith("/api/admin/releases/") && method === "PATCH" && body.action === "save") {
      const release = releases.find(release => path.endsWith("/" + release.id));
      if (!release) return failure(404);
      release.draft = body.draft; release.revision++; release.updatedAt = date();
      return success({ release });
    }
    if (path === "/api/admin/skill-annotations" && method === "GET") return success({ annotations });
    if (path === "/api/admin/skill-annotations" && method === "POST") {
      const annotation: AdminSkillAnnotationData = { ...body, id: `preview-note-${annotations.length + 1}`, createdAt: date(), updatedAt: date() };
      annotations.push(annotation);
      return success({ annotation });
    }
    if (path.startsWith("/api/admin/skill-annotations/")) {
      const index = annotations.findIndex(annotation => path.endsWith("/" + annotation.id));
      if (index < 0) return failure(404);
      if (method === "DELETE") { annotations.splice(index, 1); return success({ deleted: true }); }
      if (method === "PATCH") {
        const annotation = annotations[index];
        annotation.note = body.note;
        annotation.updatedAt = date();
        return success({ annotation });
      }
    }
    return failure();
  };
}
