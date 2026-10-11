/** Known naming aliases only. RDNS is self-attested display metadata, never
 * proof of authenticity. Distinct provider objects remain distinct claims.
 * MetaMask Mobile uses io.metamask.mobile in its providerInfo announcement:
 * https://github.com/MetaMask/metamask-mobile/blob/bedf01fd2cd72cc60d16b1d56069582de0d86ea0/scripts/inpage-bridge/src/provider.js
 */
export function walletIdentityRdns(rdns: string): string {
  return rdns === 'io.metamask.mobile' ? 'io.metamask' : rdns;
}
