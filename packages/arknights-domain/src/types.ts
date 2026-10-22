export interface TradeProduct {
  trade: { order: "gold" | "originium" };
}

export interface FactoryProduct {
  factory: { recipe: "all" | "gold" | "battle_record" | "originium" };
}

export type RoomProduct = TradeProduct | FactoryProduct;

export type RoomKind =
  | "control_center"
  | "trade_post"
  | "factory"
  | "power_plant"
  | "dormitory"
  | "office"
  | "meeting_room"
  | "workshop"
  | "training_room";

export interface BlueprintRoom {
  id: string;
  kind: RoomKind;
  level: number;
  product?: RoomProduct;
  dorm_beds?: number;
}

export interface BaseBlueprint {
  template: string;
  drone_cap: number;
  scenario: {
    elite_facility_count?: number;
    sui_facility_count?: number;
    dorm_occupant_count?: number;
    base_workforce?: string[];
    initial_global?: {
      monster_cuisine?: number;
    };
  };
  rooms: BlueprintRoom[];
}

export interface PresetDef {
  label: "243" | "153" | "333" | "252" | "342";
  trading: number;
  manufacture: number;
  power: number;
  layout: BaseBlueprint;
}

export interface OperBoxEntry {
  id: string;
  name: string;
  elite: number;
  level: number;
  own: boolean;
  potential: number;
  rarity: number;
}

export interface MaaOperatorSlot {
  name?: string;
  skill?: number;
}

export type MaaExecutionOrder = "pre" | "post";
export type MaaPeriod = [start: string, end: string];

export interface MaaOperatorGroup {
  name: string;
  operators: string[];
}

export interface MaaRoom {
  operators: (string | MaaOperatorSlot | null)[];
  product?: string;
  skip?: boolean;
  sort?: boolean;
  autofill?: boolean;
  candidates?: string[];
  use_operator_groups?: boolean;
}

export interface MaaRooms {
  trading?: MaaRoom[];
  manufacture?: MaaRoom[];
  power?: MaaRoom[];
  control?: MaaRoom[];
  dormitory?: MaaRoom[];
  meeting?: MaaRoom[];
  hire?: MaaRoom[];
  processing?: MaaRoom[];
}

export interface MaaPlan {
  name: string;
  description?: string;
  description_post?: string;
  period?: MaaPeriod[];
  duration?: number;
  groups?: MaaOperatorGroup[];
  rooms: MaaRooms;
  Fiammetta?: { enable: boolean; target?: string | string[]; order?: MaaExecutionOrder };
  drones?: {
    enable?: boolean;
    room: "trading" | "manufacture";
    index: number;
    rule?: string;
    order: MaaExecutionOrder;
  };
}

export interface MaaJson {
  author?: string;
  id?: string | number;
  title: string;
  description?: string;
  planTimes?: string | number;
  plans: MaaPlan[];
  scheduleType?: {
    planTimes: number;
    trading?: number;
    manufacture?: number;
    power?: number;
    dormitory?: number;
  };
}

export interface TrainingRoomShift {
  trainee: string | null;
  trainer: string | null;
}

export interface TrainingRoomSchedule {
  schema_version: 1;
  shifts: TrainingRoomShift[];
}

export interface RoomEfficiency {
  final_efficiency?: number;
  /** serve 新输出：纸面总计（订单倍率前）。 */
  total_efficiency?: number;
  /** serve 新输出：贸易订单倍率（非贸易房为 1.0）。 */
  order_multiplier?: number;
  base_efficiency?: number;
  equivalent_efficiency?: number;
  /** 贸易站特殊机制按赤金价值折算的等效效率。 */
  gold_equivalent_efficiency?: number;
  global_efficiency?: number;
  /** 贸易等效效率（含订单机制倍率效果，用于展示"等效 × 倍率"标注）。 */
  trade_equivalent_efficiency?: number;
  trade_score?: number;
  trade_pct?: number;
  trade_skill_pct?: number;
  trade_display_pct?: number;
  trade_gold_pct?: number;
  manu_score?: number;
  manu_prod_total?: number;
  manu_prod_skill?: number;
  manu_display_pct?: number;
  manu_storage_limit?: number;
  power_score?: number;
  power_skill_pct?: number;
  power_display_pct?: number;
  power_charge_speed_pct?: number;
}

export interface RotationRoomLine extends RoomEfficiency {
  room_id: string;
}

export interface RotationShift {
  index: number;
  duration_hours: number;
  active_teams: string[];
  resting_team: string;
  scores: {
    trade_score: number;
    manu_prod_sum: number;
    power_charge_sum: number;
    room_lines: RotationRoomLine[];
  };
  weighted_trade: number;
  weighted_manu: number;
  weighted_power: number;
}

