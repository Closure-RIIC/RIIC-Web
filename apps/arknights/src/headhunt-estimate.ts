export const HEADHUNTING_STEPS = [
  { tier: 1, content: "寻访凭证 x1", cost: 10, pulls: 1, average: 10 },
  { tier: 2, content: "寻访凭证 x2", cost: 28, pulls: 3, average: 9.33 },
  { tier: 3, content: "寻访凭证 x5", cost: 68, pulls: 8, average: 8.5 },
  { tier: 4, content: "十连寻访凭证 x1", cost: 138, pulls: 18, average: 7.67 },
  { tier: 5, content: "十连寻访凭证 x2", cost: 258, pulls: 38, average: 6.79 },
] as const;

export interface HeadhuntEstimateInput {
  originium: number;
  orundum: number;
  singleTickets: number;
  tenPullTickets: number;
  yellowCertificates: number;
}

export interface HeadhuntEstimate {
  totalPulls: number;
  currencyPulls: number;
  ticketPulls: number;
  exchangePulls: number;
  remainingOrundum: number;
  remainingYellowCertificates: number;
}

/** 当月黄票商店只按能买到的最高一档折算，剩余黄票不再拆低档。 */
export function yellowCertificateExchange(yellowCertificates: number): { pulls: number; remaining: number } {
  let selected: (typeof HEADHUNTING_STEPS)[number] | null = null;
  for (const step of HEADHUNTING_STEPS) {
    if (yellowCertificates >= step.cost) selected = step;
  }
  return { pulls: selected?.pulls ?? 0, remaining: yellowCertificates - (selected?.cost ?? 0) };
}

/** 常规寻访可用抽数：源石按 180 合成玉、每抽 600 玉折算，加凭证与黄票兑换；不含中坚寻访。 */
export function estimateHeadhuntPulls(input: HeadhuntEstimateInput): HeadhuntEstimate {
  const convertedOrundum = input.orundum + input.originium * 180;
  const currencyPulls = Math.floor(convertedOrundum / 600);
  const ticketPulls = input.singleTickets + input.tenPullTickets * 10;
  const exchange = yellowCertificateExchange(input.yellowCertificates);
  return {
    totalPulls: currencyPulls + ticketPulls + exchange.pulls,
    currencyPulls,
    ticketPulls,
    exchangePulls: exchange.pulls,
    remainingOrundum: convertedOrundum % 600,
    remainingYellowCertificates: exchange.remaining,
  };
}
