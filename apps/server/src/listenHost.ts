export function resolveServerListenHost(host: string | undefined): string {
  const normalizedHost = host?.trim();
  if (normalizedHost) {
    return normalizedHost;
  }

  // Node and Bun treat an omitted hostname as "all interfaces". The standalone
  // web server's first-owner bootstrap flow is only safe when the default bind
  // stays local, so remote reachability must require an explicit host override.
  return "127.0.0.1";
}
