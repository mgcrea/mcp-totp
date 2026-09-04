/**
 * Everything a server logs goes to stderr — stdout is the MCP protocol channel.
 * Kept as an injected type rather than a module singleton so `createServer` stays
 * a pure factory and tests can capture output.
 */
export type Logger = {
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export const silentLogger: Logger = {
  debug: () => {},
  warn: () => {},
  error: () => {},
};
