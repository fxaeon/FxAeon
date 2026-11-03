import {
  generateRegistrationOptions, verifyRegistrationResponse, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { decodeCredentialPublicKey, convertCOSEtoPKCS, cose } from '@simplewebauthn/server/helpers';

export type Passkey = {
  id: string;
  publicKey: string;
  ownerPublicKey: string;
  counter: number;
  backedUp: true;
};

export function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 50_000) throw new Error('invalid_encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

export function registrationOptions(rpID: string, userHandle: string) {
  return generateRegistrationOptions({
    rpName: 'FxAeon', rpID, userID: new TextEncoder().encode(userHandle), userName: 'FxAeon wallet',
    attestationType: 'none', supportedAlgorithmIDs: [-7],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: 120_000,
  });
}

/** Only a verified ES256 credential can become a Privy owner. No caller-supplied owner key. */
export async function verifyRegistration(response: RegistrationResponseJSON, challenge: string, origin: string): Promise<Passkey> {
  const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge,
    expectedOrigin: origin, expectedRPID: new URL(origin).hostname, requireUserVerification: true,
    requireUserPresence: true, supportedAlgorithmIDs: [-7] });
  if (!result.verified || !result.registrationInfo.userVerified) throw new Error('passkey_rejected');
  const info = result.registrationInfo;
  // Until a second-key recovery flow exists, do not create a funded wallet tied to a device-only key.
  if (info.credentialDeviceType !== 'multiDevice' || !info.credentialBackedUp) throw new Error('passkey_backup_required');
  const key = decodeCredentialPublicKey(info.credential.publicKey);
  if (!cose.isCOSEPublicKeyEC2(key) || key.get(cose.COSEKEYS.alg) !== -7 || key.get(cose.COSEKEYS.crv) !== 1) {
    throw new Error('passkey_algorithm_rejected');
  }
  const imported = await crypto.subtle.importKey('raw', convertCOSEtoPKCS(info.credential.publicKey),
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', imported));
  return { id: info.credential.id, publicKey: encode(info.credential.publicKey),
    ownerPublicKey: btoa(String.fromCharCode(...spki)), counter: info.credential.counter, backedUp: true };
}

export async function verifyApproval(response: AuthenticationResponseJSON, passkey: Passkey, challenge: string, origin: string) {
  if (response.id !== passkey.id) throw new Error('passkey_rejected');
  const result = await verifyAuthenticationResponse({ response, expectedChallenge: challenge,
    expectedOrigin: origin, expectedRPID: new URL(origin).hostname, requireUserVerification: true,
    credential: { id: passkey.id, publicKey: decode(passkey.publicKey), counter: passkey.counter } });
  if (!result.verified || !result.authenticationInfo.userVerified) throw new Error('passkey_rejected');
  // BE is immutable. BS may change after enrollment and must not lock out a valid owner.
  if (result.authenticationInfo.credentialDeviceType !== 'multiDevice') {
    throw new Error('passkey_rejected');
  }
  return { counter: result.authenticationInfo.newCounter,
    authorization: `webauthn:${response.response.authenticatorData}:${response.response.clientDataJSON}:${response.response.signature}` };
}
