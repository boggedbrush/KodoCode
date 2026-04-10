import { Effect, Queue, Scope } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import {
  RpcMessage,
  RpcSerialization,
  RpcServer,
  type Rpc,
  type RpcGroup,
} from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

interface RpcWebSocketConnectionOptions {
  readonly headers?: ReadonlyArray<[string, string]>;
  readonly onClientConnected?: (clientId: number) => Effect.Effect<void, never>;
  readonly onClientDisconnected?: (clientId: number) => Effect.Effect<void, never>;
}

interface RpcWebSocketClient {
  readonly close: (event: Socket.CloseEvent) => Effect.Effect<void, Socket.SocketError>;
  readonly write: (response: RpcMessage.FromServerEncoded) => Effect.Effect<void>;
}

export interface RpcWebSocketServer {
  readonly closeClient: (clientId: number, event?: Socket.CloseEvent) => Effect.Effect<void, never>;
  readonly handleRequest: (
    options?: RpcWebSocketConnectionOptions,
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    HttpServerRequest.HttpServerRequest
  >;
}

export const makeRpcWebSocketServer = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options?: {
    readonly disableTracing?: boolean;
    readonly spanPrefix?: string;
    readonly spanAttributes?: Record<string, unknown>;
    readonly disableFatalDefects?: boolean;
  },
): Effect.Effect<
  RpcWebSocketServer,
  never,
  | Scope.Scope
  | Rpc.ToHandler<Rpcs>
  | Rpc.Middleware<Rpcs>
  | Rpc.ServicesServer<Rpcs>
  | RpcSerialization.RpcSerialization
> =>
  Effect.gen(function* () {
    const serialization = yield* RpcSerialization.RpcSerialization;
    const disconnects = yield* Queue.make<number>();

    let nextClientId = 0;
    const clientIds = new Set<number>();
    const clients = new Map<number, RpcWebSocketClient>();

    let writeRequest!: (
      clientId: number,
      message: RpcMessage.FromClientEncoded,
    ) => Effect.Effect<void>;

    const closeClient = (clientId: number, event = new Socket.CloseEvent()) => {
      const client = clients.get(clientId);
      if (!client) {
        return Effect.void;
      }
      return client.close(event).pipe(
        Effect.catchIf(
          (error): error is Socket.SocketError => error.reason._tag === "SocketCloseError",
          () => Effect.void,
          (error) => Effect.die(error),
        ),
      );
    };

    const handleSocketConnection = (
      socket: Socket.Socket,
      connectionOptions?: RpcWebSocketConnectionOptions,
    ): Effect.Effect<void, never> =>
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Effect.scope;
          const parser = serialization.makeUnsafe();
          const clientId = nextClientId++;
          const writeRaw = yield* socket.writer;
          const onClientConnected = connectionOptions?.onClientConnected;
          const onClientDisconnected = connectionOptions?.onClientDisconnected;

          yield* Scope.addFinalizerExit(scope, () =>
            Effect.gen(function* () {
              clients.delete(clientId);
              clientIds.delete(clientId);
              yield* Queue.offer(disconnects, clientId);
              yield* onClientDisconnected ? onClientDisconnected(clientId) : Effect.void;
            }),
          );

          const client: RpcWebSocketClient = {
            close: (event) => writeRaw(event),
            write: (response) => {
              try {
                const encoded = parser.encode(response);
                if (encoded === undefined) {
                  return Effect.void;
                }
                return Effect.orDie(writeRaw(encoded));
              } catch (cause) {
                return Effect.orDie(
                  writeRaw(parser.encode(RpcMessage.ResponseDefectEncoded(cause))!),
                );
              }
            },
          };

          clients.set(clientId, client);
          clientIds.add(clientId);

          yield* onClientConnected ? onClientConnected(clientId) : Effect.void;

          return yield* socket
            .runRaw((data) => {
              try {
                const decoded = parser.decode(data) as ReadonlyArray<RpcMessage.FromClientEncoded>;
                if (decoded.length === 0) {
                  return Effect.void;
                }
                let index = 0;
                return Effect.whileLoop({
                  while: () => index < decoded.length,
                  body() {
                    const message = decoded[index];
                    index += 1;
                    if (!message) {
                      return Effect.void;
                    }
                    const forwardedMessage: RpcMessage.FromClientEncoded =
                      message._tag === "Request" && connectionOptions?.headers
                        ? {
                            ...message,
                            headers: connectionOptions.headers.concat(message.headers),
                          }
                        : message;
                    return writeRequest(clientId, forwardedMessage);
                  },
                  step: () => undefined,
                });
              } catch (cause) {
                return writeRaw(parser.encode(RpcMessage.ResponseDefectEncoded(cause))!);
              }
            })
            .pipe(
              Effect.catchIf(
                (error): error is Socket.SocketError => error.reason._tag === "SocketCloseError",
                () => Effect.void,
                (error) => Effect.die(error),
              ),
            );
        }),
      );

    const protocol = yield* RpcServer.Protocol.make((writeRequest_) => {
      writeRequest = writeRequest_;
      return Effect.succeed({
        disconnects,
        send: (clientId, response) => {
          const client = clients.get(clientId);
          if (!client) {
            return Effect.void;
          }
          return Effect.orDie(client.write(response));
        },
        end(_clientId) {
          return Effect.void;
        },
        clientIds: Effect.sync(() => clientIds),
        initialMessage: Effect.succeedNone,
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
      });
    });

    yield* RpcServer.make(group, options).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.forkScoped,
    );

    return {
      closeClient,
      handleRequest: (connectionOptions) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const socket = yield* Effect.orDie(request.upgrade);
          yield* handleSocketConnection(socket, {
            ...connectionOptions,
            headers: Object.entries(request.headers),
          });
          return HttpServerResponse.empty();
        }),
    } satisfies RpcWebSocketServer;
  });