export interface RotationJson {
  profile: RotationProfile;
  shifts: RotationShift[];
  daily: {
    trade: number | null;
    manufacture: number | null;
    power: number | null;
    production?: {
      lmd: number;
      pure_gold: number;
      battle_records: number;
      originium_shards: number;
      orundum: number;
      /** 可露希尔/龙舌兰贸易站产生的每日等效赤金价值。 */
      equivalent_gold?: number;
    };
    drone_production?: {
      lmd: number;
      pure_gold: number;
      battle_records: number;
    };
  };
}

/** plan.compute 响应里的练卡建议报告（PlayerTrainingAdviceReport v2）。 */
export type TrainingAdviceNewbieSectionStatus = "shown" | "complete" | "skipped_by_efficiency";
export type TrainingAdviceAction = "acquire" | "train";
export type TrainingAdviceProduct =
  | "trade"
  | "gold"
  | "experience"
  | "general_manufacturing"
  | "originium_shards";
export type TrainingAdviceTargetKind =
  | "explicit"
  | "no_requirement"
  | "derive_from_skill_binding"
  | "needs_review";
export type TrainingAdviceAcquisitionKind =
  | "shop"
  | "public_recruitment"
  | "event"
  | "redeem_code"
  | "integrated_strategy";
export type TrainingAdviceCombinationState =
  | "complete"
  | "needs_training"
  | "missing_core"
  | "missing_important"
  | "needs_review";
export type TrainingAdviceMemberRole = "core" | "important" | "secondary" | "hanger";
export type TrainingAdviceMemberProgress = "missing" | "owned_needs_training" | "ready" | "needs_review";
export type TrainingAdvicePriority =
  | "newbie_four_star_elite_one"
  | "flagship_newbie"
  | "other_newbie"
  | "owned_tailor"
  | "automation_must_train"
  | "small_high_efficiency_core"
  | "small_high_efficiency_important"
  | "system_single_core_gap"
  | "other_important"
  | "lower_priority_core"
  | "high_efficiency_standalone";
export type TrainingAdviceReason =
  | "newbie_required"
  | "combination_core"
  | "combination_important"
  | "standalone";
export type TrainingAdviceJsonValue =
  | null
  | boolean
  | number
  | string
  | TrainingAdviceJsonValue[]
  | { [key: string]: TrainingAdviceJsonValue };

export interface TrainingAdviceReport {
  schema_version: 2;
  context: TrainingAdviceContext;
  newbie_section_status: TrainingAdviceNewbieSectionStatus;
  incomplete_newbie: TrainingNewbieItem[];
  combinations: TrainingCombination[];
  recommendations: TrainingRecommendation[];
}

export interface TrainingAdviceContext {
  dormitory_level_sum?: number;
  engineering_robot_count?: number;
  has_originium_shard_factory?: boolean;
  manufacturing_average_efficiency_percent?: number;
  meeting_room_max_level?: number;
  trade_average_efficiency_percent?: number;
}

export interface TrainingAdviceState {
  elite: number;
  level?: number;
}

export interface TrainingAdviceTarget {
  kind: TrainingAdviceTargetKind;
  elite?: number;
  level?: number;
}

export interface TrainingAdviceAcquisition {
  kind: TrainingAdviceAcquisitionKind;
  detail: string;
}

export interface TrainingAdviceCondition {
  kind: "layout" | "facility" | "same_station" | "dormitory" | "engineering_robots" | "custom";
  key: string;
  value?: TrainingAdviceJsonValue;
  description: string;
}

export interface TrainingAdviceConditionEvaluation {
  condition: TrainingAdviceCondition;
  status: "satisfied" | "unsatisfied" | "unknown";
}

export interface TrainingAdviceEfficiency {
  value: number;
  unit: "order_percent" | "production_percent";
  note?: string;
}

export interface TrainingAdviceMember {
  operator: string;
  role: TrainingAdviceMemberRole;
  owned: boolean;
  progress: TrainingAdviceMemberProgress;
  current?: TrainingAdviceState;
  target: TrainingAdviceTarget;
  target_met: boolean;
  counts_toward_completion: boolean;
}

export interface TrainingCombination {
  id: string;
  name: string;
  product?: TrainingAdviceProduct;
  consumer_products?: TrainingAdviceProduct[];
  scale: "small" | "system";
  tier?: "high_efficiency" | "low_efficiency";
  state: TrainingAdviceCombinationState;
  completed_slots: number;
  total_slots: number;
  completion_percent: number;
  facilities: string[];
  members: TrainingAdviceMember[];
  missing_core?: string[];
  missing_important?: string[];
  untrained_core?: string[];
  untrained_important?: string[];
  selected_alternative?: number;
}

export interface TrainingRecommendation {
  action: TrainingAdviceAction;
  operator: string;
  combination_id?: string;
  combination_name?: string;
  product?: TrainingAdviceProduct;
  priority: TrainingAdvicePriority;
  priority_rank: number;
  reason: TrainingAdviceReason;
  target: TrainingAdviceTarget;
  current?: TrainingAdviceState;
  efficiency?: TrainingAdviceEfficiency;
  conditions?: TrainingAdviceConditionEvaluation[];
  acquisition?: TrainingAdviceAcquisition;
}

