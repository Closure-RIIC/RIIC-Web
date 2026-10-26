import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { URL } from "node:url";

test("four-player room concurrency, membership, host permissions, expiry and code privacy", async (t) => {
  const connection = process.env.AUTH_INTEGRATION_DATABASE_URL;
  if (!connection) {
    t.skip("Set an isolated AUTH_INTEGRATION_DATABASE_URL");
    return;
  }
  if (!/^(?:riic_defense_.*_test|arknights_auth_test)$/.test(new URL(connection).pathname.slice(1)))
    throw new Error("Use an isolated riic_defense_*_test database or the dedicated CI arknights_auth_test database");
  process.env.DATABASE_URL = connection;
  const { getDatabasePool } = await import("@riic/platform-server/db");
  const {
    mutateDefenseRoom: act,
    listDefenseRooms: list,
    getDefenseProfile: profile,
  } = await import("./defense-team.ts");
  const pool = getDatabasePool();
  const users = Array.from(
    { length: 10 },
    (_, i) => `defense-test-${Date.now()}-${i}`,
  );
  try {
    for (const id of users)
      await pool.query(
        'INSERT INTO public."user" (id,name,email,email_verified) VALUES ($1,$1,$2,true)',
        [id, `${id}@example.invalid`],
      );
    const create = async (user, server = "official", preferences = {}) => {
      await act(user, {
        action: "create",
        server,
        title: "Fixture",
        roomCode: "PRIVATE-CODE",
        note: "",
        ...preferences,
      });
      return (await list(user)).find((room) => room.joined).id;
    };
    const id = await create(users[0]);
    assert.equal(
      (await list(users[9])).find((room) => room.id === id).roomCode,
      null,
    );
    await assert.rejects(() => create(users[0]));
    await assert.rejects(() => act(users[0], { action: "start", roomId: id }));
    const attempts = await Promise.allSettled(
      users
        .slice(1, 8)
        .map((user) => act(user, { action: "join", roomId: id })),
    );
    assert.equal(
      attempts.filter((result) => result.status === "fulfilled").length,
      3,
    );
    const room = (await list(users[0])).find((room) => room.id === id);
    assert.equal(room.members.length, 4);
    assert.deepEqual(
      room.members.map((m) => m.seat),
      [0, 1, 2, 3],
    );
    assert.equal(room.members.find((m) => m.isHost).seat, 0);
    assert.ok(room.members.every((m) => !m.isReady));
    assert.equal(room.roomCode, "PRIVATE-CODE");
    const member = users
      .slice(1, 8)
      .find((_, i) => attempts[i].status === "fulfilled");
    await assert.rejects(() => act(member, { action: "close", roomId: id }));
    await assert.rejects(
      () => act(users[0], { action: "start", roomId: id }),
      "Full but unready room cannot start",
    );
    await assert.rejects(() =>
      act(users[9], { action: "ready", roomId: id, isReady: true }),
    );
    await assert.rejects(() =>
      act(users[0], { action: "ready", roomId: id, isReady: true }),
    );
    const guests = room.members.filter((m) => !m.isHost).map((m) => m.name);
    await Promise.all(
      guests.map((user) =>
        act(user, { action: "ready", roomId: id, isReady: true }),
      ),
    );
    await act(member, { action: "ready", roomId: id, isReady: false });
    await assert.rejects(
      () => act(users[0], { action: "start", roomId: id }),
      "Cancel ready prevents starting",
    );
    await act(member, { action: "ready", roomId: id, isReady: true });
    await assert.rejects(() =>
      act(member, { action: "difficulty", roomId: id, difficulty: "ac2" }),
    );
    await act(users[0], {
      action: "difficulty",
      roomId: id,
      difficulty: "ac2",
    });
    const changed = (await list(users[0])).find((r) => r.id === id);
    assert.equal(changed.difficulty, "ac2");
    assert.ok(
      changed.members.every((m) => !m.isReady),
      "Host difficulty change invalidates old readiness",
    );
    await Promise.all(
      guests.map((user) =>
        act(user, { action: "ready", roomId: id, isReady: true }),
      ),
    );
    assert.equal(
      (await list(users[0]))
        .find((r) => r.id === id)
        .members.filter((m) => m.isReady).length,
      3,
    );
    await act(users[0], { action: "start", roomId: id });
    await assert.rejects(() =>
      act(users[0], { action: "difficulty", roomId: id, difficulty: "ac3" }),
    );
    await assert.rejects(
      () => act(member, { action: "ready", roomId: id, isReady: false }),
      "Started room readiness is immutable",
    );
    await assert.rejects(() => act(users[9], { action: "join", roomId: id }));
    await act(member, { action: "leave" });
    assert.equal(
      (await list(users[0])).find((room) => room.id === id).status,
      "open",
    );
    const afterLeave = (await list(users[0])).find((r) => r.id === id);
    assert.ok(afterLeave.members.every((m) => !m.isReady));
    for (const survivor of afterLeave.members)
      assert.equal(
        survivor.seat,
        room.members.find((m) => m.name === survivor.name).seat,
        "Leaving does not shift other seats",
      );
    await act(users[9], { action: "join", roomId: id });
    assert.equal(
      (await list(users[9]))
        .find((r) => r.id === id)
        .members.find((m) => m.isMe).seat,
      room.members.find((m) => m.name === member).seat,
      "New member fills the empty seat",
    );
    await act(users[0], { action: "close", roomId: id });
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT count(*) AS n FROM app.defense_member WHERE room_id=$1",
            [id],
          )
        ).rows[0].n,
      ),
      0,
    );
    const first = await create(users[0]),
      second = await create(users[1], "bilibili");
    const duplicate = await Promise.allSettled(
      [first, second].map((roomId) =>
        act(users[8], { action: "join", roomId }),
      ),
    );
    assert.equal(
      duplicate.filter((result) => result.status === "fulfilled").length,
      1,
    );
    await act(users[9], {
      action: "quick",
      server: "bilibili",
      useProfileBonds: false,
      preferredBonds: ["yan", "sargon"],
    });
    assert.equal((await list(users[9])).find((room) => room.joined).id, second);
    await pool.query(
      "UPDATE app.defense_room SET expires_at=now()-interval '1 second' WHERE id=$1",
      [second],
    );
    await create(users[9]);
    assert.equal(
      (await list(users[9])).some((room) => room.id === second),
      false,
    );
    await pool.query(
      "DELETE FROM app.defense_room WHERE host_id=ANY($1::text[])",
      [users],
    );
    const firstDifficulty = await create(users[0], "official", {
      difficulty: "ac2",
    });
    const fourthDifficulty = await create(users[1], "official", {
      difficulty: "ac4",
    });
    await assert.rejects(() =>
      act(users[3], { action: "quick", server: "official", difficulty: "ac3" }),
    );
    await act(users[3], {
      action: "quick",
      server: "official",
      difficulty: "ac4",
      useProfileBonds: false,
      preferredBonds: ["yan", "sargon"],
    });
    const matched = (await list(users[3])).find((room) => room.joined);
    assert.equal(matched.id, fourthDifficulty);
    assert.notEqual(matched.id, firstDifficulty);
    assert.equal(matched.difficulty, "ac4");
    assert.equal(
      matched.roomCode,
      "PRIVATE-CODE",
      "A matched teammate receives the game code immediately",
    );
    assert.equal("teamStyle" in matched, false);
    assert.equal("communication" in matched, false);
    assert.deepEqual((await profile(users[3])).favoriteFactions, []);

    await assert.rejects(() =>
      act(users[3], {
        action: "profile",
        profileOwner: users[0],
        favoriteFactions: ["yan"],
      }),
    );
    await act(users[3], {
      action: "profile",
      profileOwner: users[3],
      favoriteFactions: ["kazimierz", "yan", "harmony", "technique"],
      portrait: "char_002_amiya",
    });
    assert.deepEqual((await profile(users[3])).favoriteFactions, [
      "kazimierz",
      "yan",
      "harmony",
      "technique",
    ]);
    assert.deepEqual((await profile(users[0])).favoriteFactions, []);
    assert.equal((await profile(users[3])).portrait, "char_002_amiya");
    assert.equal((await profile(users[0])).portrait, "default");
    const publicRoom = (await list(users[9])).find(
      (room) => room.id === fourthDifficulty,
    );
    assert.equal(
      publicRoom.members.some(
        (member) =>
          JSON.stringify(member.favoriteFactions) ===
          JSON.stringify(["kazimierz", "yan", "harmony", "technique"]),
      ),
      true,
    );
    assert.equal(publicRoom.members.find(member => member.portrait === "char_002_amiya")?.portrait, "char_002_amiya");
    assert.equal(publicRoom.roomCode, null);
    await act(users[3], { action: "leave" });
    assert.deepEqual(
      (await profile(users[3])).favoriteFactions,
      ["kazimierz", "yan", "harmony", "technique"],
      "Profile survives room exit",
    );
    const { DEFENSE_FACTIONS } = await import("../defense-team-validation.ts");
    await assert.rejects(
      () =>
        act(users[3], {
          action: "profile",
          profileOwner: users[3],
          favoriteFactions: [...DEFENSE_FACTIONS],
        }),
      "Eight core bonds cannot bypass the maximum",
    );
    const maximumAllowed = [
      ...DEFENSE_FACTIONS.slice(0, 4),
      ...DEFENSE_FACTIONS.slice(8),
    ];
    await act(users[3], {
      action: "profile",
      profileOwner: users[3],
      favoriteFactions: maximumAllowed,
    });
    assert.deepEqual(
      (await profile(users[3])).favoriteFactions,
      maximumAllowed,
    );
    await assert.rejects(
      () =>
        act(users[3], {
          action: "profile",
          profileOwner: users[3],
          favoriteFactions: [],
        }),
      "Cannot save fewer than two core bonds",
    );
    await pool.query("DELETE FROM app.defense_profile WHERE user_id=$1", [
      users[3],
    ]);
    assert.deepEqual((await profile(users[3])).favoriteFactions, []);
    // Start an isolated matching pool after the baseline room/profile checks.
    await pool.query(
      "UPDATE app.defense_room SET status='closed' WHERE host_id=ANY($1::text[])",
      [users],
    );
    await pool.query(
      "DELETE FROM app.defense_member WHERE user_id=ANY($1::text[])",
      [users],
    );
    const saveBonds = (index, bonds) =>
      act(users[index], {
        action: "profile",
        profileOwner: users[index],
        favoriteFactions: bonds,
      });
    await saveBonds(0, ["yan", "victoria", "harmony"]);
    await saveBonds(1, ["sargon", "laterano", "swift"]);
    await pool.query("DELETE FROM app.defense_profile WHERE user_id=$1", [
      users[2],
    ]);
    await saveBonds(4, ["yan", "victoria", "harmony"]);
    const duplicateRoom = await create(users[0]);
    const complementaryRoom = await create(users[1]);
    const unknownRoom = await create(users[2]);
    await assert.rejects(
      () =>
        act(users[5], {
          action: "quick",
          server: "official",
          useProfileBonds: true,
          preferredBonds: ["yan", "sargon"],
        }),
      "Unconfigured saved profiles cannot bypass the minimum with ignored client preferences",
    );
    await assert.rejects(
      () =>
        act(users[4], {
          action: "quick",
          server: "official",
          useProfileBonds: false,
          preferredBonds: ["yan", "harmony"],
        }),
      "Custom matching also requires two core bonds",
    );
    await act(users[4], {
      action: "quick",
      server: "official",
      useProfileBonds: true,
      preferredBonds: ["sargon", "laterano", "swift"],
    });
    assert.equal(
      (await list(users[4])).find((r) => r.joined).id,
      complementaryRoom,
      "Authoritative profile beats client-supplied bonds and FIFO",
    );
    await act(users[4], { action: "leave" });
    await act(users[4], {
      action: "quick",
      server: "official",
      avoidBondOverlap: false,
    });
    assert.equal(
      (await list(users[4])).find((r) => r.joined).id,
      duplicateRoom,
      "Turning ranking off preserves FIFO",
    );
    await act(users[4], { action: "leave" });
    await act(users[4], {
      action: "quick",
      server: "official",
      useProfileBonds: false,
      preferredBonds: ["sargon", "laterano", "swift"],
    });
    assert.equal(
      (await list(users[4])).find((r) => r.joined).id,
      duplicateRoom,
      "Custom match bonds can override matching without editing profile",
    );
    assert.deepEqual((await profile(users[4])).favoriteFactions, [
      "yan",
      "victoria",
      "harmony",
    ]);
    await act(users[4], { action: "leave" });
    await assert.rejects(
      () =>
        act(users[4], {
          action: "quick",
          server: "official",
          requiredCoreBonds: ["sargon"],
          requiredAddonBonds: ["harmony"],
        }),
      "Incoming bonds do not satisfy required team filters",
    );
    await saveBonds(8, ["aegir", "kjerag", "harmony"]);
    await act(users[8], { action: "join", roomId: complementaryRoom });
    await act(users[4], {
      action: "quick",
      server: "official",
      requiredCoreBonds: ["sargon"],
      requiredAddonBonds: ["harmony"],
    });
    assert.equal(
      (await list(users[4])).find((r) => r.joined).id,
      complementaryRoom,
      "Different members may satisfy the two required groups",
    );
    await act(users[4], { action: "leave" });
    await act(users[1], { action: "close", roomId: complementaryRoom });
    await act(users[2], { action: "close", roomId: unknownRoom });
    await act(users[4], { action: "quick", server: "official" });
    assert.equal(
      (await list(users[4])).find((r) => r.joined).id,
      duplicateRoom,
      "High overlap is a soft preference, not a rejection",
    );
    const invite = (await list(users[0])).find(
      (r) => r.id === duplicateRoom,
    ).inviteCode;
    assert.match(invite, /^[0-9A-F]{8}$/);
    await act(users[5], {
      action: "join-code",
      server: "official",
      inviteCode: invite.toLowerCase(),
    });
    assert.equal(
      (await list(users[5])).find((r) => r.joined).id,
      duplicateRoom,
      "Match codes join the right room",
    );
    await act(users[5], { action: "leave" });
    await assert.rejects(() =>
      act(users[5], {
        action: "join-code",
        server: "bilibili",
        inviteCode: invite,
      }),
    );
    const otherMatchRoom = await create(users[6]);
    const otherInvite = (await list(users[6])).find(
      (r) => r.id === otherMatchRoom,
    ).inviteCode;
    assert.notEqual(
      otherInvite,
      invite,
      "Identical game codes still have distinct match codes",
    );
    await act(users[5], {
      action: "join-code",
      server: "official",
      inviteCode: otherInvite,
    });
    assert.equal(
      (await list(users[5])).find((r) => r.joined).id,
      otherMatchRoom,
    );
    await act(users[5], { action: "leave" });
    await assert.rejects(() =>
      pool.query("UPDATE app.defense_room SET invite_code=$1 WHERE id=$2", [
        invite,
        otherMatchRoom,
      ]),
    );
    await act(users[4], { action: "leave" });
    const concurrentRooms = [
      await create(users[2], "official", { difficulty: "ac2" }),
      await create(users[3], "official", { difficulty: "ac2" }),
    ];
    const contenders = [4, 5, 7, 8, 9];
    const quickResults = await Promise.allSettled(
      contenders.map((i) =>
        act(users[i], {
          action: "quick",
          server: "official",
          difficulty: "ac2",
          useProfileBonds: false,
          preferredBonds: ["yan", "sargon"],
        }),
      ),
    );
    assert.equal(
      quickResults.filter((r) => r.status === "fulfilled").length,
      5,
      "Concurrent matches use available slots even when the preferred room is locked",
    );
    const concurrentState = (await list(users[9])).filter((r) =>
      concurrentRooms.includes(r.id),
    );
    assert.equal(
      concurrentState.reduce((sum, r) => sum + r.members.length, 0),
      7,
    );
    assert.ok(concurrentState.every((r) => r.members.length <= 4));
    // A match room can exist before the game room; only joined members receive its game code.
    await pool.query(
      "UPDATE app.defense_room SET status='closed' WHERE host_id=ANY($1::text[])",
      [users],
    );
    await pool.query(
      "DELETE FROM app.defense_member WHERE user_id=ANY($1::text[])",
      [users],
    );
    const deferred = await create(users[0], "official", { roomCode: "" });
    const deferredInvite = (await list(users[0])).find(
      (r) => r.id === deferred,
    ).inviteCode;
    assert.equal(
      (await list(users[0])).find((r) => r.id === deferred).roomCode,
      null,
    );
    await act(users[1], {
      action: "quick",
      server: "official",
      useProfileBonds: false,
      preferredBonds: ["yan", "sargon"],
    });
    assert.equal(
      (await list(users[1])).find((r) => r.joined).id,
      deferred,
      "Quick matching enters a match room even before the game room exists",
    );
    for (const user of users.slice(2, 4))
      await act(user, { action: "join", roomId: deferred });
    for (const user of users.slice(1, 4))
      await act(user, { action: "ready", roomId: deferred, isReady: true });
    await assert.rejects(
      () => act(users[0], { action: "start", roomId: deferred }),
      "Cannot depart before the host provides a game room code",
    );
    await assert.rejects(
      () =>
        act(users[1], {
          action: "game-code",
          roomId: deferred,
          roomCode: "INTRUDER",
        }),
      "Guest cannot overwrite host game code",
    );
    await assert.rejects(() =>
      act(users[9], {
        action: "game-code",
        roomId: deferred,
        roomCode: "INTRUDER",
      }),
    );
    await act(users[0], {
      action: "game-code",
      roomId: deferred,
      roomCode: "GAME-123",
    });
    for (const user of users.slice(0, 4))
      assert.equal(
        (await list(user)).find((r) => r.id === deferred).roomCode,
        "GAME-123",
      );
    assert.equal(
      (await list(users[9])).find((r) => r.id === deferred).roomCode,
      null,
      "Public lobby never exposes the game room code",
    );
    assert.equal(
      (await list(users[1])).find((r) => r.id === deferred).inviteCode,
      deferredInvite,
    );
    await act(users[0], {
      action: "game-code",
      roomId: deferred,
      roomCode: "",
    });
    await assert.rejects(() =>
      act(users[0], { action: "start", roomId: deferred }),
    );
    await act(users[0], {
      action: "game-code",
      roomId: deferred,
      roomCode: "GAME-456",
    });
    await act(users[0], { action: "start", roomId: deferred });
    await act(users[0], {
      action: "game-code",
      roomId: deferred,
      roomCode: "GAME-UPDATED",
    });
    assert.equal(
      (await list(users[1])).find((r) => r.id === deferred).roomCode,
      "GAME-UPDATED",
    );
    assert.equal(
      (await list(users[1])).find((r) => r.id === deferred).inviteCode,
      deferredInvite,
      "Updating the game code does not break invitations",
    );
    await act(users[1], { action: "leave" });
    await act(users[0], {
      action: "game-code",
      roomId: deferred,
      roomCode: "CURRENT-MEMBERS-ONLY",
    });
    assert.equal(
      (await list(users[1])).find((r) => r.id === deferred).roomCode,
      null,
      "Former members cannot fetch later code updates",
    );
  } finally {
    await pool.query(
      "DELETE FROM app.defense_room WHERE host_id=ANY($1::text[])",
      [users],
    );
    await pool.query('DELETE FROM public."user" WHERE id=ANY($1::text[])', [
      users,
    ]);
    await pool.end();
  }
});
