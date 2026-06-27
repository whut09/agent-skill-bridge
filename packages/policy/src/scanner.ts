import type { ScannerFinding } from "./types.js";

const patterns: Array<Omit<ScannerFinding, "match"> & { pattern: RegExp }> = [
  {
    severity: "high",
    category: "prompt_injection",
    message: "Instruction attempts to override higher-priority prompts.",
    pattern: /\b(ignore|bypass|override)\b.{0,60}\b(previous|system|developer)\b.{0,30}\b(instruction|prompt|message)s?\b/i,
  },
  {
    severity: "high",
    category: "prompt_injection",
    message: "Instruction asks the model to reveal secrets or hidden prompts.",
    pattern: /\b(reveal|print|exfiltrate|leak)\b.{0,60}\b(secret|api[_ -]?key|system prompt|hidden prompt)\b/i,
  },
  {
    severity: "high",
    category: "dangerous_command",
    message: "Text includes a destructive shell command.",
    pattern: /\b(rm\s+-rf|del\s+\/[sq]|format\s+[a-z]:|chmod\s+777|sudo\s+rm)\b/i,
  },
  {
    severity: "medium",
    category: "external_download",
    message: "Text includes a remote download followed by execution.",
    pattern: /\b(curl|wget|iwr|invoke-webrequest)\b.{0,120}\b(sh|bash|node|python|powershell|iex)\b/i,
  },
  {
    severity: "medium",
    category: "metadata_risk",
    message: "Metadata appears to contain operational instructions.",
    pattern: /\bmetadata\b.{0,80}\b(always|must|ignore|execute|download)\b/i,
  },
];

export function scanSkillText(text: string): ScannerFinding[] {
  return patterns.flatMap((entry) => {
    const match = text.match(entry.pattern);
    if (!match) {
      return [];
    }

    return [{ severity: entry.severity, category: entry.category, message: entry.message, match: match[0] }];
  });
}
