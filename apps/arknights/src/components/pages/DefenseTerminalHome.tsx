import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "use-intl";
import {
  ArrowLeft,
  Users,
  Plus,
  UserRound,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Radio,
  Signal,
  KeyRound,
  Flag,
  Image as ImageIcon,
  BookOpen,
  Shield,
} from "lucide-react";
import { Button } from "../ui/button";
import { LanguageSwitch } from "../../i18n/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import styles from "./DefenseTerminalHome.module.css";

type Props = {
  accountName?: string;
  connection: "connected" | "connecting" | "connectionError";
  latency: number | null;
  roomCount: number;
  memberCount: number;
  roomTitle?: string;
  busy: boolean;
  pending: boolean;
  matchSummary: string;
  onLobby: (filters?: boolean) => void;
  onCreate: () => void;
  onJoin: () => void;
  onMyTeam: () => void;
  onQuick: () => void;
  onProfile: () => void;
};
const tipKeys = ["homeTipOne", "homeTipTwo", "homeTipThree"] as const;
function TerminalTool({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={9}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
export function DefenseTerminalHome(props: Props) {
  const t = useTranslations("DefenseTeam");
  const locale = useLocale();
  const [tip, setTip] = useState(0),
    [background, setBackground] = useState(true),
    [tipsOpen, setTipsOpen] = useState(false);
  const [homeReady, setHomeReady] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("riic:arknights:defense-home:v1") ?? "null",
      );
      if (saved && typeof saved === "object") {
        if (typeof saved.background === "boolean")
          setBackground(saved.background);
        if (typeof saved.tipsOpen === "boolean") setTipsOpen(saved.tipsOpen);
      }
    } catch {
      /* Display preferences are optional. */
    }
    setHomeReady(true);
  }, []);
  useEffect(() => {
    if (!homeReady) return;
    try {
      localStorage.setItem(
        "riic:arknights:defense-home:v1",
        JSON.stringify({ background, tipsOpen }),
      );
    } catch {
      /* Keep the current view usable without storage. */
    }
  }, [background, tipsOpen, homeReady]);
  return (
    <section
      className={styles.scene}
      lang={locale}
      data-background={background}
      aria-label={t("terminalHome")}
    >
      <div className={styles.backdrop} aria-hidden>
        <div className={styles.stars} />
        <div className={styles.horizon} />
        <img
          className={styles.land}
          src="/images/defense-reference/hub-land.svg"
          alt=""
        />
        <div className={styles.groundGrid} />
        <div className={styles.vignette} />
      </div>
      <header className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <a href="/" className={styles.returnLink} aria-label={t("back")}>
            <ArrowLeft size={15} />
            <span>{t("back")}</span>
          </a>
          <span className={styles.statusPill} title={t("latencyHint")}>
            <Signal size={13} />
            <b>{props.latency ?? "—"}</b>
            <small>ms</small>
          </span>
          <span className={styles.statusPill}>
            <Users size={13} />
            <b>{props.roomCount}</b>
            <small>{t("roomUnit")}</small>
          </span>
          <span className={styles.connection}>
            <Radio size={12} />
            {t(props.connection)}
          </span>
          <TooltipProvider delay={250}>
            <div className={styles.toolButtons}>
              <TerminalTool
                label={t("toggleBackground")}
                pressed={background}
                onClick={() => setBackground((value) => !value)}
              >
                <ImageIcon size={16} />
              </TerminalTool>
              <TerminalTool
                label={t("toggleTips")}
                pressed={tipsOpen}
                onClick={() => setTipsOpen((value) => !value)}
              >
                <BookOpen size={16} />
              </TerminalTool>
              <TerminalTool
                label={t("teamPreferences")}
                onClick={() => props.onLobby(true)}
              >
                <SlidersHorizontal size={16} />
              </TerminalTool>
            </div>
          </TooltipProvider>
          <div className={styles.language}>
            <LanguageSwitch />
          </div>
        </div>
        <Button
          variant="outline"
          className={styles.account}
          aria-label={`${t("profileTitle")}${props.accountName ? `: ${props.accountName}` : ""}`}
          onClick={props.onProfile}
          disabled={props.pending}
        >
          <span className={styles.accountAvatar}>
            <UserRound size={24} />
          </span>
          <span className={styles.accountCopy}>
            <strong>{props.accountName ?? t("profileTitle")}</strong>
            <small>RIIC // DOCTOR PROFILE</small>
          </span>
          <Signal size={15} />
        </Button>
      </header>
      <aside className={styles.leftRail}>
        <Button
          className={styles.mySquad}
          variant="outline"
          onClick={props.onMyTeam}
        >
          <span className={styles.squadBanner}>
            <Shield size={25} />
            <b>
              {props.memberCount}
              <small>/4</small>
            </b>
          </span>
          <span className={styles.squadLabel}>
            <strong>{t("myAlliance")}</strong>
            <small>{props.roomTitle ? t("joined") : t("homeNoTeam")}</small>
          </span>
        </Button>
        <Button
          variant="outline"
          className={styles.joinCard}
          onClick={props.onJoin}
        >
          <KeyRound size={23} />
          <span>
            <strong>{t("joinAlliance")}</strong>
            <small>ALLIANCE KEY</small>
          </span>
        </Button>
        {tipsOpen ? (
          <div className={styles.tipCard}>
            <div className={styles.tipHeading}>
              <Radio size={14} />
              <strong>{t("tacticalTips")}</strong>
              <small>
                {tip + 1}/{tipKeys.length.toString().padStart(2, "0")}
              </small>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t("previousTip")}
                onClick={() =>
                  setTip(
                    (value) => (value + tipKeys.length - 1) % tipKeys.length,
                  )
                }
              >
                <ChevronLeft size={13} />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t("nextTip")}
                onClick={() => setTip((value) => (value + 1) % tipKeys.length)}
              >
                <ChevronRight size={13} />
              </Button>
            </div>
            <p aria-live="polite">{t(tipKeys[tip])}</p>
          </div>
        ) : null}
      </aside>
      <div className={styles.center}>
        <div className={styles.radar} aria-hidden>
          <svg className={styles.radarGeometry} viewBox="-240 -240 480 480">
            <circle r="92" />
            <circle r="152" />
            <circle r="214" className={styles.radarTicks} />
            <path d="M-236 0H-176M176 0H236M0 -236V-176M0 176V236" />
          </svg>
          <div className={styles.radarSweep} />
          <span className={styles.emblemFrame}>
            <img src="/images/defense-reference/hub-emblem.svg" alt="" />
          </span>
        </div>
        <p className={styles.centerOverline}>
          STRONGHOLD <span>PROTOCOL</span>
        </p>
        <h1>{t("referenceHomeTitle")}</h1>
        <p className={styles.centerSubtitle}>{t("subtitle")}</p>
        {props.roomTitle ? (
          <Button
            className={styles.currentTeam}
            variant="outline"
            onClick={props.onMyTeam}
          >
            <Users size={14} />
            {props.roomTitle}
            <b>{props.memberCount}/4</b>
          </Button>
        ) : null}
      </div>
      <aside className={styles.rightRail}>
        <Button
          className={styles.whiteCard}
          onClick={props.memberCount ? props.onMyTeam : props.onCreate}
          disabled={props.busy || props.pending}
        >
          {props.memberCount ? <Users size={24} /> : <Plus size={24} />}
          <strong>
            {t(props.memberCount ? "viewAlliance" : "createAlliance")}
          </strong>
          <small>{props.memberCount ? "SQUAD" : "CREATE"}</small>
        </Button>
        <Button
          className={styles.whiteCard}
          onClick={props.onProfile}
          disabled={props.pending}
        >
          <Flag size={23} />
          <strong>{t("factionProfile")}</strong>
          <small>PROFILE</small>
        </Button>
        <Button
          className={styles.darkCard}
          variant="outline"
          onClick={() => props.onLobby(true)}
        >
          <SlidersHorizontal size={22} />
          <span>
            <strong>{t("teamPreferences")}</strong>
            <small>MATCH FILTERS</small>
          </span>
        </Button>
      </aside>
      <nav className={styles.actions} aria-label={t("terminalActions")}>
        <Button
          variant="outline"
          className={styles.actionCard}
          onClick={() => props.onLobby()}
        >
          <span className={styles.actionCaption}>ALLIANCE LOBBY</span>
          <strong>{t("lobby")}</strong>
          <Users className={styles.actionIcon} />
        </Button>
        <Button
          variant="outline"
          className={styles.actionCard}
          disabled={props.busy || props.pending}
          onClick={props.memberCount ? props.onProfile : props.onCreate}
        >
          <span className={styles.actionCaption}>
            {props.memberCount ? "FACTION PROFILE" : "ALLIANCE ASSEMBLY"}
          </span>
          <strong>
            {t(props.memberCount ? "factionProfile" : "createAlliance")}
          </strong>
          {props.memberCount ? (
            <Flag className={styles.actionIcon} />
          ) : (
            <Plus className={styles.actionIcon} />
          )}
        </Button>
        <Button
          variant="outline"
          className={styles.actionCard}
          data-primary
          disabled={props.busy || props.pending}
          onClick={props.memberCount ? props.onMyTeam : props.onQuick}
        >
          <span className={styles.actionCaption}>
            {props.memberCount ? "ALLIANCE TERMINAL" : "ALLIANCE MATCHMAKING"}
          </span>
          <strong>{t(props.memberCount ? "returnAlliance" : "quick")}</strong>
          <span className={styles.actionDetail}>
            {props.memberCount
              ? t("homeMemberCount", { count: props.memberCount })
              : props.matchSummary}
          </span>
          <Signal className={styles.actionIcon} />
        </Button>
      </nav>
      <footer className={styles.footer}>
        <span>RIIC / TACTICAL CO-OP SERVICE</span>
        <span>4-PLAYER TEAM FINDER</span>
      </footer>
    </section>
  );
}
