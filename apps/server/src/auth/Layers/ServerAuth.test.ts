import { AuthSessionId, type ServerAuthDescriptor } from "@t3tools/contracts";
import { DateTime, Effect, Layer, Stream } from "effect";
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
  it("reissues anonymous owner bootstrap after the last owner session is gone", async () => {
    const issuedPairingLink = {
      id: "pairing-owner-2",
      credential: "owner-recovery-token",
      role: "owner" as const,
      subject: "owner-bootstrap",
      createdAt: DateTime.makeUnsafe("2026-04-10T11:55:00.000Z").pipe(DateTime.toUtc),
      expiresAt: DateTime.makeUnsafe("2026-04-10T12:00:00.000Z").pipe(DateTime.toUtc),
    } as const;
    const issuedCredential = {
      id: issuedPairingLink.id,
      credential: issuedPairingLink.credential,
      expiresAt: issuedPairingLink.expiresAt,
    } as const;
    const serverAuth = await Effect.runPromise(
      makeServerAuthUnderTest({
        authControlPlane: {
          createPairingLink: () => Effect.succeed(issuedPairingLink),
        },
        sessionCredentialService: {
          hasHistoryForRole: () => Effect.succeed(true),
        },
      }),
    );

    await expect(
      Effect.runPromise(serverAuth.issueInitialOwnerPairingCredential()),
    ).resolves.toEqual(issuedCredential);
  });

  it("keeps anonymous owner bootstrap blocked while an owner session is active", async () => {
    const serverAuth = await Effect.runPromise(
      makeServerAuthUnderTest({
        authControlPlane: {
          listSessions: () =>
            Effect.succeed([
              {
                sessionId: AuthSessionId.makeUnsafe("session-owner-1"),
                subject: "owner",
                role: "owner",
                method: "browser-session-cookie",
                client: {
                  label: "Owner Browser",
                  deviceType: "desktop",
                  os: "macOS",
                },
                issuedAt: DateTime.makeUnsafe("2026-04-10T10:00:00.000Z").pipe(DateTime.toUtc),
                expiresAt: DateTime.makeUnsafe("2026-05-10T10:00:00.000Z").pipe(DateTime.toUtc),
                lastConnectedAt: DateTime.makeUnsafe("2026-04-10T10:00:00.000Z").pipe(
                  DateTime.toUtc,
                ),
                connected: true,
                current: false,
              },
            ]),
        },
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
