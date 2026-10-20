import assert from "node:assert/strict";
import test from "node:test";
import { estimateHeadhuntPulls, yellowCertificateExchange } from "./headhunt-estimate.ts";

test("yellow certificate exchange picks the highest affordable tier only", () => {
  assert.deepEqual(yellowCertificateExchange(0), { pulls: 0, remaining: 0 });
  assert.deepEqual(yellowCertificateExchange(27), { pulls: 1, remaining: 17 });
  assert.deepEqual(yellowCertificateExchange(137), { pulls: 8, remaining: 69 });
  assert.deepEqual(yellowCertificateExchange(258), { pulls: 38, remaining: 0 });
  assert.deepEqual(yellowCertificateExchange(400), { pulls: 38, remaining: 142 });
});

test("pull estimate sums currency, tickets and exchange with remainders kept", () => {
  assert.deepEqual(estimateHeadhuntPulls({
    originium: 1, orundum: 1_100, singleTickets: 2, tenPullTickets: 1, yellowCertificates: 258,
  }), {
    totalPulls: 52, currencyPulls: 2, ticketPulls: 12,
    exchangePulls: 38, remainingOrundum: 80, remainingYellowCertificates: 0,
  });
  assert.deepEqual(estimateHeadhuntPulls({
    originium: 0, orundum: 599, singleTickets: 0, tenPullTickets: 0, yellowCertificates: 0,
  }), {
    totalPulls: 0, currencyPulls: 0, ticketPulls: 0,
    exchangePulls: 0, remainingOrundum: 599, remainingYellowCertificates: 0,
  });
});
