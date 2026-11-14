import { sessionBus, type MessageBus } from "dbus-next";

type LeasedBus = Pick<MessageBus, "on" | "removeListener" | "call" | "disconnect">;

/**
 * Watchers that each opened a session bus connection share one instead. Each gets a lease on the
 * bus, and the last release closes the connection.
 */
export function createSessionBusLeases(connect: () => MessageBus) {
  let bus: MessageBus | null = null;
  let leases = 0;
  return (): MessageBus => {
    const shared = (bus ??= connect());
    leases += 1;
    let released = false;
    const lease: LeasedBus = {
      on: shared.on.bind(shared),
      removeListener: shared.removeListener.bind(shared),
      call: shared.call.bind(shared),
      disconnect: () => {
        if (released) return;
        released = true;
        leases -= 1;
        if (leases === 0) {
          bus = null;
          shared.disconnect();
        }
      },
    };
    // Watchers take the whole bus type but use these four members.
    return lease as MessageBus;
  };
}

/** The app's one session bus connection, for every portal watcher. */
export const leaseSessionBus = createSessionBusLeases(sessionBus);