export interface TrainingNewbieItem {
  action: TrainingAdviceAction;
  operator: string;
  product: TrainingAdviceProduct;
  target: TrainingAdviceTarget;
  current?: TrainingAdviceState;
  acquisition?: TrainingAdviceAcquisition;
}

export interface CliCandidate {
  path: string;
  exists: boolean;
  compatible: boolean;
  reason: string | null;
}

export interface SolverPingFingerprint {
  elapsedMs: number | null;
  envelopeSolverGitCommit: string | null;
  envelopeSolverBuiltAt: string | null;
  pong: boolean;
  protocolVersion: number | null;
  planSchemaVersion: number | null;
  supportedPlanSchemaVersions: number[];
  planContractSha256: string | null;
  planContractSha256ByVersion: Array<{
    version: number;
    sha256: string;
  }>;
  solverExecutableSha256: string | null;
  solverGitCommit: string | null;
  solverBuiltAt: string | null;
}

export interface HealthApiResponse {
  ok: boolean;
  apiReady?: boolean;
  cliReady?: boolean;
  cliPath?: string | null;
  serve?: {
    cliPath?: string | null;
    pid?: number | null;
    running: boolean;
    restartCount: number;
    protocolMode?: "plan.compute" | "legacy";
    planCompute?: {
      supported: boolean;
      protocolVersion: number | null;
      schemaVersion: number | null;
      contractSha256: string | null;
      solverExecutableSha256: string | null;
      reason: string | null;
    };
    fingerprint?: SolverPingFingerprint;
  };
  serveError?: string | null;
  candidates?: CliCandidate[];
  coreRoot?: string;
  repoRoot?: string;
  bundledCliRoot?: string;
  bundledDataRoot?: string;
  samplePath?: string | null;
  dataPath?: string | null;
  storageRoot?: string;
  feedbackRoot?: string;
  cliRunRoot?: string;
  sklandConfigured?: boolean;
  sklandDisabledReason?: string | null;
  error?: string;
}

export type BoxSource = "skland" | "maa" | "sample";

export interface SklandRole {
  uid: string;
  nickname: string;
  channelName: string;
  isDefault: boolean;
}

export interface SklandAccountSummary {
  accountId: string;
  selectedUid: string;
  roles: SklandRole[];
  credentialExpiresAt: number;
}

export interface SklandPlayer {
  uid: string;
  nickname: string;
  level: number | null;
  channelName: string;
  avatarUrl: string | null;
  registerTs: number | null;
  mainStageProgress: string | null;
  resume: string | null;
  subscriptionEnd: number | null;
  storeTs: number | null;
  lastOnlineTs: number | null;
  sanity: {
    current: number;
    max: number;
    completeRecoveryTime: number | null;
  } | null;
  secretary: {
    id: string;
    name: string;
    skinName: string | null;
  } | null;
  counts: {
    operators: number | null;
    furniture: number | null;
    skins: number | null;
  };
}

export type SklandInfrastructureGroup =
  | "control"
  | "trading"
  | "manufacture"
  | "power"
  | "dormitory"
  | "meeting"
  | "hire"
  | "processing"
  | "training";

export interface SklandInfrastructureOperator {
  id: string;
  name: string;
  morale: number;
  workTime: number;
  lastMoraleUpdateTs: number;
}

export type SklandTrainingPosition = "trainee" | "trainer";

export interface SklandTrainingRoomOperator {
  id: string;
  name: string;
  morale: number;
  lastMoraleUpdateTs: number;
  position: SklandTrainingPosition;
}

export interface SklandInfrastructureProduction {
  stock: number | null;
  capacity: number | null;
  unitCapacity: number | null;
  completed: number | null;
  remaining: number | null;
  completeWorkTime: number | null;
}

export interface SklandInfrastructureRoomBase<
  TGroup extends SklandInfrastructureGroup = SklandInfrastructureGroup,
> {
  key: string;
  group: TGroup;
  index: number;
  level: number;
  operators: SklandInfrastructureOperator[];
}

export interface SklandTradingOrder {
  delivery: Array<{
    type: "material" | "originium_shard";
    count: number;
  }>;
  reward: {
    type: "lmd" | "orundum";
    count: number;
  };
}

export type SklandControlRoom = SklandInfrastructureRoomBase<"control">;

export interface SklandTradingRoom extends SklandInfrastructureRoomBase<"trading"> {
  product: "gold" | "originium";
  production: SklandInfrastructureProduction;
  orders: SklandTradingOrder[];
  lastUpdateTime: number;
}

export interface SklandManufactureRoom extends SklandInfrastructureRoomBase<"manufacture"> {
  product: "gold" | "battle_record" | "originium" | "unknown";
  production: SklandInfrastructureProduction;
  speed: number;
  lastUpdateTime: number;
}

