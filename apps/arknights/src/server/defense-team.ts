import { randomUUID, randomBytes } from "node:crypto";
import { getDatabasePool } from "@riic/platform-server/db";
import { PublicApiError } from "@riic/platform-server/api-contract";
import type { PoolClient } from "pg";
import {
  bondCompatibility,
  matchesRequiredBonds,
  type BondMember,
} from "../defense-bond-matching";
import {
  TEAM_CAPACITY,
  DEFAULT_BOND_MATCH_PREFERENCES,
  validCoreBondSelection,
  type DefenseProfile,
  type parseDefenseInput,
} from "../defense-team-validation";

type Input = NonNullable<ReturnType<typeof parseDefenseInput>>;
const invalid = (message: string) =>
  new PublicApiError("AIC-REQ-1001", { message });

async function findQuickRoom(db: PoolClient, userId: string, input: Input) {
  const prefs = { ...DEFAULT_BOND_MATCH_PREFERENCES, ...input };
  const profile = await db.query<{
    favorite_factions: DefenseProfile["favoriteFactions"];
  }>("SELECT favorite_factions FROM app.defense_profile WHERE user_id=$1", [
    userId,
  ]);
  const preferred = prefs.useProfileBonds
    ? (profile.rows[0]?.favorite_factions ?? [])
    : prefs.preferredBonds;
  if (!validCoreBondSelection(preferred))
    throw invalid(
      "核心盟约至少选择2个、至多4个，请先完善个人资料或匹配偏好。 / Choose 2–4 core bonds in your profile or matching preferences.",
    );
  const candidates = await db.query<{ id: string; members: BondMember[] }>(
    `
    SELECT r.id, COALESCE((SELECT json_agg(json_build_object('favoriteFactions',COALESCE(p.favorite_factions,ARRAY[]::text[])))
      FROM app.defense_member m LEFT JOIN app.defense_profile p ON p.user_id=m.user_id WHERE m.room_id=r.id),'[]'::json) AS members
    FROM app.defense_room r WHERE r.server=$1 AND r.status='open' AND r.expires_at>now()
      AND ($2='any' OR r.difficulty=$2)
      AND (SELECT count(*) FROM app.defense_member m WHERE m.room_id=r.id)<$3
    ORDER BY r.created_at,r.id LIMIT 500`,
    [input.server, input.difficulty ?? "any", TEAM_CAPACITY],
  );
  const ranked = candidates.rows.filter((room) =>
    matchesRequiredBonds(room.members, prefs),
  );
  if (prefs.avoidBondOverlap && preferred.length)
    ranked.sort(
      (a, b) =>
        bondCompatibility(preferred, a.members).penalty -
        bondCompatibility(preferred, b.members).penalty,
    );
  for (const candidate of ranked) {
    // Lock only the chosen candidate, never the whole pool. Recheck after locking.
    await db.query("SAVEPOINT defense_quick_candidate");
    const locked = await db.query(
      "SELECT * FROM app.defense_room WHERE id=$1 AND status='open' AND expires_at>now() FOR UPDATE",
      [candidate.id],
    );
    const room = locked.rows[0];
    if (!room) {
      await db.query("ROLLBACK TO SAVEPOINT defense_quick_candidate");
      continue;
    }
    const current = await db.query<BondMember>(
      `SELECT COALESCE(p.favorite_factions,ARRAY[]::text[]) AS "favoriteFactions"
      FROM app.defense_member m LEFT JOIN app.defense_profile p ON p.user_id=m.user_id WHERE m.room_id=$1`,
      [candidate.id],
    );
    if (
      current.rows.length < TEAM_CAPACITY &&
      matchesRequiredBonds(current.rows, prefs)
    )
      return room;
    await db.query("ROLLBACK TO SAVEPOINT defense_quick_candidate");
  }
  return null;
}

export async function getDefenseProfile(
  userId: string,
): Promise<DefenseProfile> {
  const result = await getDatabasePool().query<DefenseProfile>(
    `SELECT u.id,u.name,COALESCE(p.portrait,'default') AS portrait,COALESCE(p.favorite_factions,ARRAY[]::text[]) AS "favoriteFactions" FROM public."user" u LEFT JOIN app.defense_profile p ON p.user_id=u.id WHERE u.id=$1`,
    [userId],
  );
  if (!result.rows[0])
    throw invalid(
      "账号不存在，请重新登录。 / Account unavailable. Sign in again.",
    );
  return result.rows[0];
}

