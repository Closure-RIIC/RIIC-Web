export type ReferralRules = {
  rewardPoints: number;
  inviteePoints: number;
  rewardLimit: number;
};

export const defaultReferralRules: ReferralRules = { rewardPoints: 10, inviteePoints: 10, rewardLimit: 5 };
export const referralRuleMaximums: ReferralRules = { rewardPoints: 10_000, inviteePoints: 10_000, rewardLimit: 1_000 };
