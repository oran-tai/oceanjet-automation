export interface RpaAgentConfig {
  /** Label used in logs and Slack alerts, e.g. "VM1". Defaults to host:port. */
  name: string;
  url: string;
}

const DEFAULT_AGENT_URL = 'http://localhost:8080';

/**
 * Parse the RPA agents the orchestrator dispatches bookings to.
 *
 * `RPA_AGENT_URLS` is a comma-separated list; each entry is `url` or
 * `name=url` (e.g. `VM2=http://localhost:8080,VM1=http://10.122.2.27:8080`).
 * Falls back to the single `RPA_AGENT_URL`, then to localhost:8080.
 */
export function parseAgentList(
  urlsRaw: string | undefined,
  singleUrlRaw: string | undefined
): RpaAgentConfig[] {
  const source = urlsRaw?.trim() || singleUrlRaw?.trim() || DEFAULT_AGENT_URL;

  const agents = source
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): RpaAgentConfig => {
      const eq = entry.indexOf('=');
      // "name=url" — the part before '=' is a name only if it is not itself a URL
      if (eq > 0 && !entry.slice(0, eq).includes('://')) {
        const name = entry.slice(0, eq).trim();
        const url = entry.slice(eq + 1).trim();
        return { name: name || hostLabel(url), url };
      }
      return { name: hostLabel(entry), url: entry };
    });

  for (const agent of agents) {
    try {
      new URL(agent.url);
    } catch {
      throw new Error(`Invalid RPA agent URL: "${agent.url}"`);
    }
  }
  const urls = new Set(agents.map((a) => a.url.replace(/\/+$/, '')));
  if (urls.size !== agents.length) {
    throw new Error('RPA_AGENT_URLS lists the same agent twice');
  }
  const names = new Set(agents.map((a) => a.name));
  if (names.size !== agents.length) {
    throw new Error('RPA_AGENT_URLS gives two agents the same name');
  }
  return agents;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