export type SklandPowerRoom = SklandInfrastructureRoomBase<"power">;

export interface SklandDormitoryRoom extends SklandInfrastructureRoomBase<"dormitory"> {
  comfort: number;
}

export interface SklandMeetingRoom extends SklandInfrastructureRoomBase<"meeting"> {
  clue: {
    board: string[];
    own: number;
    received: number;
    dailyReward: boolean;
    needReceive: number;
    sharing: boolean;
    shareCompleteTime: number;
  };
  completeWorkTime: number;
  lastUpdateTime: number;
}

export interface SklandHireRoom extends SklandInfrastructureRoomBase<"hire"> {
  refreshCount: number;
  completeWorkTime: number;
}

export type SklandProcessingRoom = SklandInfrastructureRoomBase<"processing">;

export interface SklandTrainingRoom extends Omit<SklandInfrastructureRoomBase<"training">, "operators"> {
  operators: SklandTrainingRoomOperator[];
  occupancy: {
    current: number;
    capacity: 2;
  };
}

export type SklandInfrastructureRoom =
  | SklandControlRoom
  | SklandTradingRoom
  | SklandManufactureRoom
  | SklandPowerRoom
  | SklandDormitoryRoom
  | SklandMeetingRoom
  | SklandHireRoom
  | SklandProcessingRoom
  | SklandTrainingRoom;

export interface SklandInfrastructure {
  currentTs: number;
  storeTs: number | null;
  layoutLabel: PresetDef["label"] | null;
  layoutSuggestion: BaseBlueprint | null;
  layoutWarning: string | null;
  rooms: SklandInfrastructureRoom[];
  tiredOperators: string[];
  labor: {
    value: number;
    maxValue: number;
    remainSecs: number;
    lastUpdateTime: number;
  };
  furnitureTotal: number;
  training: {
    trainee: string | null;
    trainer: string | null;
    skillIndex: number;
    remainSecs: number;
    remainPoint: number;
    speed: number;
    completeWorkTime: number;
  } | null;
}

export interface SklandScheduleOperator {
  id: string;
  name: string;
  morale: number;
}

export interface SklandScheduleRoom {
  key: string;
  group: Exclude<SklandInfrastructureGroup, "training" | "processing">;
  index: number;
  level: number;
  operators: SklandScheduleOperator[];
  product?: "gold" | "battle_record" | "originium" | "unknown";
}

export interface SklandScheduleInfrastructure {
  storeTs: number | null;
  layoutLabel: PresetDef["label"] | null;
  layoutSuggestion: BaseBlueprint | null;
  layoutWarning: string | null;
  rooms: SklandScheduleRoom[];
  tiredOperators: string[];
}

export interface SklandScheduleSnapshot {
  roles: SklandRole[];
  operbox: OperBoxEntry[];
  infrastructure: SklandScheduleInfrastructure;
  sourceName: string;
  warnings: string[];
}

export interface SklandOperatorModule {
  id: string;
  name: string;
  level: number;
  locked: boolean;
  isDefault: boolean;
}

export interface SklandOperatorStatus {
  id: string;
  name: string;
  rarity: number;
  profession: string;
  subProfessionName: string;
  elite: number;
  level: number;
  potential: number;
  favorPercent: number;
  mainSkillLevel: number;
  skills: Array<{
    index: number;
    specializeLevel: number;
  }>;
  modules: SklandOperatorModule[];
  currentSkinName: string | null;
  acquiredAt: number;
  isAssist: boolean;
}

export interface SklandOwnedSkin {
  id: string;
  name: string;
  brandId: string;
  operatorId: string;
  operatorName: string;
  obtainedAt: number;
  isCurrent: boolean;
}

export interface SklandProgress {
  recruit: Array<{
    index: number;
    startTs: number;
    finishTs: number;
    state: "locked" | "standby" | "recruiting" | "completed";
  }> | null;
  routine: {
    daily: { current: number; total: number };
    weekly: { current: number; total: number };
  } | null;
  campaign: {
    records: Array<{
      name: string;
      zoneName: string | null;
      maxKills: number;
    }>;
    reward: { current: number; total: number };
  } | null;
  tower: {
    records: Array<{
      name: string;
      subName: string;
      best: number;
    }>;
    reward: {
      higher: { current: number; total: number };
      lower: { current: number; total: number };
      termTs: number;
    };
  } | null;
  rogue: Array<{
    name: string;
    relicCount: number;
    bankCurrent: number;
    bankRecord: number;
  }> | null;
  activities: Array<{
    name: string;
    startTime: number;
    endTime: number;
    rewardEndTime: number;
    isReplicate: boolean;
    clearedStages: number;
    totalStages: number;
  }> | null;
  bossRush: Array<{
    played: boolean;
    stageCode: string | null;
    stageName: string | null;
    difficulty: string;
  }> | null;
}

