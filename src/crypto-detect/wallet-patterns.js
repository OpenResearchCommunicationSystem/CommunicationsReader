// Deterministic wallet-address detection: regex on charset + length only,
// no checksum verification (that would require a Base58Check decode +
// double-SHA256 per match for the Bitcoin-family chains). This is a known
// false-positive source, not a defect -- see per-pattern notes below.
//
// XRP's alphabet verified 2026-07-06 against xrpl.org's own documentation
// ("The XRP Ledger uses the base58 dictionary:
// rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz") -- Ripple
// uses a non-standard Base58 alphabet ordering, different from Bitcoin's.
export const WALLET_PATTERNS = {
  // Bitcoin Legacy P2PKH (starts '1') and P2SH (starts '3'), Base58Check,
  // 25-34 chars, Base58 alphabet excludes 0, O, I, l.
  btc_legacy: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g,

  // Bitcoin Bech32/SegWit (BIP-173), 'bc1' prefix, Bech32 charset
  // (qpzry9x8gf2tvdw0s3jn54khce6mua7l -- excludes 1, b, i, o).
  btc_bech32: /\bbc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{25,90}\b/g,

  // Ethereum / any ERC-20 token address (same 20-byte-hex format).
  // EIP-55 checksum casing not enforced -- mixed-case accepted as-is.
  eth: /\b0x[a-fA-F0-9]{40}\b/g,

  // TRON / TRC-20, Base58Check, always 34 chars, always starts 'T'.
  tron: /\bT[a-km-zA-HJ-NP-Z1-9]{33}\b/g,

  // Monero, Base58 (block-encoding variant, not Base58Check), standard
  // public address starts '4' (or '8' for integrated addresses), 95 chars.
  xmr: /\b[48][a-km-zA-HJ-NP-Z1-9]{94}\b/g,

  // Litecoin: Legacy 'L'/'M' (P2SH, post-2017), or 'ltc1' Bech32.
  ltc: /\b(?:[LM][a-km-zA-HJ-NP-Z1-9]{26,33}|ltc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{25,90})\b/g,

  // XRP (Ripple): Base58 with Ripple's own non-standard alphabet, always
  // starts 'r', 25-35 chars.
  xrp: /\br[rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz]{24,34}\b/g,

  // Dogecoin: Base58Check, starts 'D', 34 chars.
  doge: /\bD[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}\b/g,

  // Bitcoin Cash CashAddr (post-2018 standard), optional 'bitcoincash:'
  // prefix, 'q' (P2PKH) or 'p' (P2SH) + 41 chars of the same charset as
  // Bech32 (qpzry9x8gf2tvdw0s3jn54khce6mua7l).
  bch: /\b(?:bitcoincash:)?[qp][qpzry9x8gf2tvdw0s3jn54khce6mua7l]{41}\b/g,

  // Solana: base58 public key (Bitcoin's own Base58 alphabet, unlike
  // XRP), 32-44 chars. NOTE: unlike the Bitcoin-family patterns above,
  // Solana addresses have no version-byte/checksum structure at all --
  // this is a length/charset heuristic ONLY and will have a meaningfully
  // higher false-positive rate (any 32-44 char Base58 string matches,
  // including other chains' addresses). Tag matches from this pattern as
  // lower-confidence in any UI/report, never presented with the same
  // confidence as the checksummed formats above.
  sol_heuristic: /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g,
};
