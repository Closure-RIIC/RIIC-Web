import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { createPlatformClient } from "@riic/platform/client";
import {
  type DefenseFaction,
  type DefensePortrait,
  type DefenseProfile,
  validCoreBondSelection,
} from "../../defense-team-validation";
import { Button } from "../ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../ui/card";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import { Check, LoaderCircle, ShieldCheck, UserRound } from "lucide-react";
import styles from "./DefenseProfileEditor.module.css";
import { DefensePortraitPicker } from "./DefensePortraitPicker";
import { DefenseBondPicker } from "./DefenseBondPicker";

const api = createPlatformClient();
export function DefenseProfileEditor({
  onSaved,
  embedded = false,
}: {
  onSaved?: () => void;
  embedded?: boolean;
}) {
  const t = useTranslations("DefenseTeam");
  const [profile, setProfile] = useState<DefenseProfile | null>(null);
  const [portrait, setPortrait] = useState<DefensePortrait>("default");
  const [selected, setSelected] = useState<DefenseFaction[]>([]);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const saveRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api
      .request<{ profile: DefenseProfile }>("/api/defense-team", {
        signal: controller.signal,
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setProfile(data.profile);
        setPortrait(data.profile.portrait ?? "default");
        setSelected(data.profile.favoriteFactions);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : t("error"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      saveRequest.current?.abort();
    };
  }, [t]);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saved]);
  async function save() {
    if (!profile || saveRequest.current) return;
    if (!validCoreBondSelection(selected)) {
      setError(t("coreSelectionRequired"));
      return;
    }
    const controller = new AbortController();
    saveRequest.current = controller;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const data = await api.request<{ profile: DefenseProfile }>(
        "/api/defense-team",
        {
          signal: controller.signal,
          body: {
            action: "profile",
            profileOwner: profile.id,
            favoriteFactions: selected,
            portrait,
          },
        },
      );
      if (!controller.signal.aborted) {
        setProfile(data.profile);
        setPortrait(data.profile.portrait ?? "default");
        setSelected(data.profile.favoriteFactions);
        setSaved(true);
        onSaved?.();
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : t("error"));
    } finally {
      if (saveRequest.current === controller) {
        saveRequest.current = null;
        setSaving(false);
      }
    }
  }
  const unchanged =
    !!profile &&
    portrait === (profile.portrait ?? "default") &&
    JSON.stringify([...selected].sort()) ===
      JSON.stringify([...profile.favoriteFactions].sort());
  return (
    <Card
      className={`${styles.editor} ${embedded ? styles.embedded : ""}`}
      data-defense-profile
    >
      <CardHeader className={styles.identity}>
        <span className={styles.avatar} aria-hidden>
          <UserRound size={26} />
        </span>
        <div className={styles.identityCopy}>
          <div className={styles.eyebrow}>DOCTOR PROFILE</div>
          <CardTitle className={styles.name} title={profile?.name}>
            {profile?.name ?? t("profileLoading")}
          </CardTitle>
          <CardDescription className={styles.description}>
            {t("profileIdentityHint")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <DefensePortraitPicker value={portrait} disabled={loading || saving || !profile}
          onChange={(value) => { setPortrait(value); setSaved(false); }} />
        <div className={styles.sectionHeading}>
          <h3>{t("favoriteFactions")}</h3>
          <Badge variant="secondary">
            {t("selectedFactionCount", { count: selected.length })}
          </Badge>
        </div>
        <p className={styles.hint}>{t("factionHint")}</p>
        {loading ? (
          <p
            role="status"
            className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"
          >
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            {t("profileLoading")}
          </p>
        ) : null}
        <DefenseBondPicker
          enforceCoreBounds
          value={selected}
          disabled={loading || saving || !profile}
          onChange={(value) => {
            setSelected(value);
            setSaved(false);
          }}
        />
        <div className={styles.summary} aria-live="polite">
          {selected.length ? (
            selected.map((faction) => (
              <Badge key={faction} variant="outline">
                {t(`faction_${faction}`)}
              </Badge>
            ))
          ) : (
            <span className={styles.emptySelection}>{t("noFactions")}</span>
          )}
        </div>
        {error ? (
          <Alert variant="destructive" className={styles.error}>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {saved ? (
          <p role="status" className={styles.saved}>
            <Check size={15} />
            {t("profileSaved")}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className={styles.footer}>
        <span className={styles.saveHint}>
          <ShieldCheck size={14} />
          {t("profileSaveHint")}
        </span>
        <div className={styles.actions}>
          <Button
            variant="ghost"
            disabled={loading || saving || !profile || !selected.length}
            onClick={() => {
              setSelected([]);
              setSaved(false);
            }}
          >
            {t("clearFactions")}
          </Button>
          <Button
            disabled={
              loading ||
              saving ||
              !profile ||
              unchanged ||
              !validCoreBondSelection(selected)
            }
            onClick={() => void save()}
          >
            {saving ? (
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Check className="size-4" />
            )}
            {saving ? t("profileSaving") : t("saveProfile")}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
