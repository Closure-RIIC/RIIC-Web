import { defensePortraitUrl } from "../../defense-team-validation";
import { useState, useRef, type CSSProperties } from "react";
import { X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  TEAM_DIFFICULTIES,
  DEFENSE_CORE_BONDS,
  coreBondCount,
  type TeamPreferences,
} from "../../defense-team-validation";
import type { DefenseRoom } from "../../defense-team-types";
import icons from "./defense-waiting-icons.json";
import { DefenseBondPicker } from "./DefenseBondPicker";
import { DefenseFactionIcon } from "./DefenseFactionIcon";
import modal from "./DefenseTeamPage.module.css";
import "./DefenseWaitingRoom.css";

function Icon({
  name,
  className = "icon",
}: {
  name: keyof typeof icons;
  className?: string;
}) {
  const icon = icons[name];
  return (
    <svg
      className={className}
      width="1em"
      height="1em"
      viewBox={icon.viewBox ?? "0 0 24 24"}
      aria-hidden
      focusable="false"
      dangerouslySetInnerHTML={{ __html: icon.paths }}
    />
  );
}
const modeIcons = [
  "mode_funny_icon.png",
  "mode_normal_icon.png",
  "mode_hard_icon.png",
  "mode_abyss_icon.png",
];
const colors = ["#f6a329", "#e85a1a", "#e73118", "#ff0024"];

