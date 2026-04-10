import type { ServerAuthDescriptor } from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { AuthControlPlane, type AuthControlPlaneShape } from "../Services/AuthControlPlane.ts";
import { BootstrapCredentialService } from "../Services/BootstrapCredentialService.ts";
import { AuthError } from "../Services/ServerAuth.ts";
import {
  SessionCredentialService,
  type SessionCredentialServiceShape,
} from "../Services/SessionCredentialService.ts";
import { ServerAuthPolicy, type ServerAuthPolicyShape } from "../Services/ServerAuthPolicy.ts";
import { makeServerAuth } from "./ServerAuth.ts";

const baseDescriptor: ServerAuthDescriptor = {
  policy: "loopback-browser",
  bootstrapMethods: ["one-time-token"],
  sessionMethods: ["browser-session-cookie", "bearer-session-token"],
  sessionCookieName: "kodo_session_test",
};

const unexpectedMock = <A>(message: string): Effect.Effect<A> => Effect.die(new Error(message));

function makeServerAuthUnderTest(options?: {
  readonly authControlPlane?: Partial<AuthControlPlaneShape>;
  readonly sessionCredentialService?: Partial<SessionCredentialServiceShape>;
  readonly serverAuthPolicy?: Partial<ServerAuthPolicyShape>;
}) {
  const testLayer = Layer.mergeAll(
    Layer.mock(ServerAuthPolicy)({
      getDescriptor: () => Effect.succeed(baseDescriptor),
      ...options?.serverAuthPolicy,
    }),
    Layer.mock(BootstrapCredentialService)({
      issueOneTimeToken: () => unexpectedMock("issueOneTimeToken not mocked"),
      listActive: () => unexpectedMock("listActive not mocked"),
      streamChanges: Stream.empty,
      revoke: () => unexpectedMock("revoke not mocked"),
      consume: () => unexpectedMock("consume not mocked"),
    }),
    Layer.mock(AuthControlPlane)({
      createPairingLink: () => unexpectedMock("createPairingLink not mocked"),
      listPairingLinks: () => Effect.succeed([]),
      revokePairingLink: () => unexpectedMock("revokePairingLink not mocked"),
      issueSession: () => unexpectedMock("issueSession not mocked"),
      listSessions: () => Effect.succeed([]),
      revokeSession: () => unexpectedMock("revokeSession not mocked"),
      revokeOtherSessionsExcept: () => unexpectedMock("revokeOtherSessionsExcept not mocked"),
      ...options?.authControlPlane,
    }),
    Layer.mock(SessionCredentialService)({
      cookieName: baseDescriptor.sessionCookieName,
      issue: () => unexpectedMock("issue not mocked"),
      verify: () => unexpectedMock("verify not mocked"),
      issueWebSocketToken: () => unexpectedMock("issueWebSocketToken not mocked"),
      verifyWebSocketToken: () => unexpectedMock("verifyWebSocketToken not mocked"),
      listActive: () => unexpectedMock("listActive not mocked"),
      hasHistoryForRole: () => Effect.succeed(false),
      streamChanges: Stream.empty,
      revoke: () => unexpectedMock("revoke not mocked"),
      revokeAllExcept: () => unexpectedMock("revokeAllExcept not mocked"),
      markConnected: () => Effect.void,
      markDisconnected: () => Effect.void,
      ...options?.sessionCredentialService,
    }),
  );

  return makeServerAuth.pipe(Effect.provide(testLayer));
}

describe("makeServerAuth", () => {
  it("does not reissue anonymous owner bootstrap after the server has been claimed", async () => {
    const serverAuth = await Effect.runPromise(
      makeServerAuthUnderTest({
        sessionCredentialService: {
          hasHistoryForRole: () => Effect.succeed(true),
        },
      }),
    );

    await expect(
      Effect.runPromise(serverAuth.issueInitialOwnerPairingCredential()),
    ).rejects.toMatchObject({
      _tag: "AuthError",
      status: 403,
    } satisfies Partial<AuthError>);
  });

  it("keeps authenticated transport required after the original owner session expires", async () => {
    const serverAuth = await Effect.runPromise(
      makeServerAuthUnderTest({
        sessionCredentialService: {
          hasHistoryForRole: () => Effect.succeed(true),
        },
      }),
    );

    await expect(Effect.runPromise(serverAuth.isAuthenticatedTransportRequired())).resolves.toBe(
      true,
    );
  });
});