export interface SklandStatusSnapshot {
  player: SklandPlayer;
  roles: SklandRole[];
  operbox: OperBoxEntry[];
  infrastructure: SklandInfrastructure;
  operators: SklandOperatorStatus[];
  skins: SklandOwnedSkin[];
  progress: SklandProgress;
  sourceName: string;
  warnings: string[];
}

export interface SklandAuthMethods {
  qr: true;
  credential: true;
}

export interface SklandBindingSummary {
  totalCount: number;
  activeCount: number;
  renewalDueCount: number;
  nextExpiresAt: number | null;
  latestExpiredAt: number | null;
}

export interface SklandSessionResponse {
  authenticated: boolean;
  configured: boolean;
  authMethods?: SklandAuthMethods;
  disabledReason?: string | null;
  accounts: SklandAccountSummary[];
  activeAccountId: string | null;
  bindingCount: number;
  bindingSummary?: SklandBindingSummary;
  scheduleSnapshot?: SklandScheduleSnapshot;
  statusSnapshot?: SklandStatusSnapshot;
  error?: string;
  code?: string;
}

export interface SklandQrStartResponse {
  success: boolean;
  scanId?: string;
  scanUrl?: string;
  error?: string;
  code?: string;
}

export interface SklandQrStatusResponse {
  success: boolean;
  status: "waiting" | "scanned" | "expired" | "authenticated";
  scheduleSnapshot?: SklandScheduleSnapshot;
  statusSnapshot?: SklandStatusSnapshot;
  bindingCount?: number;
  bindingSummary?: SklandBindingSummary;
  error?: string;
  code?: string;
}

export interface ShiftComparison {
  planIndex: number;
  score: number;
  matched: string[];
  missing: string[];
  unexpected: string[];
  misplaced: string[];
  tiredScheduled: string[];
  adjustments: ShiftAdjustment[];
}

export type ShiftAdjustmentIssue = "missing" | "unexpected" | "misplaced" | "tired";

export interface ShiftAdjustment {
  operator: string;
  currentRoomKey: string | null;
  targetRoomKey: string | null;
  issues: ShiftAdjustmentIssue[];
}

export type Severity = "ok" | "warn" | "critical";

export interface UserProfileSummary {
  owned: number;
  tier_up_owned: number;
  trade_pool_ready: number;
  manufacture_pool_ready?: number;
  manu_pool_ready?: number;
}

export interface UserProfileComboSnapshot {
  operators: string[];
  final_efficiency?: number;
  mechanic_equivalent_efficiency?: number;
  score?: number;
  trade_pct?: number;
  gold_pct?: number;
}

export interface UserProfileDomainMetric {
  id: string;
  label: string;
  current: UserProfileComboSnapshot;
  baseline: UserProfileComboSnapshot;
  gap_ratio: number;
  severity: Severity;
}

export interface UserProfileRotationSnapshot {
  daily_trade_efficiency?: number;
  daily_manufacture_efficiency?: number;
  daily_power_efficiency?: number;
  daily_trade?: number;
  daily_manu?: number;
  daily_power?: number;
}

export interface UserProfileAction {
  priority: string;
  kind: string;
  operator: string;
  domain_id: string;
  message: string;
  current_elite?: number;
  tier_up_requirement?: string;
}

export interface UserProfile {
  schema_version: number;
  rotation_profile?: RotationProfile;
  layout_label: string;
  operbox_label: string;
  baseline_label: string;
  summary: UserProfileSummary;
  domains: UserProfileDomainMetric[];
  rotation: UserProfileRotationSnapshot;
  baseline_rotation: UserProfileRotationSnapshot;
  actions: UserProfileAction[];
  flags: string[];
  narration_hints: string[];
}

export interface SolverObservation {
  protocol_version: number | null;
  plan_schema_version: number | null;
  plan_contract_sha256: string | null;
  solver_executable_sha256: string | null;
  observed_at: string;
}

export interface DebugBundle {
  version: string;
  startedAt: string;
  durationMs: number;
  solverDurationMs?: number;
  solverStartedAt?: string;
  solverFinishedAt?: string;
  cliPath: string;
  command: string;
  exitCode: number | null;
  signal: string | null;
  inputSummary: {
    layoutRooms: number | null;
    operboxCount: number;
    sourceName: string | null;
  };
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  profileJson?: UserProfile;
  maaJson?: MaaJson;
  rotationJson?: RotationJson;
  solver?: SolverObservation;
  shiftFiles?: string[];
  shiftReadErrors?: string[];
  serveRequest?: unknown;
  serveResponse?: unknown;
  stdout: string;
  stderr: string;
  savedFiles?: {
    runDir?: string;
    layout?: string;
    operbox?: string;
    profile?: string;
    maa?: string;
    rotation?: string;
    shifts?: string;
    debugBundle?: string;
    stdout?: string;
    stderr?: string;
    command?: string;
    serveRequest?: string;
    serveRequestLine?: string;
    serveResponse?: string;
    result?: string;
  };
}

