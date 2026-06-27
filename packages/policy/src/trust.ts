import type { PolicyDecision, TrustLevel } from "./types.js";

const trustRank: Record<TrustLevel, number> = {
  trusted: 3,
  local: 2,
  community: 1,
  untrusted: 0,
};

export function normalizeTrustLevel(value: unknown): TrustLevel {
  if (value === "trusted" || value === "local" || value === "community" || value === "untrusted") {
    return value;
  }

  return "local";
}

export function checkTrustLevel(actual: TrustLevel | undefined, minimum: TrustLevel): PolicyDecision {
  const normalizedActual = actual ?? "local";
  if (trustRank[normalizedActual] >= trustRank[minimum]) {
    return {
      allowed: true,
      code: "trust.allowed",
      reason: `Trust level ${normalizedActual} meets minimum ${minimum}.`,
    };
  }

  return {
    allowed: false,
    code: "trust.too_low",
    reason: `Trust level ${normalizedActual} is below required ${minimum}.`,
  };
}
