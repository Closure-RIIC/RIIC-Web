import type { ReleaseNote } from "./types.ts";

// Latest release at migration 0015's bootstrap. Kept as an immutable test fixture.
// Runtime content comes from the database; manage future releases in /admin/changelog.
export const latestRelease = {
  version: "0.6.1",
  date: "2026-09-05",
  title: { zh: "更新日志与版本通知上线", en: "Changelog and release notifications" },
  sections: [
    {
      kind: "added",
      items: [
        { zh: "从侧边栏进入「更新日志」，集中查看已发布版本的新功能、体验优化与问题修复，支持中英文切换。", en: "Open Changelog from the sidebar to review published features, improvements and fixes in Chinese or English." },
        { zh: "首次访问或版本升级后，在工作台就绪且没有其他弹窗时显示本次更新；关闭或查看日志后不会重复打扰。", en: "After a first visit or version upgrade, the update appears once the workbench is ready and no other dialog is open, then stays dismissed after reading." },
        { zh: "管理员可在后台创建草稿，预览日志页和弹窗，再发布、撤回或关闭该版本的弹窗通知。", en: "Administrators can draft and preview page or dialog content, then publish, withdraw or disable its announcement." },
      ],
    },
    {
      kind: "improved",
      items: [
        { zh: "更新日志按正式、开发和本地环境隔离；草稿与已发布内容分开保存，编辑草稿不会提前改变用户看到的内容。", en: "Release notes are isolated by production, development and local environments, while drafts remain separate from public snapshots until publication." },
        { zh: "已读状态会在同一环境的标签页间同步；同版本文字修正、重新部署或版本回退不会再次弹窗。", en: "Read state syncs across tabs in the same environment, while same-version edits, redeployments and rollbacks do not repeat the announcement." },
      ],
    },
  ],
} satisfies ReleaseNote;
