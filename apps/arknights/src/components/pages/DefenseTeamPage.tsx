import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearch } from "@tanstack/react-router";
import { useTranslations, useLocale } from "use-intl";
import { Dialog } from "@base-ui/react/dialog";
import {
  Users,
  Plus,
  RefreshCw,
  Copy,
  Shield,
  Check,
  X,
  Radio,
} from "lucide-react";
import {
  createPlatformClient,
  PlatformRequestError,
} from "@riic/platform/client";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import styles from "./DefenseTeamPage.module.css";
import { DefenseProfileEditor } from "./DefenseProfileEditor";
import { DefenseMemberSlot } from "./DefenseMemberSlot";
import { DefenseProtocolScreen } from "./DefenseProtocolScreen";
import { DefenseWaitingRoom } from "./DefenseWaitingRoom";
import { DefenseJoinDialog } from "./DefenseJoinDialog";
import { DefenseBondMatchSettings } from "./DefenseBondMatchSettings";
import {
  bondCompatibility,
  matchesRequiredBonds,
} from "../../defense-bond-matching";
import { DefenseTerminalHome } from "./DefenseTerminalHome";
import {
  TEAM_DIFFICULTIES,
  DEFAULT_BOND_MATCH_PREFERENCES,
  parseBondMatchPreferences,
  validCoreBondSelection,
  type BondMatchPreferences,
  parseTeamPreferences,
  matchesTeamPreferences,
  type TeamPreferences,
  type DefenseProfile,
} from "../../defense-team-validation";

import type { DefenseRoom as Room } from "../../defense-team-types";
const api = createPlatformClient();
const AuthDialog = lazy(() =>
  import("@riic/shell/WebsiteAuthDialog").then((module) => ({
    default: module.WebsiteAuthDialog,
  })),
);

