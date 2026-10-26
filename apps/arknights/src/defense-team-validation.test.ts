import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDefenseInput,
  TEAM_CAPACITY,
  parseTeamPreferences,
  parseFavoriteFactions,
  matchesTeamPreferences,
  DEFENSE_FACTIONS,
  validCoreBondSelection,
} from "./defense-team-validation.ts";

test("difficulty remains a match condition and faction preferences belong to a profile", () => {
  const wanted = { difficulty: "ac4" } as const;
  assert.deepEqual(parseTeamPreferences(wanted), wanted);
  assert.equal(parseTeamPreferences({ difficulty: "ac5" }), null);
  assert.deepEqual(
    parseTeamPreferences({
      difficulty: "ac1",
      teamStyle: "old",
      communication: "old",
    }),
    { difficulty: "ac1" },
  );
  assert.equal(matchesTeamPreferences(wanted, wanted), true);
  assert.equal(matchesTeamPreferences({ difficulty: "ac1" }, wanted), false);
  assert.equal(
    matchesTeamPreferences({ difficulty: "ac1" }, { difficulty: "any" }),
    true,
  );
  assert.deepEqual(parseFavoriteFactions(["yan", "kazimierz"]), [
    "kazimierz",
    "yan",
  ]);
  assert.deepEqual(parseFavoriteFactions([]), []);
  for (const value of [
    null,
    {},
    ["unknown"],
    ["yan", "yan"],
    Array(9).fill("yan"),
  ])
    assert.equal(parseFavoriteFactions(value), null);
  assert.equal(
    parseDefenseInput({ action: "profile", favoriteFactions: ["yan"] }),
    null,
  );
  assert.equal(
    parseDefenseInput({
      action: "profile",
      profileOwner: "me",
      favoriteFactions: ["unknown"],
    }),
    null,
  );
  assert.deepEqual(
    parseDefenseInput({
      action: "profile",
      profileOwner: "me",
      favoriteFactions: ["yan", "sargon"],
    })?.favoriteFactions,
    ["sargon", "yan"],
  );
});

test("core and add-on bonds round-trip together without losing legacy choices", () => {
  assert.equal(DEFENSE_FACTIONS.length, 23);
  assert.deepEqual(parseFavoriteFactions(["technique", "harmony", "yan"]), [
    "yan",
    "harmony",
    "technique",
  ]);
  assert.deepEqual(parseFavoriteFactions([...DEFENSE_FACTIONS]), [
    ...DEFENSE_FACTIONS,
  ]);
  assert.equal(parseFavoriteFactions(["harmony", "harmony"]), null);
  assert.equal(parseFavoriteFactions(["technique", "not-a-bond"]), null);
  assert.deepEqual(
    parseDefenseInput({
      action: "profile",
      profileOwner: "me",
      favoriteFactions: ["yan", "sargon", "harmony", "technique"],
    })?.favoriteFactions,
    ["sargon", "yan", "harmony", "technique"],
  );
});

test("personal core bonds require two to four, add-ons cannot satisfy the minimum", () => {
  for (const bonds of [
    [],
    ["yan"],
    ["yan", "harmony"],
    ["yan", "sargon", "victoria", "kjerag", "aegir"],
  ] as const) {
    assert.equal(validCoreBondSelection(bonds), false);
    assert.equal(
      parseDefenseInput({
        action: "profile",
        profileOwner: "me",
        favoriteFactions: bonds,
      }),
      null,
    );
    assert.equal(
      parseDefenseInput({
        action: "quick",
        server: "official",
        useProfileBonds: false,
        preferredBonds: bonds,
      }),
      null,
    );
  }
  assert.equal(validCoreBondSelection(["yan", "sargon"]), true);
  assert.equal(
    validCoreBondSelection([
      "yan",
      "sargon",
      "victoria",
      "kjerag",
      "harmony",
      "swift",
    ]),
    true,
  );
  assert.ok(
    parseDefenseInput({
      action: "profile",
      profileOwner: "me",
      favoriteFactions: ["yan", "sargon", "victoria", "kjerag", "harmony"],
    }),
  );
});

