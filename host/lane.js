/**
 * Lane preference: a same-LAN peer always wins, then a punched P2P path, then
 * the relay. Kept pure so the ordering is testable without any network.
 */
export function selectLane({ sameLan = false, punched = false, relayAvailable = false } = {}) {
  if (sameLan) return 'lan'
  if (punched) return 'p2p'
  if (relayAvailable) return 'relay'
  return 'none'
}
