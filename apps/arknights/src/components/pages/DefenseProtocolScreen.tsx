import type { CSSProperties } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useTranslations } from "use-intl";
import {
  TEAM_DIFFICULTIES,
  type TeamPreferences,
} from "../../defense-team-validation";
import reference from "./defense-protocol-reference.json";
import "./DefenseProtocolScreen.css";

/** Fixed, reviewed visual markup captured from the reference site; never user HTML. */
export function DefenseProtocolScreen({
  value,
  onChange,
  onContinue,
  onBack,
  mode = "create",
  onPreferences,
  busy = false,
  disabled = false,
  error,
}: {
  value: TeamPreferences["difficulty"];
  onChange: (value: TeamPreferences["difficulty"]) => void;
  onContinue: () => void;
  onBack: () => void;
  mode?: "create" | "match";
  onPreferences?: () => void;
  busy?: boolean;
  disabled?: boolean;
  error?: string;
}) {
  const t = useTranslations("DefenseTeam");
  const index = Math.max(
    0,
    TEAM_DIFFICULTIES.findIndex((level) => level === value),
  );
  const snapshot = reference[index];
  const shared = reference[0];
  return (
    <div
      className="proto"
      style={{ "--d-color": shared.cards![index].color } as CSSProperties}
    >
      <div className="proto__bg" aria-hidden />
      <header className="proto-top">
        <button
          type="button"
          className="proto-back"
          aria-label={t("protocolBack")}
          onClick={onBack}
          dangerouslySetInnerHTML={{ __html: shared.back! }}
        />
        <div className="proto-title">
          <Dialog.Title>{t("protocolTitle")}</Dialog.Title>
          <span className="proto-title__mode">
            {t(mode === "match" ? "protocolMatchMode" : "protocolMode")}
            <i>
              {mode === "match"
                ? "ALLIANCE MATCHMAKING"
                : "ALLIANCE SIMULATION"}
            </i>
          </span>
        </div>
      </header>
      <Dialog.Description className="sr-only">
        {t(mode === "match" ? "protocolMatchBrief" : "createHint")}
      </Dialog.Description>
      <div className="proto-body">
        <section className="proto-stage">
          <div
            aria-hidden
            dangerouslySetInnerHTML={{ __html: snapshot.stage }}
          />
          <div className="proto-brief">
            <span className="proto-brief__code num">AC-{index + 1}</span>
            <b className="proto-brief__name">
              {t(`difficulty_${TEAM_DIFFICULTIES[index]}`).replace(
                /^AC-\d\s*·\s*/,
                "",
              )}
            </b>
            <p>
              {t(
                mode === "match" ? "protocolMatchBrief" : "protocolCreateBrief",
              )}
            </p>
          </div>
        </section>
        <div className="proto-side">
          <div
            className="proto-list"
            role="group"
            aria-label={t("difficultyLabel")}
          >
            {TEAM_DIFFICULTIES.map((level, i) => (
              <button
                key={level}
                type="button"
                className={`pcard${index === i ? " is-on" : ""}`}
                aria-pressed={index === i}
                aria-label={t(`difficulty_${level}`)}
                style={{ "--d-color": shared.cards![i].color } as CSSProperties}
                onClick={() => onChange(level)}
                disabled={busy}
                dangerouslySetInnerHTML={{ __html: shared.cards![i].html }}
              />
            ))}
          </div>
          <footer className="proto-foot">
            {error ? (
              <p role="alert" className="proto-error">
                {error}
              </p>
            ) : null}
            <div className="proto-opts">
              <p className="proto-hint">
                {t(
                  mode === "match" ? "protocolMatchHint" : "protocolCreateHint",
                )}
              </p>
              {onPreferences ? (
                <button
                  type="button"
                  className="proto-preferences"
                  disabled={busy}
                  onClick={onPreferences}
                >
                  {t("bondMatchSettings")}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="proto-start"
              onClick={onContinue}
              disabled={busy || disabled}
              dangerouslySetInnerHTML={{
                __html:
                  mode === "match"
                    ? shared.start!.replace(
                        "创建同盟",
                        t(busy ? "matchSearching" : "matchNow"),
                      )
                    : shared.start!.replace("创建同盟", t("createMatchRoom")),
              }}
            />
          </footer>
        </div>
      </div>
    </div>
  );
}