export interface FeedbackApiResponse {
  success: boolean;
  feedbackId?: string;
  savedAt?: string;
  path?: string;
  relativePath?: string;
  issuePath?: string;
  operboxPath?: string;
  debugBundlePath?: string;
  relativeIssuePath?: string;
  relativeOperboxPath?: string;
  relativeDebugBundlePath?: string;
  error?: string;
}

export interface PlanComputeParams {
  schema_version: 3;
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  labels?: {
    layout?: string | null;
    operbox?: string | null;
  };
  options?: {
    rotation?: RotationProfile;
    top?: number;
    system_preferences?: Record<string, string>;
    maa_title?: string | null;
    fiammetta_enable?: boolean;
  };
}

export type RotationProfile =
  | "abc_12_6_6"
  | "abc_12_12_12"
  | "main_backup_12_12"
  | "fiammetta_8_8_4_4"
  | "abyssal_7_5_7_5";

export interface PlanApiResponse {
  success: boolean;
  /** Internal execution metadata; fallback output must not populate a primary-solver cache lease. */
  fallbackUsed?: boolean;
  solverAttempts?: Array<{ engine: "primary" | "fallback"; status: "success" | "failed"; durationMs: number; solver?: SolverObservation; error?: string }>;
  startedAt?: string;
  durationMs?: number;
  /** Time reported by the solver process itself, excluding transport and artifact I/O. */
  solverDurationMs?: number;
  solverStartedAt?: string;
  solverFinishedAt?: string;
  cliPath?: string;
  command?: string;
  exitCode?: number | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  profileJson?: UserProfile;
  maaJson?: MaaJson;
  trainingRoomJson?: TrainingRoomSchedule;
  trainingAdviceJson?: TrainingAdviceReport;
  rotationJson?: RotationJson;
  solver?: SolverObservation;
  debugBundle?: DebugBundle;
  runId?: string;
  runPath?: string;
  relativeRunPath?: string;
  resultPath?: string;
  relativeResultPath?: string;
  artifactEnvelopePath?: string;
  relativeArtifactEnvelopePath?: string;
  error?: string;
}

export type AppErrorCode =
  | "AIC-REQ-1001"
  | "AIC-REQ-1002"
  | "AIC-BOX-1101"
  | "AIC-LAYOUT-1201"
  | "AIC-AUTH-2001"
  | "AIC-AUTH-2002"
  | "AIC-AUTH-2003"
  | "AIC-AUTH-2004"
  | "AIC-AUTH-2005"
  | "AIC-AUTH-2006"
  | "AIC-AUTH-2007"
  | "AIC-AUTH-2008"
  | "AIC-AUTH-2009"
  | "AIC-AUTH-2010"
  | "AIC-PLAN-3001"
  | "AIC-PLAN-3002"
  | "AIC-PLAN-3003"
  | "AIC-PLAN-3004"
  | "AIC-PLAN-3005"
  | "AIC-PLAN-3006"
  | "AIC-PLAN-3007"
  | "AIC-PLAN-3008"
  | "AIC-FEEDBACK-4001"
  | "AIC-FEEDBACK-4002"
  | "AIC-FEEDBACK-4003"
  | "AIC-SYS-5000"
  | "AIC-RATE-6001"
  | "AIC-LOCAL-7001"
  | "AIC-DATA-8001"
  | "AIC-DATA-8002"
  | "AIC-DATA-8003"
  | "AIC-DATA-8004"
  | "AIC-DATA-8005"
  | "AIC-RELEASE-9001"
  | "AIC-RELEASE-9002"
  | "AIC-BILLING-4101"
  | "AIC-BILLING-4102"
  | "AIC-BILLING-4103"
  | "AIC-BILLING-4104"
  | "AIC-BILLING-4105"
  | "AIC-BILLING-4106";

export interface ApiFieldError {
  path: string;
  code: string;
  message: string;
}

export type ApiSuccess<T> = {
  success: true;
  data: T;
  requestId: string;
};

