import type { FoundAgent } from "../app/api.ts";
import type { AgentConversation } from "../store/types.ts";

export const MAX_DISTRIBUTION_LEVEL = 4;

export type AgentProbe = "usable" | "ineligible" | "unavailable";

export function classifyDistributionAgentConversation(conversation: AgentConversation): AgentProbe {
  if (/standings are not high enough|too low standings/i.test(conversation.agentSays)) {
    return "ineligible";
  }
  return conversation.actions.length > 0 ? "usable" : "unavailable";
}

export interface DistributionAgentPolicy {
  readonly preferredLevel: number;
  readonly fallback: boolean;
  readonly corporationID: number | null;
  readonly maxJumps: number | null;
  readonly originSystemID: number | null;
  readonly distances: ReadonlyMap<number, number> | null;
}

export interface DistributionAgentSelection {
  readonly agent: FoundAgent | null;
  readonly level: number | null;
  readonly reason: string;
}

/** Static metadata narrows candidates; the probe is EveJS's authoritative access verdict. */
export async function selectDistributionAgent(
  policy: DistributionAgentPolicy,
  find: (level: number) => Promise<readonly FoundAgent[]>,
  probe: (agentID: number) => Promise<AgentProbe>,
): Promise<DistributionAgentSelection> {
  const preferred = policy.preferredLevel;
  if (!Number.isSafeInteger(preferred) || preferred < 1 || preferred > MAX_DISTRIBUTION_LEVEL) {
    return { agent: null, level: null, reason: "Choose a distribution mission level from 1 to 4." };
  }
  const lowest = policy.fallback ? 1 : preferred;
  for (let level = preferred; level >= lowest; level--) {
    const candidates = (await find(level))
      .filter((agent) =>
        agent.level === level &&
        agent.divisionID === 22 && agent.agentTypeID === 2 &&
        agent.stationID !== null && agent.solarSystemID !== null &&
        (policy.corporationID === null || agent.corporationID === policy.corporationID),
      )
      .map((agent) => ({
        agent,
        jumps: agent.solarSystemID === policy.originSystemID
          ? 0
          : (policy.distances?.get(agent.solarSystemID!) ?? Number.POSITIVE_INFINITY),
      }))
      .filter(({ jumps }) => policy.maxJumps === null || jumps <= policy.maxJumps)
      .sort((a, b) => a.jumps - b.jumps);
    for (const { agent } of candidates) {
      if (await probe(agent.agentID) === "usable") {
        return {
          agent,
          level,
          reason: level === preferred
            ? `Found an eligible level ${level} distribution agent.`
            : `Level ${preferred} unavailable; using an eligible level ${level} distribution agent.`,
        };
      }
    }
  }
  return {
    agent: null,
    level: null,
    reason: policy.fallback && preferred > 1
      ? `No eligible distribution agent is available at level ${preferred} or below.`
      : `No eligible level ${preferred} distribution agent is available.`,
  };
}