export function DefenseWaitingRoom({
  room,
  busy,
  error,
  message,
  latency,
  onReady,
  onStart,
  onLeave,
  onDifficulty,
  onProfile,
  onLobby,
  onRefresh,
  onCopy,
  onCopyLink,
  onCopyGame,
  onGameCode,
}: {
  room: DefenseRoom;
  busy: boolean;
  error: string;
  latency: number | null;
  message?: string;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => Promise<boolean | undefined>;
  onDifficulty: (difficulty: TeamPreferences["difficulty"]) => void;
  onProfile: () => void;
  onLobby: () => void;
  onRefresh: () => void;
  onCopy: () => void;
  onCopyLink: () => void;
  onCopyGame: () => void;
  onGameCode: (code: string) => Promise<boolean | undefined>;
}) {
  const t = useTranslations("DefenseTeam");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [viewedMember, setViewedMember] = useState<
    DefenseRoom["members"][number] | null
  >(null);
  const bondCloseRef = useRef<HTMLButtonElement>(null);
  const [editCodeOpen, setEditCodeOpen] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");
  const gameCodeInput = useRef<HTMLInputElement>(null);
  const me = room.members.find((m) => m.isMe);
  const ready = room.members.filter((m) => m.isHost || m.isReady).length;
  const started = room.status === "started";
  const index = Math.max(
    0,
    TEAM_DIFFICULTIES.findIndex((d) => d === room.difficulty),
  );
  const canStart =
    room.members.length === 4 && ready === 4 && !!room.roomCode && !started;
  const status = started
    ? t("waitingStartedHint")
    : room.members.length < 4
      ? t("waitingSeatsHint", { count: 4 - room.members.length })
      : ready < 4
        ? t("waitingReadyHint")
        : !room.roomCode
          ? t("waitingGameCodeRequired")
          : t(room.isHost ? "waitingCanStart" : "waitingAwaitHost");
  return (
    <>
      <div className="app-bg" aria-hidden />
      <div className="screen room-screen room-screen--coop">
        <header className="topbar">
          <div className="topbar__left">
            <button
              className="btn btn--danger btn--lg btn--square"
              type="button"
              disabled={busy}
              aria-label={t("waitingLeave")}
              onClick={() => setConfirmLeave(true)}
            >
              <Icon name="leave" className="icon btn__icon" />
            </button>
            <div className="room-ping">
              <div className="connection-status">
                <span className="ping" title={t("latencyHint")}>
                  <Icon name="signal" className="icon ping__icon" />
                  <span className="ping__value">{latency ?? "—"}</span>
                  <span className="ping__unit">ms</span>
                </span>
                <span className="ping online-count">
                  <Icon name="user" className="icon ping__icon" />
                  <span className="ping__value num">
                    {room.members.length}/4
                  </span>
                  <span className="ping__unit">{t("waitingMembers")}</span>
                </span>
              </div>
              <span className="micro">{t("waitingSync")}</span>
            </div>
            <div className="room-topbar__tools">
              <button
                type="button"
                className="btn btn--secondary btn--sm btn--square"
                aria-label={t("refresh")}
                disabled={busy}
                onClick={onRefresh}
              >
                <Icon name="signal" className="icon btn__icon" />
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm btn--square"
                aria-label={t("lobby")}
                onClick={onLobby}
              >
                <Icon name="stats" className="icon btn__icon" />
              </button>
            </div>
          </div>
          <div className="topbar__center">
            <span className="micro micro--mint">ALLIANCE LOBBY</span>
            <Dialog.Title className="topbar__title">
              {t("waitingAlliance")}
              <span className="topbar__sep" />
              <span
                className="dtag dtag--lg"
                style={{ "--d-color": colors[index] } as CSSProperties}
              >
                <img
                  className="icon dicon dtag__icon"
                  src={`/images/defense-reference/${modeIcons[index]}`}
                  alt=""
                />
                <span className="dtag__name">
                  {t(`difficulty_${room.difficulty}`).replace(
                    /^AC-\d\s*·\s*/,
                    "",
                  )}
                </span>
              </span>
            </Dialog.Title>
            <span className="waiting-room-title">{room.title}</span>
          </div>
          <div className="topbar__right">
            <div className="invite brackets">
              <div className="invite__label">
                <Icon name="key" />
                <span>{t("waitingKey")}</span>
                <span className="micro">ALLIANCE KEY</span>
              </div>
              {room.inviteCode.length <= 8 ? (
                <div
                  className="invite__code num selectable"
                  aria-label={`${t("matchRoomCode")} ${room.inviteCode}`}
                >
                  {[...room.inviteCode].map((char, i) => (
                    <span key={i}>{char}</span>
                  ))}
                </div>
              ) : (
                <div className="waiting-long-code">{room.inviteCode}</div>
              )}
              <div className="invite__btns">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={onCopy}
                >
                  <Icon name="copy" className="icon btn__icon" />
                  <span className="btn__label">{t("waitingCopyKey")}</span>
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={onCopyLink}
                >
                  <Icon name="link" className="icon btn__icon" />
                  <span className="btn__label">{t("waitingCopyLink")}</span>
                </button>
              </div>
            </div>
          </div>
        </header>
        <Dialog.Description className="sr-only">
          {t("waitingDescription")}
        </Dialog.Description>
        {error ? (
          <p className="waiting-error" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="waiting-notice" role="status">
            {message}
          </p>
        ) : null}
        <main className="seats">
          {Array.from({ length: 4 }, (_, seat) => {
            const member = room.members.find((m) => m.seat === seat);
            const isReady = !!member && (member.isHost || member.isReady);
            return (
              <article
                key={seat}
                className={`rseat${member ? `${isReady ? " is-ready" : ""}${member.isMe ? " is-me" : ""}${member.isHost ? " is-host" : ""}` : " rseat--empty"}`}
                style={{ "--i": seat } as CSSProperties}
                aria-label={t("waitingSeat", { seat: seat + 1 })}
              >
                <span className="rseat__clip" aria-hidden />
                <header className="rseat__strip">
                  <i />
                  <span className="num">P{seat + 1}</span>
                </header>
                <div className="rseat__art">
                  {member ? (
                    <>
                      <img
                        src={defensePortraitUrl(member.portrait, seat)}
                        alt=""
                        draggable={false}
                      />
                      {member.isHost ? (
                        <span className="rseat__host">
                          {t("waitingCreator")}
                        </span>
                      ) : null}
                      <span className="rseat__state">
                        <span className="rseat__box">
                          {isReady ? <Icon name="check" /> : null}
                        </span>
                        {t(
                          member.isHost
                            ? "waitingStandby"
                            : member.isReady
                              ? "waitingReady"
                              : "waitingPreparing",
                        )}
                      </span>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="rseat__invite"
                        onClick={onCopy}
                        title={t("waitingInviteHint")}
                      >
                        <span className="rseat__plus" aria-hidden />
                        <b>{t("waitingInvite")}</b>
                        <small>{t("waitingInviteHint")}</small>
                      </button>
                      <span className="rseat__noinfo" aria-hidden>
                        NOINFO
                      </span>
                    </>
                  )}
                </div>
                {member ? (
                  <div className="rseat__plate">
                    {member.isMe ? (
                      <span className="rseat__me" title={t("me")}>
                        <Icon name="info" />
                      </span>
                    ) : null}
                    <div
                      className="avatar avatar--sm brackets"
                      style={{ "--seat-hue": 162 + seat * 34 } as CSSProperties}
                    >
                      <div className="avatar__img">
                        <span className="avatar__glyph">
                          {[...member.name][0]}
                        </span>
                      </div>
                    </div>
                    <span className="rseat__who">
                      <b className="rseat__name" title={member.name}>
                        {member.name}
                      </b>
                    </span>
                    <button
                      type="button"
                      className="rseat__doc waiting-member-bonds"
                      onClick={() => setViewedMember(member)}
                      title={t("waitingViewBonds", { name: member.name })}
                      aria-label={t("waitingViewBonds", { name: member.name })}
                    >
                      {member.favoriteFactions
                        .filter((b) =>
                          (DEFENSE_CORE_BONDS as readonly string[]).includes(b),
                        )
                        .slice(0, 4)
                        .map((bond) => (
                          <DefenseFactionIcon key={bond} faction={bond} />
                        ))}
                      <span>
                        {t("waitingBondSummary", {
                          count: coreBondCount(member.favoriteFactions),
                        })}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="rseat__plate rseat__plate--empty rseat__actions">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm btn--block"
                      onClick={onCopyLink}
                    >
                      <Icon name="link" className="icon btn__icon" />
                      <span className="btn__label">{t("waitingCopyLink")}</span>
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </main>
        <section className="waiting-game-code" aria-label={t("roomCode")}>
          <div className="waiting-game-code__label">
            <span className="micro">GAME ROOM</span>
            <strong>{t("roomCode")}</strong>
          </div>
          <div className="waiting-game-code__value">
            {room.roomCode ? (
              <code>{room.roomCode}</code>
            ) : (
              <span className="t-lo">{t("gameCodePending")}</span>
            )}
            <small>
              {room.note
                ? t("matchRoomNote", { note: room.note })
                : t("gameCodeVisibility")}
            </small>
          </div>
          {room.roomCode ? (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              onClick={onCopyGame}
            >
              <Icon name="copy" className="icon btn__icon" />
              {t("copyGameCode")}
            </button>
          ) : null}
          {room.isHost ? (
            <button
              type="button"
              className="btn btn--secondary btn--lg"
              disabled={busy}
              onClick={() => {
                setCodeDraft(room.roomCode ?? "");
                setEditCodeOpen(true);
              }}
            >
              {t(room.roomCode ? "editGameCode" : "publishGameCode")}
            </button>
          ) : null}
        </section>
        <footer className="room-bar">
          <div className="room-bar__left">
            <span className="room-bar__label">
              {t("difficultyLabel")}
              <span className="micro">DIFFICULTY</span>
            </span>
            {room.isHost ? (
              <div
                className="dpick"
                role="radiogroup"
                aria-label={t("difficultyLabel")}
              >
                {TEAM_DIFFICULTIES.map((difficulty, i) => (
                  <button
                    key={difficulty}
                    type="button"
                    role="radio"
                    aria-checked={room.difficulty === difficulty}
                    className={`dpick__opt${room.difficulty === difficulty ? " is-active" : ""}`}
                    style={{ "--d-color": colors[i] } as CSSProperties}
                    disabled={busy || started}
                    onClick={() => onDifficulty(difficulty)}
                  >
                    <img
                      className="icon dicon"
                      src={`/images/defense-reference/${modeIcons[i]}`}
                      alt=""
                    />
                    {t(`waitingDifficulty_${difficulty}`)}
                  </button>
                ))}
              </div>
            ) : (
              <div className="dpick dpick--ro">
                <span
                  className="dtag"
                  style={{ "--d-color": colors[index] } as CSSProperties}
                >
                  {t(`difficulty_${room.difficulty}`)}
                </span>
                <span className="t-dim">{t("waitingHostChooses")}</span>
              </div>
            )}
          </div>
          <div className="room-bar__center">
            <div className="ready-count">
              <span className="t-lo">{t("waitingReady")}</span>
              <b className="num">{ready}</b>
              <span className="num t-dim">/{room.members.length}</span>
              <span className="ready-count__icons" aria-hidden>
                {room.members.map((m) => (
                  <Icon
                    key={m.seat}
                    name="user"
                    className={`icon${m.isHost || m.isReady ? " is-on" : ""}`}
                  />
                ))}
              </span>
            </div>
            <div className="room-bar__status" role="status">
              <span className={canStart || started ? "t-mint" : "t-lo"}>
                {status}
              </span>
            </div>
          </div>
          <div className="room-bar__right">
            <button
              type="button"
              className="btn btn--secondary btn--lg lo-entry room-loadout"
              onClick={onProfile}
            >
              <img
                className="lo-entry__icon"
                src="/images/defense-reference/operator-preset.webp"
                alt=""
              />
              <span className="btn__label">{t("factionProfile")}</span>
            </button>
            <div className="room-match-actions">
              <div className="room-match-options">
                <span className="room-match-state">
                  {t("waitingFourPlayers")}
                </span>
              </div>
              {room.isHost ? (
                <button
                  type="button"
                  className="btn btn--primary btn--xl"
                  disabled={busy || !canStart}
                  onClick={onStart}
                >
                  <Icon name="play" className="icon btn__icon" />
                  <span className="btn__label">
                    {t(started ? "started" : "waitingStartNow")}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className={`btn btn--xl ${me?.isReady ? "btn--primary is-active" : "btn--secondary"}`}
                  aria-pressed={!!me?.isReady}
                  title={t(
                    me?.isReady ? "waitingCancelReady" : "waitingPrepare",
                  )}
                  disabled={busy || started}
                  onClick={() => onReady(!me?.isReady)}
                >
                  <Icon
                    name={me?.isReady ? "check" : "hourglass"}
                    className="icon btn__icon"
                  />
                  <span className="btn__label">
                    {t(me?.isReady ? "waitingReady" : "waitingPrepare")}
                  </span>
                </button>
              )}
            </div>
          </div>
        </footer>
      </div>
      <Dialog.Root
        open={editCodeOpen}
        onOpenChange={(open) => {
          if (!busy) setEditCodeOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={modal.backdrop} style={{ zIndex: 95 }} />
          <Dialog.Popup
            className={`${modal.page} ${modal.dialog}`}
            style={{ zIndex: 96, width: "min(540px,calc(100vw - 28px))" }}
            initialFocus={gameCodeInput}
          >
            <div className={modal.dialogTop}>
              <span>GAME ROOM CODE</span>
              <Dialog.Close
                className={modal.closeButton}
                aria-label={t("closeGameCode")}
              >
                <X size={20} />
              </Dialog.Close>
            </div>
            <Dialog.Title className={modal.dialogTitle}>
              {t("publishGameCode")}
            </Dialog.Title>
            <Dialog.Description className={modal.dialogDescription}>
              {t("gameCodeVisibility")}
            </Dialog.Description>
            <form
              className={modal.createForm}
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy)
                  void onGameCode(codeDraft.trim()).then((ok) => {
                    if (ok) setEditCodeOpen(false);
                  });
              }}
            >
              <label className="grid gap-2 text-sm">
                {t("roomCode")}
                <Input
                  ref={gameCodeInput}
                  maxLength={40}
                  value={codeDraft}
                  onChange={(event) => setCodeDraft(event.target.value)}
                  placeholder={t("gameCodeLater")}
                />
              </label>
              {error ? (
                <p role="alert" className={modal.formError}>
                  {error}
                </p>
              ) : null}
              <div className="mt-5 flex justify-end gap-3">
                <Dialog.Close
                  render={<Button variant="outline" disabled={busy} />}
                >
                  {t("cancelGameCode")}
                </Dialog.Close>
                <Button
                  type="submit"
                  disabled={busy || codeDraft.trim() === (room.roomCode ?? "")}
                >
                  {t("saveGameCode")}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={!!viewedMember}
        onOpenChange={(open) => {
          if (!open) setViewedMember(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={modal.backdrop} style={{ zIndex: 95 }} />
          <Dialog.Popup
            className={`${modal.page} ${modal.dialog} ${modal.profileDialog}`}
            style={{ zIndex: 96 }}
            initialFocus={bondCloseRef}
          >
            <div className={modal.dialogTop}>
              <span>ALLIANCE / BOND PROFILE</span>
              <Dialog.Close
                className={modal.closeButton}
                aria-label={t("closeProfile")}
                ref={bondCloseRef}
              >
                <X size={20} />
              </Dialog.Close>
            </div>
            <Dialog.Title className={modal.dialogTitle}>
              {t("waitingViewBonds", { name: viewedMember?.name ?? "" })}
            </Dialog.Title>
            <Dialog.Description className={modal.dialogDescription}>
              {t("waitingBondReadOnly")}
            </Dialog.Description>
            <div className={modal.createForm}>
              {viewedMember ? (
                <DefenseBondPicker
                  value={viewedMember.favoriteFactions}
                  onChange={() => undefined}
                  disabled
                  enforceCoreBounds
                />
              ) : null}
              <div className="mt-5 flex justify-end gap-3">
                {viewedMember?.isMe ? (
                  <Button
                    onClick={() => {
                      setViewedMember(null);
                      onProfile();
                    }}
                  >
                    {t("editBondProfile")}
                  </Button>
                ) : null}
                <Dialog.Close render={<Button variant="outline" />}>
                  {t("waitingBackToRoom")}
                </Dialog.Close>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={confirmLeave}
        onOpenChange={(open) => {
          if (!busy) setConfirmLeave(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={modal.backdrop} style={{ zIndex: 95 }} />
          <Dialog.Popup
            className={`${modal.page} ${modal.dialog}`}
            style={{ zIndex: 96, width: "min(500px,calc(100vw - 28px))" }}
          >
            <Dialog.Title className={modal.dialogTitle}>
              {t("waitingLeave")}
            </Dialog.Title>
            <Dialog.Description className={modal.dialogDescription}>
              {t(room.isHost ? "waitingLeaveHost" : "waitingLeaveMember")}
            </Dialog.Description>
            <div className={modal.createForm}>
              <div className="flex justify-end gap-3">
                <Dialog.Close
                  render={<Button variant="outline" disabled={busy} />}
                >
                  {t("waitingStay")}
                </Dialog.Close>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void onLeave().then((ok) => {
                      if (ok) setConfirmLeave(false);
                    })
                  }
                >
                  {t("waitingLeaveConfirm")}
                </Button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
