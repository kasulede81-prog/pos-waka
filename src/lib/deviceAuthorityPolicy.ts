/**
 * Device authority policy — primary designation is disabled so any device with
 * valid credentials can sign in and use the shop without "primary device" gates.
 */
export const ENFORCE_PRIMARY_DEVICE = false;

/** Auto-approve this device on owner login instead of blocking on pending approval. */
export const AUTO_APPROVE_DEVICE_ON_OWNER_LOGIN = true;

/** Allow staff PIN login even when device approval is still pending. */
export const ALLOW_STAFF_LOGIN_WHILE_DEVICE_PENDING = true;