export function DefenseTeamPage() {
  const t = useTranslations("DefenseTeam"),
    locale = useLocale();
  const search = useSearch({ from: "/defense-team" });
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [returnToWaiting, setReturnToWaiting] = useState(false);
  const [invitedCode, setInvitedCode] = useState<string | undefined>();
  const [rooms, setRooms] = useState<Room[]>([]),
    [pending, setPending] = useState(true),
    [busy, setBusy] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false),
    [authOpen, setAuthOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<"protocol" | "details">(
    "protocol",
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [matchProtocolOpen, setMatchProtocolOpen] = useState(false);
  const [matchDifficulty, setMatchDifficulty] =
    useState<TeamPreferences["difficulty"]>("ac1");
  const [bondMatchOpen, setBondMatchOpen] = useState(false);
  const [bondPreferences, setBondPreferences] = useState<BondMatchPreferences>(
    DEFAULT_BOND_MATCH_PREFERENCES,
  );
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const [accountProfile, setAccountProfile] = useState<DefenseProfile | null>(
    null,
  );
  const [latency, setLatency] = useState<number | null>(null);
  function openLobby(filters = false) {
    if (filters) {
      setError("");
      setBondMatchOpen(true);
    } else setLobbyOpen(true);
  }
  const [connectionState, setConnectionState] = useState<
    "connected" | "connecting" | "connectionError"
  >("connecting");
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [server, setServer] = useState("official"),
    [filter, setFilter] = useState("all");
  const [preferences, setPreferences] = useState<TeamPreferences>({
    difficulty: "any",
  });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferenceSaveError, setPreferenceSaveError] = useState(false);
  const [onlyJoinable, setOnlyJoinable] = useState(false);
  const [roomDifficulty, setRoomDifficulty] =
    useState<TeamPreferences["difficulty"]>("ac1");
  const [title, setTitle] = useState(""),
    [roomCode, setRoomCode] = useState(""),
    [note, setNote] = useState("");
  useEffect(() => {
    if (search.code) {
      setInvitedCode(search.code);
      if (search.server) setServer(search.server);
      setJoinOpen(true);
    }
  }, [search.code, search.server]);
  const request = useRef<AbortController | null>(null),
    mutating = useRef(false);
  const initialRoomView = useRef(false);
  const initialInvitation = useRef({
    code: search.code,
    server: search.server,
  });
  const mine = rooms.find((room) => room.joined);
  const inRoom = !!mine;
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("riic:arknights:defense-preferences:v1") ?? "null",
      );
      const parsed = parseTeamPreferences(saved);
      if (parsed) {
        setPreferences(parsed);
        const bonds = parseBondMatchPreferences(saved);
        if (bonds) setBondPreferences(bonds);
        if (["official", "bilibili"].includes(saved.server))
          setServer(saved.server);
        if (["all", "official", "bilibili"].includes(saved.filter))
          setFilter(saved.filter);
        setOnlyJoinable(saved.onlyJoinable === true);
      }
    } catch {
      /* A malformed preference record never changes matchmaking rules. */
    }
    setPreferencesReady(true);
  }, []);
  useEffect(() => {
    if (!preferencesReady) return;
    try {
      localStorage.setItem(
        "riic:arknights:defense-preferences:v1",
        JSON.stringify({
          ...preferences,
          ...bondPreferences,
          server,
          filter,
          onlyJoinable,
        }),
      );
      setPreferenceSaveError(false);
    } catch {
      setPreferenceSaveError(true);
    }
  }, [
    preferences,
    bondPreferences,
    server,
    filter,
    onlyJoinable,
    preferencesReady,
  ]);
  function resetPreferences() {
    setPreferences({
      difficulty: "any",
    });
    setBondPreferences(DEFAULT_BOND_MATCH_PREFERENCES);
    setOnlyJoinable(false);
    setFilter("all");
    setServer("official");
  }
  function openCreate() {
    if (needsSignIn) {
      setAuthOpen(true);
      return;
    }
    if (filter !== "all") setServer(filter);
    setRoomDifficulty(
      preferences.difficulty === "any" ? "ac1" : preferences.difficulty,
    );
    setCreateStep("protocol");
    setCreateOpen(true);
  }
  const refresh = useCallback(async () => {
    if (mutating.current) return false;
    request.current?.abort();
    const controller = new AbortController();
    const requestStarted = performance.now();
    request.current = controller;
    try {
      const data = await api.request<{
        rooms: Room[];
        profile: DefenseProfile;
      }>("/api/defense-team", {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setRooms(data.rooms);
        setAccountProfile(data.profile);
        if (!initialRoomView.current) {
          initialRoomView.current = true;
          const existing = data.rooms.find((room) => room.joined);
          const invite = initialInvitation.current;
          if (
            existing &&
            (!invite.code ||
              (invite.code === existing.inviteCode &&
                (!invite.server || invite.server === existing.server)))
          ) {
            setWaitingOpen(true);
            setJoinOpen(false);
          }
        }
        setLatency(Math.round(performance.now() - requestStarted));
        setConnectionState("connected");
        setNeedsSignIn(false);
        setError("");
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setConnectionState("connectionError");
        setError(cause instanceof Error ? cause.message : "Request failed");
        if (
          cause instanceof PlatformRequestError &&
          [401, 403].includes(cause.status)
        ) {
          setNeedsSignIn(true);
          setRooms([]);
          setAccountProfile(null);
        }
      }
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }, [setConnectionState, setError]);
  useEffect(() => {
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(tick, inRoom ? 2000 : 10000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      request.current?.abort();
    };
  }, [refresh, inRoom]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 3000);
    return () => clearTimeout(timer);
  }, [message]);
  async function act(body: unknown) {
    if (mutating.current) return;
    mutating.current = true;
    request.current?.abort();
    setBusy(true);
    setError("");
    try {
      const data = await api.request<{
        rooms: Room[];
        profile: DefenseProfile;
      }>("/api/defense-team", {
        body,
      });
      setRooms(data.rooms);
      setAccountProfile(data.profile);
      const joinedRoom = data.rooms.find((room) => room.joined);
      setWaitingOpen(!!joinedRoom);
      setLobbyOpen(!joinedRoom);
      setMessage(t("success"));
      setPending(false);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error"));
      if (
        cause instanceof PlatformRequestError &&
        [401, 403].includes(cause.status)
      ) {
        setNeedsSignIn(true);
        setRooms([]);
        setAccountProfile(null);
      }
      return false;
    } finally {
      mutating.current = false;
      setBusy(false);
      setPending(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (
      await act({
        action: "create",
        server,
        title,
        roomCode: roomCode.trim(),
        note,
        difficulty: roomDifficulty,
      })
    ) {
      setCreateOpen(false);
      setTitle("");
      setRoomCode("");
      setNote("");
    }
  }
  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setMessage(t("copied"));
    } catch {
      setError(t("error"));
    }
  }
  const effectiveBonds = bondPreferences.useProfileBonds
    ? (accountProfile?.favoriteFactions ?? [])
    : bondPreferences.preferredBonds;
  const compatibility = new Map(
    rooms.map((room) => [
      room.id,
      bondCompatibility(effectiveBonds, room.members),
    ]),
  );
  const visible = rooms
    .filter(
      (room) =>
        room.joined ||
        ((filter === "all" || room.server === filter) &&
          matchesTeamPreferences(room, preferences) &&
          matchesRequiredBonds(room.members, bondPreferences) &&
          (!onlyJoinable ||
            (room.status === "open" && room.members.length < 4))),
    )
    .sort(
      (a, b) =>
        Number(b.joined) - Number(a.joined) ||
        (bondPreferences.avoidBondOverlap && effectiveBonds.length
          ? compatibility.get(a.id)!.penalty - compatibility.get(b.id)!.penalty
          : 0) ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a.id.localeCompare(b.id),
    );
  useEffect(() => {
    if (waitingOpen && !mine && !pending) {
      setWaitingOpen(false);
      setMessage(t("waitingRoomEnded"));
    }
  }, [waitingOpen, mine, pending, t]);
  function openMyRoom() {
    if (mine) setWaitingOpen(true);
    else openLobby();
  }
  function copyInvitation() {
    if (!mine?.inviteCode) return;
    const link = new URL("/defense-team", window.location.origin);
    link.searchParams.set("code", mine.inviteCode);
    link.searchParams.set("server", mine.server);
    void copy(link.toString());
  }
  async function quickMatch(difficulty = preferences.difficulty) {
    if (needsSignIn) {
      setAuthOpen(true);
      return;
    }
    if (!validCoreBondSelection(effectiveBonds)) {
      setError(t("coreSelectionRequired"));
      return;
    }
    if (
      await act({
        action: "quick",
        server: filter === "all" ? server : filter,
        ...preferences,
        ...bondPreferences,
        difficulty,
      })
    ) {
      setBondMatchOpen(false);
      setMatchProtocolOpen(false);
    }
  }
  return (
    <main className={styles.page}>
      <DefenseTerminalHome
        matchSummary={`${t((filter === "all" ? server : filter) === "official" ? "official" : "bilibili")} · ${t(`difficulty_${preferences.difficulty}`)}`}
        accountName={accountProfile?.name}
        connection={connectionState}
        latency={latency}
        roomCount={
          rooms.filter(
            (room) => room.status === "open" && room.members.length < 4,
          ).length
        }
        memberCount={mine?.members.length ?? 0}
        roomTitle={mine?.title}
        busy={busy}
        pending={pending}
        onLobby={openLobby}
        onMyTeam={openMyRoom}
        onCreate={openCreate}
        onJoin={() => {
          setError("");
          if (needsSignIn) setAuthOpen(true);
          else setJoinOpen(true);
        }}
        onQuick={() => {
          setError("");
          if (needsSignIn) {
            setAuthOpen(true);
            return;
          }
          setMatchDifficulty(
            preferences.difficulty === "any" ? "ac1" : preferences.difficulty,
          );
          setMatchProtocolOpen(true);
        }}
        onProfile={() =>
          needsSignIn ? setAuthOpen(true) : setProfileOpen(true)
        }
      />
      <div className={styles.homeMessages}>
        {error ? (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
          >
            {error}
          </div>
        ) : null}
        {needsSignIn ? (
          <Button className="mb-5" onClick={() => setAuthOpen(true)}>
            {locale === "en" ? "Sign in to RIIC" : "登录 RIIC 账号"}
          </Button>
        ) : null}
        {authOpen ? (
          <Suspense fallback={null}>
            <AuthDialog
              locale={locale}
              open={authOpen}
              onOpenChange={setAuthOpen}
              onAuthenticated={async () => {
                setAuthOpen(false);
                await refresh();
              }}
            />
          </Suspense>
        ) : null}
        {message ? (
          <div
            role="status"
            className="mb-5 flex items-center gap-2 rounded-lg border border-border bg-muted p-3 text-sm"
          >
            <Check size={16} />
            {message}
          </div>
        ) : null}
      </div>
      <Dialog.Root open={lobbyOpen} onOpenChange={setLobbyOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup
            className={`${styles.page} ${styles.dialog} ${styles.lobbyDialog}`}
          >
            <div className={styles.dialogTop}>
              <Dialog.Title>{t("lobby")}</Dialog.Title>
              <span>ALLIANCE / MATCHMAKING</span>
              <Dialog.Close
                className={styles.closeButton}
                aria-label={t("closeLobby")}
              >
                <X size={20} />
              </Dialog.Close>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              {t("joinedHint")}
            </Dialog.Description>
            {error ? (
              <p role="alert" className={styles.formError}>
                {error}
              </p>
            ) : null}
            <div className={styles.lobbyLayout}>
              <section aria-label={t("lobby")} className={styles.lobby}>
                <div className={styles.lobbyHeading}>
                  <h2>
                    <span className={styles.headingMarker} />
                    {t("lobby")}
                    <span className={styles.roomCount}>
                      {visible.length.toString().padStart(2, "0")}
                    </span>
                  </h2>
                  <Button
                    variant="outline"
                    disabled={busy || pending}
                    onClick={openCreate}
                  >
                    <Plus size={16} />
                    {t("create")}
                  </Button>
                  <div
                    className={styles.filters}
                    role="group"
                    aria-label={t("server")}
                  >
                    {(["all", "official", "bilibili"] as const).map((value) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={filter === value}
                        onClick={() => setFilter(value)}
                      >
                        {t(value)}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void refresh()}
                  >
                    <RefreshCw size={16} />
                    {t("refresh")}
                  </Button>
                </div>
                <div className={styles.lobbyNotice}>
                  <Radio size={14} />
                  <span>{t("lobbyHint")}</span>
                  <span className={styles.refreshLabel}>
                    AUTO REFRESH / 10s
                  </span>
                </div>
                <div
                  className={styles.activeFilters}
                  aria-label={t("activePreferences")}
                >
                  <span>{t(`difficulty_${preferences.difficulty}`)}</span>
                  <label>
                    <input
                      type="checkbox"
                      checked={onlyJoinable}
                      onChange={(event) =>
                        setOnlyJoinable(event.target.checked)
                      }
                    />
                    {t("onlyJoinable")}
                  </label>
                </div>
                {pending ? (
                  <p
                    role="status"
                    className="p-8 text-center text-muted-foreground"
                  >
                    {t("loading")}
                  </p>
                ) : visible.length === 0 ? (
                  <div className={styles.emptyState}>
                    <div className={styles.radar}>
                      <Users size={38} />
                    </div>
                    <h3 className="font-semibold">
                      {t(rooms.length ? "noMatches" : "empty")}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t(rooms.length ? "noMatchesHint" : "emptyHint")}
                    </p>
                    <Button
                      className={styles.outlineAction}
                      disabled={!!mine || busy}
                      onClick={openCreate}
                    >
                      <Plus size={16} />
                      {t("create")}
                    </Button>
                    {rooms.length ? (
                      <button
                        className={styles.resetFilters}
                        type="button"
                        onClick={resetPreferences}
                      >
                        {t("resetPreferences")}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {visible.map((room) => (
                      <article
                        key={room.id}
                        className={styles.roomCard}
                        data-joined={room.joined}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="mb-1 text-xs text-muted-foreground">
                              {t(
                                room.server === "official"
                                  ? "official"
                                  : "bilibili",
                              )}{" "}
                              ·{" "}
                              {room.status === "started"
                                ? t("started")
                                : room.members.length === 4
                                  ? t("full")
                                  : t("waiting")}
                              {room.joined ? ` · ${t("joined")}` : ""}
                            </p>
                            <h3 className="break-words text-lg font-semibold">
                              {room.title}
                            </h3>
                          </div>
                          <span className={styles.memberCount}>
                            {room.members.length}
                            <span className="text-muted-foreground">/4</span>
                          </span>
                        </div>
                        <div
                          className={styles.roomTags}
                          aria-label={t("difficultyLabel")}
                        >
                          <span
                            className={styles.difficultyTag}
                            data-level={room.difficulty}
                          >
                            {t(`difficulty_${room.difficulty}`)}
                          </span>
                        </div>
                        {!room.joined && effectiveBonds.length > 0 ? (
                          <div className={styles.matchQuality}>
                            <strong
                              title={t("matchDataHint")}
                              data-high-overlap={
                                (compatibility.get(room.id)!.score ?? 100) < 40
                              }
                              data-known={
                                compatibility.get(room.id)!.score !== null
                              }
                            >
                              {compatibility.get(room.id)!.score === null
                                ? t("matchUnknown")
                                : t("matchCompatibility", {
                                    score: compatibility.get(room.id)!.score!,
                                  })}
                            </strong>
                            <span>
                              {t("teamDuplicateCount", {
                                count: compatibility.get(room.id)!.teamRepeat
                                  .length,
                              })}
                            </span>
                            <span>
                              {t("newBondCount", {
                                count: compatibility.get(room.id)!.complementary
                                  .length,
                              })}
                            </span>
                          </div>
                        ) : null}
                        {room.note ? (
                          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                            {room.note}
                          </p>
                        ) : null}
                        <div className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {Array.from({ length: 4 }, (_, i) => (
                            <DefenseMemberSlot
                              key={i}
                              member={room.members.find(
                                (member) => member.seat === i,
                              )}
                              index={i}
                            />
                          ))}
                        </div>
                        {room.roomCode ? (
                          <div className={styles.roomCode}>
                            <div>
                              <small className="text-muted-foreground">
                                {t("roomCode")}
                              </small>
                              <p className="break-all font-mono font-semibold">
                                {room.roomCode}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void copy(room.roomCode!)}
                            >
                              <Copy size={14} />
                              {t("copy")}
                            </Button>
                          </div>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                          <small className="mr-auto text-muted-foreground">
                            {t("expires")}{" "}
                            {new Date(room.expiresAt).toLocaleTimeString(
                              locale,
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </small>
                          {room.joined ? (
                            <>
                              <Button
                                variant="outline"
                                onClick={() => setWaitingOpen(true)}
                              >
                                {t("waitingOpen")}
                              </Button>
                              {room.isHost && room.status === "open" ? (
                                <Button
                                  disabled={
                                    busy ||
                                    !room.roomCode ||
                                    room.members.length !== 4 ||
                                    room.members.some(
                                      (member) =>
                                        !member.isHost && !member.isReady,
                                    )
                                  }
                                  onClick={() =>
                                    void act({
                                      action: "start",
                                      roomId: room.id,
                                    })
                                  }
                                >
                                  {t("start")}
                                </Button>
                              ) : null}
                              <Button
                                variant="outline"
                                disabled={busy}
                                onClick={() => void act({ action: "leave" })}
                              >
                                {t(room.isHost ? "close" : "leave")}
                              </Button>
                            </>
                          ) : (
                            <Button
                              disabled={
                                busy ||
                                !!mine ||
                                room.status !== "open" ||
                                room.members.length >= 4
                              }
                              onClick={() =>
                                void act({ action: "join", roomId: room.id })
                              }
                            >
                              {t("join")}
                            </Button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <aside className={styles.commandPanel}>
                <div className={styles.panelLabel}>OPERATIONS / 01</div>
                <details className={styles.instructions}>
                  <summary>{t("operationTitle")}</summary>
                  <ol className={styles.steps}>
                    <li>
                      <span>01</span>
                      <div>
                        <strong>{t("stepOne")}</strong>
                        <p>{t("stepOneHint")}</p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <strong>{t("stepTwo")}</strong>
                        <p>{t("stepTwoHint")}</p>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <strong>{t("stepThree")}</strong>
                        <p>{t("stepThreeHint")}</p>
                      </div>
                    </li>
                  </ol>
                </details>
                <div className={styles.serverControl}>
                  <label htmlFor="team-match-server">{t("matchServer")}</label>
                  <select
                    id="team-match-server"
                    value={filter === "all" ? server : filter}
                    onChange={(event) => {
                      setServer(event.target.value);
                      setFilter(event.target.value);
                    }}
                  >
                    <option value="official">{t("official")}</option>
                    <option value="bilibili">{t("bilibili")}</option>
                  </select>
                </div>
                <fieldset className={styles.preferencePanel}>
                  <legend>{t("teamPreferences")}</legend>
                  <p>{t("preferenceHint")}</p>
                  <label htmlFor="match-difficulty">
                    {t("difficultyLabel")}
                  </label>
                  <select
                    id="match-difficulty"
                    value={preferences.difficulty}
                    onChange={(event) =>
                      setPreferences((current) => ({
                        ...current,
                        difficulty: event.target
                          .value as TeamPreferences["difficulty"],
                      }))
                    }
                  >
                    <option value="any">{t("difficulty_any")}</option>
                    {TEAM_DIFFICULTIES.map((value) => (
                      <option key={value} value={value}>
                        {t(`difficulty_${value}`)}
                      </option>
                    ))}
                  </select>
                  <div className={styles.bondSummary}>
                    <strong>
                      {t(
                        bondPreferences.useProfileBonds
                          ? "profileBondCount"
                          : "customBondCount",
                        { count: effectiveBonds.length },
                      )}
                    </strong>
                    <span>
                      {t(
                        bondPreferences.avoidBondOverlap
                          ? "bondMatchEnabled"
                          : "bondMatchOff",
                      )}
                    </span>
                    <span>
                      {t("bondFilterCount", {
                        count:
                          bondPreferences.requiredCoreBonds.length +
                          bondPreferences.requiredAddonBonds.length,
                      })}
                    </span>
                    <Button
                      variant="outline"
                      onClick={() => setBondMatchOpen(true)}
                    >
                      {t("bondMatchSettings")}
                    </Button>
                  </div>
                  <label className={styles.joinableToggle}>
                    <input
                      type="checkbox"
                      checked={onlyJoinable}
                      onChange={(event) =>
                        setOnlyJoinable(event.target.checked)
                      }
                    />
                    {t("onlyJoinable")}
                  </label>
                  <button
                    type="button"
                    className={styles.resetFilters}
                    onClick={resetPreferences}
                  >
                    {t("resetPreferences")}
                  </button>
                  <small role="status">
                    {t(
                      preferenceSaveError
                        ? "preferencesNotSaved"
                        : "preferencesSaved",
                    )}
                  </small>
                </fieldset>
                <p className={styles.commandFoot}>
                  <Shield size={15} />
                  {t("codeHint")}
                </p>
              </aside>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup
            className={
              createStep === "protocol"
                ? "riic-protocol-page"
                : `${styles.page} ${styles.dialog} ${styles.createDialog}`
            }
            data-step={createStep}
          >
            {createStep === "protocol" ? (
              <DefenseProtocolScreen
                value={roomDifficulty}
                onChange={setRoomDifficulty}
                onContinue={() => setCreateStep("details")}
                onBack={() => setCreateOpen(false)}
              />
            ) : (
              <>
                <div className={styles.dialogTop}>
                  <span>CREATE / SQUAD</span>
                  <Dialog.Close
                    className={styles.closeButton}
                    aria-label={t("cancel")}
                  >
                    <X size={20} />
                  </Dialog.Close>
                </div>
                <Dialog.Title className={styles.dialogTitle}>
                  {t("createTitle")}
                </Dialog.Title>
                <Dialog.Description className={styles.dialogDescription}>
                  {t("createHint")}
                </Dialog.Description>
                <form onSubmit={create} className={styles.createForm}>
                  {error ? (
                    <p role="alert" className={styles.formError}>
                      {error}
                    </p>
                  ) : null}
                  <div className="space-y-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCreateStep("protocol")}
                    >
                      {t(`difficulty_${roomDifficulty}`)} ·{" "}
                      {t("protocolChange")}
                    </Button>
                    <label className="grid gap-2 text-sm">
                      {t("server")}
                      <select
                        value={server}
                        onChange={(e) => setServer(e.target.value)}
                        className="min-h-11 rounded-lg border border-border bg-background px-3"
                      >
                        <option value="official">{t("official")}</option>
                        <option value="bilibili">{t("bilibili")}</option>
                      </select>
                    </label>
                    <label className="grid gap-2 text-sm">
                      {t("roomTitle")}
                      <Input
                        required
                        maxLength={40}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("titlePlaceholder")}
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      {t("roomCodeOptional")}
                      <Input
                        maxLength={40}
                        value={roomCode}
                        onChange={(e) => setRoomCode(e.target.value)}
                        placeholder={t("gameCodeLater")}
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      {t("note")}
                      <textarea
                        maxLength={160}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={t("notePlaceholder")}
                        className="min-h-24 resize-y rounded-lg border border-border bg-background p-3"
                      />
                    </label>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {t("codeHint")}
                    </p>
                    <Button
                      className={`w-full ${styles.primaryAction}`}
                      type="submit"
                      disabled={busy || !!mine || pending}
                    >
                      <Plus />
                      {t("submit")}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {t("loginHint")}
                    </p>
                  </div>
                </form>
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={waitingOpen && !!mine}
        onOpenChange={(open) => {
          if (!busy) setWaitingOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup className="riic-waiting-page">
            {mine ? (
              <DefenseWaitingRoom
                key={mine.id}
                room={mine}
                busy={busy}
                error={error}
                message={message}
                latency={latency}
                onReady={(isReady) =>
                  void act({ action: "ready", roomId: mine.id, isReady })
                }
                onStart={() => void act({ action: "start", roomId: mine.id })}
                onLeave={() => act({ action: "leave" })}
                onDifficulty={(difficulty) =>
                  void act({
                    action: "difficulty",
                    roomId: mine.id,
                    difficulty,
                  })
                }
                onProfile={() => {
                  setWaitingOpen(false);
                  setReturnToWaiting(true);
                  setProfileOpen(true);
                }}
                onLobby={() => {
                  setWaitingOpen(false);
                  openLobby();
                }}
                onRefresh={() => void refresh()}
                onCopy={() => {
                  void copy(mine.inviteCode);
                }}
                onCopyGame={() => {
                  if (mine.roomCode) void copy(mine.roomCode);
                }}
                onGameCode={(roomCode) =>
                  act({ action: "game-code", roomId: mine.id, roomCode })
                }
                onCopyLink={copyInvitation}
              />
            ) : null}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={matchProtocolOpen}
        onOpenChange={(open) => {
          if (!busy) setMatchProtocolOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup className="riic-protocol-page">
            <DefenseProtocolScreen
              mode="match"
              disabled={!validCoreBondSelection(effectiveBonds)}
              value={matchDifficulty}
              onChange={setMatchDifficulty}
              busy={busy}
              error={
                error ||
                (!validCoreBondSelection(effectiveBonds)
                  ? t("coreSelectionRequired")
                  : "")
              }
              onBack={() => {
                if (!busy) setMatchProtocolOpen(false);
              }}
              onContinue={() => void quickMatch(matchDifficulty)}
              onPreferences={() => {
                setPreferences({ difficulty: matchDifficulty });
                setMatchProtocolOpen(false);
                setBondMatchOpen(true);
              }}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <DefenseJoinDialog
        open={joinOpen}
        onOpenChange={setJoinOpen}
        server={server}
        onServerChange={setServer}
        busy={busy}
        inTeam={!!mine}
        error={error}
        initialCode={invitedCode}
        onJoin={(code) =>
          act({ action: "join-code", server, inviteCode: code })
        }
        onLobby={() => {
          setJoinOpen(false);
          openLobby();
        }}
      />
      <Dialog.Root open={bondMatchOpen} onOpenChange={setBondMatchOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup
            className={`${styles.page} ${styles.dialog} ${styles.profileDialog} ${styles.bondMatchDialog}`}
          >
            <div className={styles.dialogTop}>
              <span>ALLIANCE / MATCHMAKING</span>
              <Dialog.Close
                className={styles.closeButton}
                aria-label={t("bondMatchDone")}
              >
                <X size={20} />
              </Dialog.Close>
            </div>
            <Dialog.Title className={styles.dialogTitle}>
              {t("bondMatchSettings")}
            </Dialog.Title>
            <Dialog.Description className={styles.dialogDescription}>
              {t("bondMatchDescription")}
            </Dialog.Description>
            {error ? (
              <p role="alert" className={styles.formError}>
                {error}
              </p>
            ) : null}
            <div className={styles.matchConstraints}>
              <label>
                {t("matchServer")}
                <select
                  value={filter === "all" ? server : filter}
                  onChange={(event) => {
                    setServer(event.target.value);
                    setFilter(event.target.value);
                  }}
                >
                  <option value="official">{t("official")}</option>
                  <option value="bilibili">{t("bilibili")}</option>
                </select>
              </label>
              <label>
                {t("difficultyLabel")}
                <select
                  value={preferences.difficulty}
                  onChange={(event) =>
                    setPreferences({
                      difficulty: event.target
                        .value as TeamPreferences["difficulty"],
                    })
                  }
                >
                  <option value="any">{t("difficulty_any")}</option>
                  {TEAM_DIFFICULTIES.map((value) => (
                    <option key={value} value={value}>
                      {t(`difficulty_${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.joinableToggle}>
                <input
                  type="checkbox"
                  checked={onlyJoinable}
                  onChange={(event) => setOnlyJoinable(event.target.checked)}
                />
                {t("onlyJoinable")}
              </label>
            </div>
            <DefenseBondMatchSettings
              value={bondPreferences}
              profile={accountProfile}
              onChange={(value) => {
                setError("");
                setBondPreferences(value);
              }}
              onProfile={() => {
                setBondMatchOpen(false);
                setProfileOpen(true);
              }}
            />
            <div className={styles.matchActions}>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setBondPreferences(DEFAULT_BOND_MATCH_PREFERENCES);
                }}
              >
                {t("resetBondMatch")}
              </Button>
              <span>{t("matchFilterNote")}</span>
              <Button variant="outline" onClick={() => setBondMatchOpen(false)}>
                {t("bondMatchDone")}
              </Button>
              <Button
                className={styles.primaryAction}
                disabled={
                  busy ||
                  pending ||
                  !!mine ||
                  !validCoreBondSelection(effectiveBonds)
                }
                onClick={() => void quickMatch()}
              >
                {t(busy ? "matchSearching" : "matchNow")}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={profileOpen}
        onOpenChange={(open) => {
          setProfileOpen(open);
          if (!open && returnToWaiting) {
            setReturnToWaiting(false);
            if (mine) setWaitingOpen(true);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup
            className={`${styles.page} ${styles.dialog} ${styles.profileDialog}`}
          >
            <div className={styles.dialogTop}>
              <span>DOCTOR / PROFILE</span>
              <Dialog.Close
                className={styles.closeButton}
                aria-label={t("closeProfile")}
              >
                <X size={20} />
              </Dialog.Close>
            </div>
            <Dialog.Title className={styles.dialogTitle}>
              {t("profileTitle")}
            </Dialog.Title>
            <Dialog.Description className={styles.dialogDescription}>
              {t("profileDescription")}
            </Dialog.Description>
            <div className={styles.profileForm}>
              <DefenseProfileEditor
                embedded
                onSaved={() => {
                  void refresh();
                }}
              />
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
