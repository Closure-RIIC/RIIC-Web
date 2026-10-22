export type ReleaseText = { zh: string; en: string };
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
