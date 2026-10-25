import { useEffect, useState, type FormEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { KeyRound, Users, X, ArrowRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button } from "../ui/button";
import styles from "./DefenseJoinDialog.module.css";

export function DefenseJoinDialog({
  open,
  onOpenChange,
  server,
  onServerChange,
  busy,
  inTeam,
  error,
  onJoin,
  onLobby,
  initialCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: string;
  onServerChange: (server: string) => void;
  busy: boolean;
  inTeam: boolean;
  error: string;
  onJoin: (code: string) => Promise<boolean | undefined>;
  onLobby: () => void;
  initialCode?: string;
}) {
  const t = useTranslations("DefenseTeam");
  const [code, setCode] = useState("");
  useEffect(() => {
    if (!open) setCode("");
    else if (initialCode) setCode(initialCode);
  }, [open, initialCode]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim() || busy || inTeam) return;
    if (await onJoin(code.trim())) onOpenChange(false);
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.panel}>
          <div className={styles.stripe} />
          <header>
            <div>
              <small>ALLIANCE KEY</small>
              <Dialog.Title>{t("joinAlliance")}</Dialog.Title>
            </div>
            <Dialog.Close aria-label={t("closeJoin")} className={styles.close}>
              <X size={18} />
            </Dialog.Close>
          </header>
          <form onSubmit={submit}>
            <div
              className={styles.servers}
              role="group"
              aria-label={t("server")}
            >
              {(["official", "bilibili"] as const).map((value) => (
                <Button
                  key={value}
                  variant="ghost"
                  disabled={busy}
                  aria-pressed={server === value}
                  onClick={() => onServerChange(value)}
                >
                  {t(value)}
                </Button>
              ))}
            </div>
            <div className={styles.row}>
              <label>
                <KeyRound size={18} />
                <input
                  autoComplete="off"
                  aria-label={t("matchRoomCode")}
                  placeholder={t("joinCodePlaceholder")}
                  maxLength={64}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={busy || inTeam}
                />
              </label>
              <Button
                type="submit"
                className={styles.join}
                disabled={busy || inTeam || !code.trim()}
              >
                <Users size={17} />
                {t(busy ? "joiningTeam" : "joinAlliance")}
              </Button>
            </div>
            {error ? (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            ) : null}
            <Dialog.Description>
              {t(inTeam ? "joinExistingTeamHint" : "joinCodeHint")}
            </Dialog.Description>
          </form>
          <footer>
            <span>RIIC / ALLIANCE SERVICE</span>
            <Button variant="ghost" onClick={onLobby}>
              {t("browseTeams")}
              <ArrowRight size={14} />
            </Button>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
