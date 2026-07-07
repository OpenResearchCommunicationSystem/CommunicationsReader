import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../src/crypto-detect/scan.js';

function matchTypesFor(text) {
  return scanText(text).map((m) => m.matchType);
}

test('BTC legacy: Bitcoin genesis block coinbase address (well-known, safe test value)', () => {
  const text = 'Send funds to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa please.';
  assert.ok(matchTypesFor(text).includes('btc_legacy'));
});

test('BTC bech32: BIP-173 published test vector', () => {
  const text = 'Address: bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
  assert.ok(matchTypesFor(text).includes('btc_bech32'));
});

test('ETH: well-known public address', () => {
  const text = 'ETH wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 for donations';
  assert.ok(matchTypesFor(text).includes('eth'));
});

test('ETH: burn address (40 hex chars, constructed to avoid a by-hand miscount)', () => {
  const addr = '0x' + '0'.repeat(36) + 'dEaD';
  assert.equal(addr.length, 42);
  assert.ok(matchTypesFor(`sent to ${addr}`).includes('eth'));
});

test('TRON: syntactically valid 34-char T-prefixed address', () => {
  const addr = 'T' + 'a'.repeat(33);
  assert.equal(addr.length, 34);
  assert.ok(matchTypesFor(`TRC20 address: ${addr}`).includes('tron'));
});

test('Monero: syntactically valid 95-char address', () => {
  const addr = '4' + 'A'.repeat(94);
  assert.ok(matchTypesFor(`monero: ${addr}`).includes('xmr'));
});

test('Litecoin: legacy L-prefixed address', () => {
  const addr = 'L' + 'a'.repeat(27);
  assert.ok(matchTypesFor(`ltc: ${addr}`).includes('ltc'));
});

test('Litecoin: bech32 ltc1 address', () => {
  const addr = 'ltc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
  assert.ok(matchTypesFor(`ltc: ${addr}`).includes('ltc'));
});

test('XRP: r-prefixed address using Ripple\'s own alphabet', () => {
  const text = 'ripple: rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
  assert.ok(matchTypesFor(text).includes('xrp'));
});

test('Dogecoin: D-prefixed address', () => {
  const addr = 'D' + '8' + 'a'.repeat(32);
  assert.ok(matchTypesFor(`doge: ${addr}`).includes('doge'));
});

test('Bitcoin Cash: CashAddr with bitcoincash: prefix', () => {
  const addr = 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a';
  assert.ok(matchTypesFor(addr).includes('bch'));
});

test('Solana: heuristic match on a valid-shaped base58 string', () => {
  const addr = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  assert.ok(matchTypesFor(`sol: ${addr}`).includes('sol_heuristic'));
});

test('plain English prose does not trigger wallet false positives', () => {
  const text = 'This is a perfectly ordinary business email about shipping schedules.';
  const walletMatches = scanText(text).filter((m) => m.matchType !== 'keyword');
  assert.equal(walletMatches.length, 0);
});
