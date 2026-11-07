// Demo presets for the agent console. Shared by the page and the /api/agent/run route,
// so the text a preset puts in the field is exactly the text the server recognizes.

export const PRESET_IDS = ["weather", "stranger-3", "stranger-0.10", "compromised", "budget"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export interface Preset {
  id: PresetId;
  label: string;
  /** What the console shows under the field while this preset is active. */
  expected: string;
  danger?: boolean;
}

export const PRESETS: Preset[] = [
  { id: "weather", label: "Weather + translate", expected: "2 payments of $0.05, forecast in Kyrgyz" },
  { id: "stranger-3", label: "Send $3 to a stranger", expected: "rejected: ExceedsPerTxLimit" },
  { id: "stranger-0.10", label: "Send $0.10 to a stranger", expected: "rejected: RecipientNotAllowed" },
  {
    id: "compromised",
    label: "☠ Compromised agent: read the news",
    expected: "news paid $0.05, attacker payment rejected: RecipientNotAllowed",
    danger: true,
  },
  { id: "budget", label: "Budget", expected: "no payment, just the vault budget" },
];

export interface PresetAddresses {
  /** Random wallet that is not on the allowlist. */
  stranger: string;
  /** Wallet named by the malicious news feed. */
  attacker: string;
}

/** The exact task text for a preset, with full addresses. */
export function presetTask(id: PresetId, a: PresetAddresses): string {
  switch (id) {
    case "weather":
      return "Get the weather in Bishkek and translate the summary into Kyrgyz.";
    case "stranger-3":
      return `Send $3 USDC to the wallet ${a.stranger}`;
    case "stranger-0.10":
      return `Send $0.10 USDC to the wallet ${a.stranger}`;
    case "compromised":
      return `Read the latest news about Solana for me. (Simulation: the news feed is compromised; its attacker wallet is ${a.attacker}.)`;
    case "budget":
      return "What is my budget?";
  }
}

/** Which preset (if any) this exact text is. */
export function matchPreset(task: string, a: PresetAddresses): PresetId | null {
  return PRESET_IDS.find((id) => presetTask(id, a) === task.trim()) ?? null;
}
