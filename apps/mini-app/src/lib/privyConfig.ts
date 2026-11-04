/**
 * Public Privy application identity. Passkey signing challenges are bound to
 * this build-time value; it is not a browser authentication SDK or signer.
 */

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

export const PRIVY_APP_ID = APP_ID;
