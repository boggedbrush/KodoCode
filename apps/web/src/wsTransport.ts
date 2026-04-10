import { type AuthWebSocketTokenResult } from "@t3tools/contracts";
import {
  Cause,
  Duration,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Option,
  Scope,
  Stream,
} from "effect";
import { RpcClient } from "effect/unstable/rpc";

import { resolveAuthHttpOrigin, resolveServerUrl, toHttpOrigin } from "./lib/utils";
import { ClientTracingLive, configureClientTracing } from "./observability/clientTracing";
import {
  createWsRpcProtocolLayer,
  makeWsRpcProtocolClient,
  type WsRpcProtocolClient,
} from "./rpc/protocol";
import { isTransportConnectionErrorMessage } from "./rpc/transportError";

interface SubscribeOptions {
  readonly retryDelay?: Duration.Input;
  readonly onResubscribe?: () => void;
}

interface RequestOptions {
  readonly timeout?: Option.Option<Duration.Input>;
}

const DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS = Duration.millis(250);
const NOOP: () => void = () => undefined;

interface TransportSession {
  readonly initializedPromise: Promise<ResolvedTransportSession>;
}

interface ResolvedTransportSession {
  readonly clientPromise: Promise<WsRpcProtocolClient>;
  readonly clientScope: Scope.Closeable;
  readonly runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>;
}

const LEGACY_TOKEN_QUERY_PARAM = "token";
const WEBSOCKET_TOKEN_QUERY_PARAM = "wsToken";

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

function shouldBootstrapWebSocketToken(socketUrl: string): boolean {
  const parsedUrl = new URL(socketUrl);
  if (
    parsedUrl.searchParams.has(LEGACY_TOKEN_QUERY_PARAM) ||
    parsedUrl.searchParams.has(WEBSOCKET_TOKEN_QUERY_PARAM)
  ) {
    return false;
  }

  const authOrigin = resolveAuthHttpOrigin();
  return authOrigin.length > 0 && authOrigin !== toHttpOrigin(socketUrl);
}