export async function listDefenseRooms(userId: string) {
  const { rows } = await getDatabasePool().query(
    `
    SELECT r.id, r.invite_code AS "inviteCode", r.title, r.server, r.note, r.status, r.difficulty, r.created_at AS "createdAt", r.expires_at AS "expiresAt",
      r.host_id = $1 AS "isHost",
      EXISTS(SELECT 1 FROM app.defense_member me WHERE me.room_id=r.id AND me.user_id=$1) AS joined,
      CASE WHEN EXISTS(SELECT 1 FROM app.defense_member me WHERE me.room_id=r.id AND me.user_id=$1) THEN NULLIF(r.room_code,'') ELSE NULL END AS "roomCode",
      COALESCE((SELECT json_agg(json_build_object('name',u.name,'portrait',COALESCE(p.portrait,'default'),'seat',m.seat,'isReady',m.is_ready,'isHost',m.user_id=r.host_id,'isMe',m.user_id=$1,'favoriteFactions',COALESCE(p.favorite_factions,ARRAY[]::text[])) ORDER BY m.seat)
        FROM app.defense_member m JOIN public."user" u ON u.id=m.user_id LEFT JOIN app.defense_profile p ON p.user_id=u.id WHERE m.room_id=r.id),'[]'::json) AS members
    FROM app.defense_room r WHERE r.status <> 'closed' AND r.expires_at > now()
    ORDER BY EXISTS(SELECT 1 FROM app.defense_member me WHERE me.room_id=r.id AND me.user_id=$1) DESC, r.created_at DESC LIMIT 100`,
    [userId],
  );
  return rows;
}

