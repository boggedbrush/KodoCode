import { threadEnvironment } from "../state/threads";

/**
 * The one command the inbox answers an approval with: the one the approval's own card sends. An agent
 * has no way to press these buttons, and the inbox adds no other way to approve.
 */
export const kodoInboxApprovalCommand = threadEnvironment.respondToApproval;
