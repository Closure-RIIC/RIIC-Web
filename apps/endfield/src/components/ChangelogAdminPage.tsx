import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useBlocker } from "@tanstack/react-router";
import { Action, Notice, PageTitle, Section } from "@riic/endfield-ui";
import { APP_LOCALES, LOCALE_LABELS, type AppLocale } from "@riic/contracts/locale";
import { releaseText, type AdminRelease, type AdminReleaseList, type ReleaseDraft, type ReleaseText } from "@riic/arknights-domain/releases/types";
import { parseReleaseDraft, RELEASE_KINDS, RELEASE_LIMITS } from "@riic/arknights-domain/releases/validation";
import { useAccount } from "../account";
import { useWorkspace } from "../state";
import { ReleaseRequestError, requestReleases } from "../releases";
import { ReleaseEntry, releaseKindLabels } from "./ReleaseEntry";
import "./ChangelogAdminPage.css";

const api = "/api/endfield/admin/releases";
const languageFields = { "zh-CN": "zh", "zh-TW": "tw", en: "en" } as const;
const environmentLabels = { production: "ChangelogAdmin.production", development: "ChangelogAdmin.development", local: "ChangelogAdmin.local" } as const;
const errorLabels = { denied: "ChangelogAdmin.accessDenied", conflict: "ChangelogAdmin.conflict", invalid: "ChangelogAdmin.invalid", failed: "ChangelogAdmin.requestFailed" } as const;
const messageLabels = { saved: "ChangelogAdmin.saved", updated: "ChangelogAdmin.updated" } as const;
function emptyDraft(): ReleaseDraft {
  return { version: "", date: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), title: { zh: "", en: "", tw: "" },
    notify: false, sections: [{ kind: "added", items: [{ zh: "", en: "", tw: "" }] }] };
}
function errorKey(cause: unknown) {
  return cause instanceof ReleaseRequestError && [401, 403].includes(cause.status) ? "denied"
    : cause instanceof ReleaseRequestError && [404, 409].includes(cause.status) ? "conflict"
    : cause instanceof ReleaseRequestError && cause.status === 400 ? "invalid"
    : "failed";
}

export function ChangelogAdminPage() {
  const { session, pending } = useAccount();
  const { t } = useWorkspace();
  return <div className="ef-page ef-document" data-endfield-changelog-admin>
    <PageTitle title={t("Navigation.changelogAdmin")} subtitle={t("ChangelogAdmin.description")}
      action={<Link to="/changelog" className="text-sm underline">{t("ChangelogAdmin.viewPublic")}</Link>} />
    {pending ? <Notice>{t("Changelog.loading")}</Notice> : session ? <ChangelogManager key={session.user.id} /> : <Notice error>{t("ChangelogAdmin.accessDenied")}</Notice>}
  </div>;
}

