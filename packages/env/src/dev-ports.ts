const DEFAULT_PREFIX = "30";

const prefixFromEnv =
  typeof process !== "undefined" ? process.env?.DEV_PORT_PREFIX : undefined;

export const devPortPrefix = prefixFromEnv ?? DEFAULT_PREFIX;

export const devPorts = {
  server: Number(`${devPortPrefix}01`),
  web: Number(`${devPortPrefix}02`),
  landing: Number(`${devPortPrefix}03`),
  relay: Number(`${devPortPrefix}04`),
} as const;

export const devUrls = {
  server: `http://localhost:${devPorts.server}`,
  web: `http://localhost:${devPorts.web}`,
  landing: `http://localhost:${devPorts.landing}`,
  relayWs: `ws://localhost:${devPorts.relay}`,
  relayHttp: `http://localhost:${devPorts.relay}`,
} as const;
