import type { AppLocale } from "../i18n/config.ts";

export type ReleaseText = { zh: string; en: string; tw?: string };
/** Older published/user-authored releases retain their original source text. */
export function releaseText(text: ReleaseText, locale: AppLocale): string {
  return (locale === "zh-TW" ? text.tw : locale === "en" ? text.en : text.zh) || text.zh;
}
export type ReleaseSection = {
  kind: "added" | "improved" | "fixed";
  items: ReleaseText[];
};

export type ReleaseNote = {
  version: string;
  date: string;
  title: ReleaseText;
  sections: ReleaseSection[];
};

export type ReleaseEnvironment = "production" | "development" | "local";
export type ReleaseDraft = ReleaseNote & { notify: boolean };
export type ReleaseFeed = { environment: ReleaseEnvironment; releases: ReleaseDraft[] };
export type AdminRelease = {
  id: string;
  draft: ReleaseDraft;
  published: ReleaseDraft | null;
  firstPublishedAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  revision: number;
};
export type AdminReleaseList = { environment: ReleaseEnvironment; releases: AdminRelease[] };