function ChangelogManager() {
  const { locale, t } = useWorkspace();
  const [data, setData] = useState<AdminReleaseList | null>(null);
  const [selected, setSelected] = useState<AdminRelease | null>(null);
  const [draft, setDraft] = useState<ReleaseDraft>(emptyDraft);
  const [initial, setInitial] = useState(() => JSON.stringify(draft));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof errorLabels | "">("");
  const [message, setMessage] = useState<keyof typeof messageLabels | "">("");
  const [language, setLanguage] = useState<AppLocale>("zh-CN");
  const [preview, setPreview] = useState(false);
  const pending = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const dirty = JSON.stringify(draft) !== initial;
  const field = languageFields[language];
  useBlocker({ shouldBlockFn: () => busy || (dirty && !window.confirm(t("ChangelogAdmin.discardConfirm"))), enableBeforeUnload: dirty || busy });

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true); setError("");
    try {
      const next = await requestReleases<AdminReleaseList>(api, { signal: controller.signal });
      if (!controller.signal.aborted) setData(next);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(errorKey(cause));
        if (cause instanceof ReleaseRequestError && [401, 403].includes(cause.status)) setData(null);
      }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => loadController.current?.abort(); }, [load]);

  function edit(record: AdminRelease | null) {
    const next = record ? structuredClone(record.draft) : emptyDraft();
    setSelected(record); setDraft(next); setInitial(JSON.stringify(next)); setPreview(false); setError(""); setMessage("");
  }
  function choose(record: AdminRelease | null) {
    if (pending.current || (dirty && !window.confirm(t("ChangelogAdmin.discardConfirm")))) return;
    edit(record);
  }
  function updateRecord(record: AdminRelease | null) {
    setData(current => current ? { ...current, releases: record ? [record, ...current.releases.filter(entry => entry.id !== record.id)]
      : current.releases.filter(entry => entry.id !== selected?.id) } : current);
    edit(record);
  }
  async function save() {
    if (pending.current) return;
    let value: ReleaseDraft;
    try { value = parseReleaseDraft(draft); } catch { setError("invalid"); return; }
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestReleases<{ release: AdminRelease }>(selected ? `${api}/${selected.id}` : api, {
        method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected ? { action: "save", revision: selected.revision, draft: value } : value),
      });
      updateRecord(result.release); setMessage("saved");
    } catch (cause) { setError(errorKey(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function mutate(action: "publish" | "withdraw" | "delete") {
    if (!selected || dirty || pending.current) return;
    const confirmations = { publish: "ChangelogAdmin.publishConfirm", withdraw: "ChangelogAdmin.withdrawConfirm", delete: "ChangelogAdmin.deleteConfirm" } as const;
    if (!window.confirm(t(confirmations[action]))) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestReleases<{ release: AdminRelease | null }>(`${api}/${selected.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, revision: selected.revision }),
      });
      updateRecord(result.release); setMessage("updated");
    } catch (cause) { setError(errorKey(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  function setTitle(value: string) { setDraft(current => ({ ...current, title: { ...current.title, [field]: value } })); }
  function setItem(kind: typeof RELEASE_KINDS[number], index: number, value: string) {
    setDraft(current => ({ ...current, sections: current.sections.map(section => section.kind !== kind ? section : {
      ...section, items: section.items.map((item, i) => i === index ? { ...item, [field]: value } : item),
    }) }));
  }
  function addItem(kind: typeof RELEASE_KINDS[number]) {
    setDraft(current => {
      const section = current.sections.find(entry => entry.kind === kind);
      if (section && section.items.length >= RELEASE_LIMITS.itemsPerSection) return current;
      const item: ReleaseText = { zh: "", en: "", tw: "" };
      return { ...current, sections: section ? current.sections.map(entry => entry.kind === kind ? { ...entry, items: [...entry.items, item] } : entry)
        : [...current.sections, { kind, items: [item] }] };
    });
  }
  function removeItem(kind: typeof RELEASE_KINDS[number], index: number) {
    setDraft(current => ({ ...current, sections: current.sections.map(section => section.kind === kind ? { ...section, items: section.items.filter((_, i) => i !== index) } : section)
      .filter(section => section.items.length) }));
  }

  return <>
    {error ? <Notice error>{t(errorLabels[error])}</Notice> : null}
    {message ? <Notice>{t(messageLabels[message])}</Notice> : null}
    <div className="ef-release-toolbar">
      {data ? <span className="ef-muted">{t(environmentLabels[data.environment])}</span> : null}
      <Action size="sm" disabled={loading || busy} onClick={() => void load()}>{t("Changelog.retry")}</Action>
      <Action variant="yellow" size="sm" disabled={!data || busy} onClick={() => choose(null)}>{t("ChangelogAdmin.new")}</Action>
    </div>
    {loading && !data ? <Notice>{t("Changelog.loading")}</Notice> : null}
    {data ? <div className="ef-release-layout">
      <section className="ef-release-list" aria-label={t("ChangelogAdmin.list")}>
        {!data.releases.length ? <Notice>{t("ChangelogAdmin.empty")}</Notice> : data.releases.map(record => <button type="button" key={record.id}
          disabled={busy || loading} aria-pressed={selected?.id === record.id} onClick={() => choose(record)}>
          <span className="font-semibold">v{record.draft.version}</span>
          <span className="ef-muted">{t(record.published ? "ChangelogAdmin.published" : record.firstPublishedAt ? "ChangelogAdmin.withdrawn" : "ChangelogAdmin.draft")}</span>
          <span>{releaseText(record.draft.title, locale)}</span>
          {record.published && JSON.stringify(record.draft) !== JSON.stringify(record.published) ? <small>{t("ChangelogAdmin.unpublished")}</small> : null}
        </button>)}
      </section>
      <form className="ef-release-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy || loading}>
          <legend className="mb-3 font-semibold">{t(selected ? "ChangelogAdmin.edit" : "ChangelogAdmin.new")}</legend>
          <div className="ef-release-meta">
            <label>{t("ChangelogAdmin.version")}<input required pattern="(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})" placeholder="0.1.0"
              readOnly={Boolean(selected?.firstPublishedAt)} value={draft.version} onChange={event => setDraft(current => ({ ...current, version: event.target.value }))} /></label>
            <label>{t("ChangelogAdmin.date")}<input required type="date" value={draft.date} onChange={event => setDraft(current => ({ ...current, date: event.target.value }))} /></label>
          </div>
          <div className="ef-release-toolbar" role="group" aria-label={t("ChangelogAdmin.contentLanguage")}>
            {APP_LOCALES.map(value => <Action size="sm" key={value} aria-pressed={language === value} variant={language === value ? "dark" : "white"}
              onClick={() => setLanguage(value)}>{LOCALE_LABELS[value]}</Action>)}
          </div>
          <p className="ef-muted mb-3">{t("ChangelogAdmin.translationHint")}</p>
          <label>{t("ChangelogAdmin.title")}<input maxLength={RELEASE_LIMITS.title} required={field === "zh"} value={draft.title[field] ?? ""} onChange={event => setTitle(event.target.value)} /></label>
          {RELEASE_KINDS.map(kind => {
            const items = draft.sections.find(section => section.kind === kind)?.items ?? [];
            return <Section key={kind} title={t(releaseKindLabels[kind])} actions={<Action size="sm" disabled={items.length >= RELEASE_LIMITS.itemsPerSection} onClick={() => addItem(kind)}>{t("ChangelogAdmin.add")}</Action>}>
              {items.map((item, index) => <div className="ef-release-item" key={index}>
                <label><span>{t(releaseKindLabels[kind])} {index + 1}</span><textarea rows={2} required={field === "zh"} maxLength={RELEASE_LIMITS.item}
                  value={item[field] ?? ""} onChange={event => setItem(kind, index, event.target.value)} /></label>
                <Action size="sm" onClick={() => removeItem(kind, index)} aria-label={`${t("ChangelogAdmin.remove")} ${t(releaseKindLabels[kind])} ${index + 1}`}>{t("ChangelogAdmin.remove")}</Action>
              </div>)}
            </Section>;
          })}
          <div className="ef-release-toolbar">
            <Action type="submit" variant="yellow">{t(busy ? "ChangelogAdmin.saving" : "ChangelogAdmin.save")}</Action>
            <Action onClick={() => setPreview(value => !value)} aria-expanded={preview}>{t("ChangelogAdmin.preview")}</Action>
            {selected ? <>
              <Action disabled={dirty} onClick={() => void mutate("publish")}>{t("ChangelogAdmin.publish")}</Action>
              {selected.published ? <Action disabled={dirty} onClick={() => void mutate("withdraw")}>{t("ChangelogAdmin.withdraw")}</Action> : null}
              {!selected.firstPublishedAt ? <Action variant="red" disabled={dirty} onClick={() => void mutate("delete")}>{t("ChangelogAdmin.delete")}</Action> : null}
            </> : null}
          </div>
          <p className="ef-muted">{t("ChangelogAdmin.saveHint")}</p>
        </fieldset>
        {preview ? <div className="ef-release-preview"><h2 className="font-semibold">{t("ChangelogAdmin.preview")} · {LOCALE_LABELS[language]}</h2><ReleaseEntry release={draft} locale={language} /></div> : null}
      </form>
    </div> : null}
  </>;
}
