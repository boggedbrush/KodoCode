import type { MessageBus } from "dbus-next";
import { expect, it, vi } from "vite-plus/test";

import { createSessionBusLeases } from "./SessionBusLease.ts";

function fakeBus() {
  return { on: vi.fn(), removeListener: vi.fn(), call: vi.fn(), disconnect: vi.fn() };
}

it("shares one connection and closes it with the last lease", () => {
  const bus = fakeBus();
  const connect = vi.fn(() => bus as unknown as MessageBus);
  const lease = createSessionBusLeases(connect);

  const first = lease();
  const second = lease();
  expect(connect).toHaveBeenCalledTimes(1);

  first.disconnect();
  first.disconnect();
  expect(bus.disconnect).not.toHaveBeenCalled();
  second.disconnect();
  expect(bus.disconnect).toHaveBeenCalledOnce();

  // A lease after everyone left opens a fresh connection.
  lease();
  expect(connect).toHaveBeenCalledTimes(2);
});
