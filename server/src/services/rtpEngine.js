import { fixedWinMultiplier } from "../config.js";

export const chooseWinningNumber = ({
  bets,
  rtpConfig,
  historyTotals,
  roundTotal,
  excludedNumbers = [],
}) => {
  const multiplier = fixedWinMultiplier;
  const targetRatio = (rtpConfig.targetRtpPercent || 90) / 100;
  const betBuckets = new Array(10).fill(0);
  const excluded = new Set(
    Array.isArray(excludedNumbers)
      ? excludedNumbers.filter((n) => Number.isInteger(n) && n >= 0 && n <= 9)
      : []
  );

  bets.forEach((bet) => {
    bet.bets.forEach((entry) => {
      betBuckets[entry.number] += entry.amount;
    });
  });

  if (roundTotal <= 0) {
    const candidates = [];
    for (let number = 0; number < 10; number++) {
      if (!excluded.has(number)) candidates.push(number);
    }
    if (!candidates.length) {
      return null;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const { totalBet: historicBet, totalWin: historicWin } = historyTotals || {
    totalBet: 0,
    totalWin: 0,
  };

  let bestNumber = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let foundCandidate = false;

  for (let number = 0; number < 10; number++) {
    if (excluded.has(number)) continue;
    foundCandidate = true;
    const potentialWin = betBuckets[number] * multiplier;
    const projectedRtp =
      (historicWin + potentialWin) / Math.max(historicBet + roundTotal, 1);

    const delta = Math.abs(projectedRtp - targetRatio);
    const overPenalty = projectedRtp > targetRatio ? projectedRtp - targetRatio : 0;
    const randomness = Math.random() * 0.001;
    const score = delta + overPenalty * 0.5 + randomness;

    if (score < bestScore) {
      bestScore = score;
      bestNumber = number;
    }
  }

  if (!foundCandidate) {
    return null;
  }

  return bestNumber;
};