export async function mutateDefenseRoom(userId: string, input: Input) {
  const db = await getDatabasePool().connect();
  try {
    await db.query("BEGIN");
    // Serialize every action for one account, including simultaneous joins to different rooms.
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `defense-team:${userId}`,
    ]);
    if (input.action === "profile") {
      if (input.profileOwner !== userId)
        throw invalid(
          "账号已切换，请重新打开个人资料。 / Account changed. Reopen your profile.",
        );
      if (!validCoreBondSelection(input.favoriteFactions))
        throw invalid(
          "核心盟约至少选择2个、至多4个。 / Choose 2–4 core bonds.",
        );
      await db.query(
        "INSERT INTO app.defense_profile (user_id,favorite_factions,portrait) VALUES ($1,$2::text[],$3) ON CONFLICT (user_id) DO UPDATE SET favorite_factions=EXCLUDED.favorite_factions,portrait=EXCLUDED.portrait,updated_at=now()",
        [userId, input.favoriteFactions, input.portrait ?? "default"],
      );
      await db.query("COMMIT");
      return;
    }
    await db.query(
      "DELETE FROM app.defense_member m USING app.defense_room r WHERE m.room_id=r.id AND m.user_id=$1 AND (r.expires_at<=now() OR r.status='closed')",
      [userId],
    );
    const mine = (
      await db.query(
        "SELECT room_id FROM app.defense_member WHERE user_id=$1",
        [userId],
      )
    ).rows[0];
    if (input.action === "create") {
      if (mine)
        throw invalid("请先退出当前房间。 / Leave your current room first.");
      let id: string | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = randomUUID();
        const invite = randomBytes(4).toString("hex").toUpperCase();
        const created = await db.query(
          "INSERT INTO app.defense_room (id,host_id,title,server,room_code,note,difficulty,invite_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (invite_code) DO NOTHING RETURNING id",
          [
            candidate,
            userId,
            input.title,
            input.server,
            input.roomCode ?? "",
            input.note,
            input.difficulty ?? "ac1",
            invite,
          ],
        );
        if (created.rows[0]) {
          id = candidate;
          break;
        }
      }
      if (!id)
        throw invalid(
          "匹配码生成失败，请重试。 / Could not allocate a match code. Retry.",
        );
      await db.query(
        "INSERT INTO app.defense_member (user_id,room_id,seat) VALUES ($1,$2,0)",
        [userId, id],
      );
    } else if (
      input.action === "join" ||
      input.action === "quick" ||
      input.action === "join-code"
    ) {
      if (mine)
        throw invalid(
          "每人同时只能加入一个房间。 / You can join only one room at a time.",
        );
      let codeRoom;
      if (input.action === "join-code") {
        const matching = await db.query(
          "SELECT * FROM app.defense_room WHERE server=$1 AND lower(invite_code)=lower($2) AND status='open' AND expires_at>now() ORDER BY created_at LIMIT 2 FOR UPDATE",
          [input.server, input.inviteCode],
        );
        if (matching.rows.length > 1)
          throw invalid(
            "匹配码对应多个队伍，请在大厅选择。 / Multiple teams use this match code. Choose in the lobby.",
          );
        codeRoom = matching.rows[0];
      }
      const room =
        input.action === "join-code"
          ? codeRoom
          : input.action === "quick"
            ? await findQuickRoom(db, userId, input)
            : (
                await db.query(
                  "SELECT * FROM app.defense_room WHERE id=$1 FOR UPDATE",
                  [input.roomId],
                )
              ).rows[0];
      if (
        !room ||
        room.status !== "open" ||
        new Date(room.expires_at).getTime() <= Date.now()
      )
        throw invalid(
          input.action === "join-code"
            ? "匹配房间不存在或已停止招募，请确认服务器与匹配码。 / Match room unavailable. Check the server and match code."
            : "没有符合当前偏好的空位，请调整筛选或创建房间。 / No slot matches your preferences. Adjust filters or create a room.",
        );
      const count = Number(
        (
          await db.query(
            "SELECT count(*) AS total FROM app.defense_member WHERE room_id=$1",
            [room.id],
          )
        ).rows[0].total,
      );
      if (count >= TEAM_CAPACITY)
        throw invalid("房间已满四人。 / This four-player room is full.");
      const seat = (
        await db.query<{ seat: number }>(
          "SELECT slots.seat FROM generate_series(1,3) AS slots(seat) WHERE NOT EXISTS (SELECT 1 FROM app.defense_member m WHERE m.room_id=$1 AND m.seat=slots.seat) ORDER BY slots.seat LIMIT 1",
          [room.id],
        )
      ).rows[0]?.seat;
      if (seat === undefined)
        throw invalid("房间已满四人。 / This four-player room is full.");
      await db.query(
        "INSERT INTO app.defense_member (user_id,room_id,seat) VALUES ($1,$2,$3)",
        [userId, room.id, seat],
      );
      await db.query(
        "UPDATE app.defense_member SET is_ready=false WHERE room_id=$1",
        [room.id],
      );
    } else {
      const id = input.action === "leave" ? mine?.room_id : input.roomId;
      const room = id
        ? (
            await db.query(
              "SELECT * FROM app.defense_room WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0]
        : null;
      if (!room || mine?.room_id !== room.id)
        throw invalid(
          "你不在这个房间中。 / You are not a member of this room.",
        );
      if (input.action === "game-code") {
        if (
          room.host_id !== userId ||
          room.status === "closed" ||
          new Date(room.expires_at).getTime() <= Date.now()
        )
          throw invalid(
            "仅房主可更新游戏房间码。 / Only the host can update the game room code.",
          );
        await db.query("UPDATE app.defense_room SET room_code=$1 WHERE id=$2", [
          input.roomCode,
          room.id,
        ]);
      } else if (input.action === "difficulty") {
        if (
          room.host_id !== userId ||
          room.status !== "open" ||
          new Date(room.expires_at).getTime() <= Date.now()
        )
          throw invalid(
            "仅房主可在等待中修改难度。 / Only the host can change difficulty while waiting.",
          );
        if (room.difficulty !== input.difficulty) {
          await db.query(
            "UPDATE app.defense_room SET difficulty=$1 WHERE id=$2",
            [input.difficulty, room.id],
          );
          await db.query(
            "UPDATE app.defense_member SET is_ready=false WHERE room_id=$1",
            [room.id],
          );
        }
      } else if (input.action === "ready") {
        if (
          room.status !== "open" ||
          new Date(room.expires_at).getTime() <= Date.now()
        )
          throw invalid(
            "当前房间不能修改准备状态。 / Readiness cannot change in this room state.",
          );
        if (room.host_id === userId)
          throw invalid(
            "房主请使用开始按钮。 / The host uses the start button.",
          );
        await db.query(
          "UPDATE app.defense_member SET is_ready=$1 WHERE user_id=$2 AND room_id=$3",
          [input.isReady, userId, room.id],
        );
      } else if (input.action === "leave" && room.host_id !== userId) {
        await db.query("DELETE FROM app.defense_member WHERE user_id=$1", [
          userId,
        ]);
        await db.query(
          "UPDATE app.defense_member SET is_ready=false WHERE room_id=$1",
          [room.id],
        );
        await db.query(
          "UPDATE app.defense_room SET status='open' WHERE id=$1 AND expires_at>now()",
          [room.id],
        );
      } else {
        if (room.host_id !== userId)
          throw invalid(
            "仅房主可以操作。 / Only the host can perform this action.",
          );
        if (input.action === "start") {
          const state = (
            await db.query(
              "SELECT count(*) AS total,count(*) FILTER(WHERE user_id<>$2 AND NOT is_ready) AS unready FROM app.defense_member WHERE room_id=$1",
              [room.id, userId],
            )
          ).rows[0];
          if (
            room.status !== "open" ||
            new Date(room.expires_at).getTime() <= Date.now() ||
            !room.room_code ||
            Number(state.total) !== TEAM_CAPACITY ||
            Number(state.unready) !== 0
          )
            throw invalid(
              "房主提供游戏房间码、四人到齐且全部准备后才能开始。 / A game room code and four ready players are required to start.",
            );
          await db.query(
            "UPDATE app.defense_room SET status='started' WHERE id=$1",
            [room.id],
          );
        } else {
          await db.query(
            "UPDATE app.defense_room SET status='closed' WHERE id=$1",
            [room.id],
          );
          await db.query("DELETE FROM app.defense_member WHERE room_id=$1", [
            room.id,
          ]);
        }
      }
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