test("match rooms allow deferred game codes; updates and invites validate separate fields", () => {
  assert.equal(
    parseDefenseInput({ action: "create", server: "official", title: "Match" })
      ?.roomCode,
    "",
  );
  assert.equal(
    parseDefenseInput({
      action: "game-code",
      roomId: "r",
      roomCode: "  GAME-123 ",
    })?.roomCode,
    "GAME-123",
  );
  assert.equal(
    parseDefenseInput({ action: "game-code", roomId: "r", roomCode: "" })
      ?.roomCode,
    "",
  );
  for (const body of [
    { action: "game-code", roomCode: "ABC" },
    { action: "game-code", roomId: "r" },
    { action: "game-code", roomId: "r", roomCode: "x".repeat(41) },
    { action: "create", server: "official", title: "Match", roomCode: 123 },
  ])
    assert.equal(parseDefenseInput(body), null);
});

test("four-player room input bounds text and requires a known action and server", () => {
  assert.equal(TEAM_CAPACITY, 4);
  assert.equal(
    parseDefenseInput({
      action: "create",
      server: "official",
      title: " Test ",
      roomCode: " 123 ",
    })?.title,
    "Test",
  );
  for (const body of [
    null,
    [],
    {},
    { action: "delete" },
    { action: "join" },
    { action: "create", server: "other", title: "x", roomCode: "x" },
    {
      action: "create",
      server: "official",
      title: "x".repeat(41),
      roomCode: "x",
    },
    {
      action: "create",
      server: "official",
      title: "x",
      roomCode: "x",
      note: "x".repeat(161),
    },
  ])
    assert.equal(parseDefenseInput(body), null);
  assert.equal(
    parseDefenseInput({ action: "quick", server: "bilibili" })?.action,
    "quick",
  );
  assert.equal(parseDefenseInput({ action: "leave" })?.action, "leave");
  assert.equal(
    parseDefenseInput({ action: "ready", roomId: "r", isReady: true })?.isReady,
    true,
  );
  assert.equal(
    parseDefenseInput({ action: "ready", roomId: "r", isReady: false })
      ?.isReady,
    false,
  );
  for (const body of [
    { action: "ready", roomId: "r" },
    { action: "ready", roomId: "r", isReady: "true" },
    { action: "ready", isReady: true },
  ])
    assert.equal(parseDefenseInput(body), null);
  assert.equal(
    parseDefenseInput({
      action: "join-code",
      server: "official",
      inviteCode: " ABC ",
    })?.inviteCode,
    "ABC",
  );
  for (const body of [
    { action: "join-code", server: "official", inviteCode: "" },
    { action: "join-code", server: "other", inviteCode: "x" },
    { action: "join-code", server: "official", inviteCode: "x".repeat(65) },
  ])
    assert.equal(parseDefenseInput(body), null);
});

test("personal portraits accept only known local artwork", () => {
  const profile = { action: "profile", profileOwner: "test", favoriteFactions: ["yan", "sargon"] };
  for (const portrait of ["default", "portrait-1", "portrait-2", "char_002_amiya"]) assert.equal(parseDefenseInput({ ...profile, portrait })?.portrait, portrait);
  for (const portrait of ["https://example.com/a.png", "../secret", "char_999999_unknown", "char_002_amiya/../../secret", null, 1]) {
    assert.equal(parseDefenseInput({ ...profile, portrait }), null);
  }
});

 test("operator illustrations search by Chinese, pinyin and initials and use pinned local images", async () => {
  const { searchDefensePortraits, defensePortraitUrl, DEFENSE_OPERATOR_PORTRAITS } = await import("./defense-portraits.ts");
  assert.equal(DEFENSE_OPERATOR_PORTRAITS.length, 432);
  for (const query of ["阿米娅", "amiya", "amy", " AMIYA "]) {
    assert.ok(searchDefensePortraits(query).some((operator) => operator.id === "char_002_amiya"));
  }
  assert.deepEqual(searchDefensePortraits("没有这名干员xyz"), []);
  assert.match(defensePortraitUrl("char_002_amiya"), /^\/images\/defense-operators\/char_002_amiya\.webp\?v=[a-f0-9]{12}$/);
  assert.equal(defensePortraitUrl("default", 1), "/images/defense-reference/waiting-portrait-2.png");
});