async function issueWebSocketToken(): Promise<string | null> {
  const authOrigin = resolveAuthHttpOrigin();
  if (authOrigin.length === 0) {
    return null;
  }

  try {
    const response = await fetch(`${authOrigin}/api/auth/ws-token`, {
      credentials: "include",
      method: "POST",
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as Partial<AuthWebSocketTokenResult>;
    return typeof payload.token === "string" && payload.token.trim().length > 0
      ? payload.token
      : null;
  } catch {
    return null;
  }
}

async function resolveTransportUrl(url?: string): Promise<string> {
  const resolvedUrl = resolveServerUrl({
    url,
    protocol: window.location.protocol === "https:" ? "wss" : "ws",
    pathname: "/ws",
  });

  if (!shouldBootstrapWebSocketToken(resolvedUrl)) {
    return resolvedUrl;
  }

  // When the page is fronted by a dev proxy, the authenticated browser cookie
  // lives on the page origin while the websocket still connects to the backend
  // origin. Mint a short-lived ws token through the page origin and carry it on
  // the direct websocket URL so claimed sessions can reconnect successfully.
  const token = await issueWebSocketToken();
  if (token === null) {
    return resolvedUrl;
  }

  const parsedUrl = new URL(resolvedUrl);
  parsedUrl.searchParams.set(WEBSOCKET_TOKEN_QUERY_PARAM, token);
  return parsedUrl.toString();
}

export class WsTransport {
  private readonly tracingReady: Promise<void>;
  private readonly url: string | undefined;
  private disposed = false;
  private hasReportedTransportDisconnect = false;
  private reconnectChain: Promise<void> = Promise.resolve();
  private session: TransportSession;

  constructor(url?: string) {
    this.url = url;
    this.tracingReady = configureClientTracing();
    this.session = this.createSession();
  }

  async request<TSuccess>(
    execute: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, Error, never>,
    _options?: RequestOptions,
  ): Promise<TSuccess> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    await this.tracingReady;
    const session = await this.session.initializedPromise;
    const client = await session.clientPromise;
    return await session.runtime.runPromise(Effect.suspend(() => execute(client)));
  }

  async requestStream<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
  ): Promise<void> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    await this.tracingReady;
    const session = await this.session.initializedPromise;
    const client = await session.clientPromise;
    await session.runtime.runPromise(
      Stream.runForEach(connect(client), (value) =>
        Effect.sync(() => {
          try {
            listener(value);
          } catch {
            // Swallow listener errors so the stream can finish cleanly.
          }
        }),
      ),
    );
  }

  subscribe<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    options?: SubscribeOptions,
  ): () => void {
    if (this.disposed) {
      return () => undefined;
    }

    let active = true;
    let hasReceivedValue = false;
    const retryDelayMs = Duration.toMillis(
      Duration.fromInputUnsafe(options?.retryDelay ?? DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS),
    );
    let cancelCurrentStream: () => void = NOOP;

    void (async () => {
      for (;;) {
        if (!active || this.disposed) {
          return;
        }

        try {
          if (hasReceivedValue) {
            try {
              options?.onResubscribe?.();
            } catch {
              // Swallow reconnect hook errors so the stream can recover.
            }
          }

          const session = await this.session.initializedPromise;
          const runningStream = this.runStreamOnSession(
            session,
            connect,
            listener,
            () => active,
            () => {
              this.hasReportedTransportDisconnect = false;
              hasReceivedValue = true;
            },
          );
          cancelCurrentStream = runningStream.cancel;
          await runningStream.completed;
          cancelCurrentStream = NOOP;
        } catch (error) {
          cancelCurrentStream = NOOP;
          if (!active || this.disposed) {
            return;
          }

          const formattedError = formatErrorMessage(error);
          if (!isTransportConnectionErrorMessage(formattedError)) {
            console.warn("WebSocket RPC subscription failed", {
              error: formattedError,
            });
            return;
          }

          if (!this.hasReportedTransportDisconnect) {
            console.warn("WebSocket RPC subscription disconnected", {
              error: formattedError,
            });
          }
          this.hasReportedTransportDisconnect = true;
          await sleep(retryDelayMs);
        }
      }
    })();

    return () => {
      active = false;
      cancelCurrentStream();
    };
  }

  async reconnect() {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const reconnectOperation = this.reconnectChain.then(async () => {
      if (this.disposed) {
        throw new Error("Transport disposed");
      }

      const previousSession = this.session;
      this.session = this.createSession();
      await this.closeSession(previousSession);
    });

    this.reconnectChain = reconnectOperation.catch(() => undefined);
    await reconnectOperation;
  }

  async dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await this.closeSession(this.session);
  }

  private closeSession(session: TransportSession) {
    return session.initializedPromise
      .catch(() => null)
      .then((initialized) => {
        if (initialized === null) {
          return undefined;
        }

        return initialized.runtime
          .runPromise(Scope.close(initialized.clientScope, Exit.void))
          .finally(() => {
            initialized.runtime.dispose();
          });
      });
  }

  private createSession(): TransportSession {
    return {
      initializedPromise: resolveTransportUrl(this.url).then((resolvedUrl) => {
        const runtime = ManagedRuntime.make(
          Layer.mergeAll(createWsRpcProtocolLayer(resolvedUrl), ClientTracingLive),
        );
        const clientScope = runtime.runSync(Scope.make());
        return {
          runtime,
          clientScope,
          clientPromise: runtime.runPromise(Scope.provide(clientScope)(makeWsRpcProtocolClient)),
        };
      }),
    };
  }

  private runStreamOnSession<TValue>(
    session: ResolvedTransportSession,
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    isActive: () => boolean,
    markValueReceived: () => void,
  ): {
    readonly cancel: () => void;
    readonly completed: Promise<void>;
  } {
    let resolveCompleted!: () => void;
    let rejectCompleted!: (error: unknown) => void;
    const completed = new Promise<void>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    const cancel = session.runtime.runCallback(
      Effect.promise(() => this.tracingReady).pipe(
        Effect.flatMap(() => Effect.promise(() => session.clientPromise)),
        Effect.flatMap((client) =>
          Stream.runForEach(connect(client), (value) =>
            Effect.sync(() => {
              if (!isActive()) {
                return;
              }

              markValueReceived();
              try {
                listener(value);
              } catch {
                // Swallow listener errors so the stream stays live.
              }
            }),
          ),
        ),
      ),
      {
        onExit: (exit) => {
          if (Exit.isSuccess(exit)) {
            resolveCompleted();
            return;
          }

          rejectCompleted(Cause.squash(exit.cause));
        },
      },
    );

    return {
      cancel,
      completed,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