export type ApiFailure = {
  success: false;
  error: {
    code: AppErrorCode;
    message: string;
    requestId: string;
    retryable: boolean;
    retryAfterSeconds?: number;
    fieldErrors?: ApiFieldError[];
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface PublicFeatureFlags {
  debugTools: boolean;
  rateLimit: boolean;
}

export interface PublicHealthData {
  status: "ready" | "unavailable";
  plannerReady: boolean;
  taskQueue: {
    enabled: boolean;
    ready: boolean;
    releaseMatched: boolean;
  };
  skland?: {
    available: boolean;
    message: string | null;
  };
  features: PublicFeatureFlags;
}

export interface PublicPlanDebug {
  command?: string;
  stdout?: string;
  stderr?: string;
  debugBundle?: Omit<DebugBundle, "solver">;
}

export interface PublicPlanData {
  profile: UserProfile;
  maa: MaaJson;
  rotation: RotationJson;
  trainingRoom?: TrainingRoomSchedule;
  trainingAdvice?: TrainingAdviceReport;
  durationMs: number;
  diagnosticId: string;
  debug?: PublicPlanDebug;
}

export interface SampleOperboxData {
  sourceName: "243 全精二示例";
  operbox: OperBoxEntry[];
}

export interface FeedbackRoom {
  id: string;
  title: string;
  group: string;
  operators: string[];
}

export type FeedbackKind = "room_issue" | "performance_issue";

export interface FeedbackReproductionSnapshot {
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  rotation: RotationProfile;
  fiammettaEnabled: boolean;
  sourceType: Exclude<BoxSource, "sample">;
}

type FeedbackRequestBase = {
  diagnosticId: string;
  note: string;
  consent: true;
  reproduction: FeedbackReproductionSnapshot;
};

export type FeedbackRequest = FeedbackRequestBase & (
  | { kind?: "room_issue"; room: FeedbackRoom }
  | { kind: "performance_issue"; room?: never }
);

export interface FeedbackData {
  feedbackId: string;
  savedAt: string;
}

export interface AccountDataConsentData {
  current: boolean;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  cloudSyncEnabled: boolean;
}

export interface AccountDataConsentRequest {
  termsAccepted: true;
  privacyAccepted: true;
  termsVersion: string;
  privacyVersion: string;
}

export interface CloudWorkspaceState {
  presetLabel: string;
  layout: BaseBlueprint;
  sourceName: string | null;
  boxSource: BoxSource;
  layoutDirty: boolean;
  layoutSource: "local" | "skland";
  localLayoutBackup: BaseBlueprint | null;
  rotationProfile: RotationProfile;
  fiammettaEnabled: boolean;
  activeShift: number;
}

export interface CloudWorkspaceRevisionData {
  id: string;
  revision: number;
  createdAt: string;
  expiresAt: string;
}

export interface CloudWorkspaceData {
  exists: boolean;
  revision: number;
  state: CloudWorkspaceState | null;
  operbox: OperBoxEntry[] | null;
  result: PublicPlanData | null;
  updatedAt: string | null;
  syncedAt: string | null;
  revisions: CloudWorkspaceRevisionData[];
}

export type CloudWorkspacePutRequest =
  | {
      baseRevision?: number | null;
      state: CloudWorkspaceState;
      operbox: OperBoxEntry[] | null;
      result: PublicPlanData | null;
    }
  | { restoreRevisionId: string; baseRevision?: number | null };

export interface SavedPlanCalculationContext {
  presetLabel: string;
  layout: BaseBlueprint;
  rotationProfile: RotationProfile;
  fiammettaEnabled: boolean;
}

export interface SavedPlanData {
  id: string;
  diagnosticId: string;
  title: string;
  calculationContext: SavedPlanCalculationContext | null;
  boxMatchesWorkspace: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  result: PublicPlanData;
}

export interface SavedPlanListData {
  plans: SavedPlanData[];
}

export type AdminUserAction = "ban" | "unban" | "revokeSessions" | "grantAdmin" | "revokeAdmin" | "grantReviewer" | "revokeReviewer";

export interface AdminUserData {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  banned: boolean | null;
  banReason: string | null;
  createdAt: string;
  isAdmin: boolean;
  isReviewer: boolean;
  isBootstrapAdmin: boolean;
  sklandBindingCount: number;
  sklandActiveBindingCount: number;
  sklandRenewalDueCount: number;
  paidPoints: number;
  monthlyPoints: number;
  monthlyExpiresAt: string | null;
  totalPoints: number;
}

export interface AdminUsersData {
  users: AdminUserData[];
  summary: { verifiedUsers: number };
  permissions: {
    canManageAdminRoles: boolean;
  };
}

export interface AdminSessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AdminSessionsData {
  sessions: AdminSessionData[];
}

export interface SkillAnnotationData {
  id: string;
  operatorId: string;
  skillId: string;
  note: string;
  updatedAt: string;
}

export interface SkillAnnotationListData {
  annotations: SkillAnnotationData[];
}

export interface AdminSkillAnnotationData extends SkillAnnotationData {
  createdAt: string;
}

export interface AdminSkillAnnotationListData {
  annotations: AdminSkillAnnotationData[];
}

export interface AdminSkillAnnotationMutationData {
  annotation: AdminSkillAnnotationData;
}

export interface AdminSkillAnnotationDeleteData {
  deleted: true;
}

export interface AdminUserUpdateData {
  updated: true;
}

export type AdminFeedbackStatus = "unreviewed" | "reviewed" | "ignored" | "reproduced" | "fixed";

export type AdminFeedbackFacility =
  | "trading"
  | "manufacture"
  | "power"
  | "control"
  | "dormitory"
  | "meeting"
  | "hire"
  | "processing"
  | "training"
  | "solver"
  | "unknown";

export interface AdminFeedbackRecordData {
  id: string;
  diagnosticId: string;
  kind: FeedbackKind;
  facility: AdminFeedbackFacility;
  room: FeedbackRoom | null;
  note: string;
  status: AdminFeedbackStatus;
  adminNote: string | null;
  hasLinkedRun: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface AdminPlanRunRecordData {
  diagnosticId: string;
  sourceType: "sample" | "maa" | "skland";
  status: "success" | "failed";
  layoutTemplate: string;
  roomCount: number;
  operatorCount: number;
  rotation: string;
  fiammettaEnable: boolean;
  durationMs: number | null;
  errorCode: AppErrorCode | null;
  solverExecutableSha256: string | null;
  protocolVersion: number | null;
  planSchemaVersion: number | null;
  hasReproduction: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface AdminRecordListData<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type AdminFeedbackListData = AdminRecordListData<AdminFeedbackRecordData>;
export type AdminPlanRunListData = AdminRecordListData<AdminPlanRunRecordData>;

export type AdminReproductionUnavailableReason =
  | "expired"
  | "cache_hit"
  | "finalizing"
  | "finalization_failed"
  | "not_recorded"
  | "missing"
  | "invalid"
  | "incomplete";

interface AdminReproductionDataBase {
  diagnosticId: string;
  sourceName: string | null;
  error: string | null;
  stderrExcerpt: string | null;
  stdoutExcerpt: string | null;
}

export type AdminReproductionData = AdminReproductionDataBase & ({
  available: true;
  unavailableReason: null;
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  rotation: RotationProfile;
  rotationCount: number;
  fiammettaEnabled: boolean;
} | {
  available: false;
  unavailableReason: AdminReproductionUnavailableReason;
  layout: BaseBlueprint | null;
  operbox: OperBoxEntry[] | null;
  rotation: RotationProfile | null;
  rotationCount: number | null;
  fiammettaEnabled: boolean | null;
});

export interface AdminFeedbackDetailData {
  feedback: AdminFeedbackRecordData;
  reproduction: AdminReproductionData;
  history: { id: string; actorUserId: string | null; status: AdminFeedbackStatus; note: string | null; createdAt: string }[];
  solverExecutableSha256: string | null;
}

export interface AdminPlanRunDetailData {
  run: AdminPlanRunRecordData;
  reproduction: AdminReproductionData;
}

export interface AdminFeedbackDeleteData {
  deletedIds: string[];
  deletedCount: number;
  privateArtifactsDeleted: number;
}


export interface AdminSolverMetricsData {
  generatedAt: string;
  solver: {
    windowMinutes: number;
    trendWindowMinutes: number;
    trendBucketMinutes: number;
    successCount: number;
    failureCount: number;
    completedCount: number;
    errorRate: number | null;
    throughputPerMinute: number;
    averageDurationMs: number | null;
    p95DurationMs: number | null;
    averageSolverDurationMs: number | null;
    p95SolverDurationMs: number | null;
    averageWorkerDurationMs: number | null;
    sourceCounts: {
      maa: number;
      skland: number;
      sample: number;
    };
    trend: Array<{
      bucketStartedAt: string;
      successCount: number;
      failureCount: number;
      completedCount: number;
      errorRate: number | null;
      averageDurationMs: number | null;
    }>;
  };
  queue: {
    bufferedCount: number;
    pendingCount: number;
    runningCount: number;
    averageWaitMs: number | null;
    p95WaitMs: number | null;
  };
  cache: {
    enabled: boolean;
    hitCount: number;
    missCount: number;
    lookupCount: number;
    hitRate: number | null;
    readyEntryCount: number;
    fillingEntryCount: number;
  };
}

export interface SklandSessionData {
  authenticated: boolean;
  configured: boolean;
  authMethods?: SklandAuthMethods;
  disabledReason?: string | null;
  accounts: SklandAccountSummary[];
  activeAccountId: string | null;
  bindingCount: number;
  bindingSummary?: SklandBindingSummary;
  scheduleSnapshot?: SklandScheduleSnapshot;
  statusSnapshot?: SklandStatusSnapshot;
}

export interface SklandStatusData {
  accounts: SklandAccountSummary[];
  activeAccountId: string | null;
  snapshot?: SklandStatusSnapshot;
}

export interface SklandInventoryItem {
  id: string;
  count: number;
}

export interface SklandInventoryData {
  identityKey: string;
  items: SklandInventoryItem[];
  fetchedAt: string;
}

export interface SklandQrStartData {
  scanId: string;
  scanUrl: string;
  expiresInSeconds: number;
}

export interface SklandQrStatusData {
  status: "waiting" | "scanned" | "expired" | "authenticated";
  accounts?: SklandAccountSummary[];
  activeAccountId?: string | null;
  bindingCount?: number;
  bindingSummary?: SklandBindingSummary;
  scheduleSnapshot?: SklandScheduleSnapshot;
  statusSnapshot?: SklandStatusSnapshot;
}

export interface DisplayError {
  code: AppErrorCode;
  message: string;
  requestId?: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  fieldErrors?: ApiFieldError[];
}
