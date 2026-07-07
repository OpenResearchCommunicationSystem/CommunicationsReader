// English + Farsi keyword list for crypto/hawala-adjacent language.
// Farsi terms are a starting set drawn from this project's known real
// test data and prior tool's feature list -- expand with a domain
// expert's review before relying on this list for real casework.
//
// Both the space-joined ("بیت کوین") and ZWNJ-joined ("بیت‌کوین")
// transliterations of "bitcoin" are listed as separate explicit entries
// rather than trying to normalize the ZWNJ away, since that
// normalization is itself a source of subtle bugs -- scan.js instead
// NFC-normalizes the scanned text and matches both forms directly.
export const KEYWORDS = [
  { term: 'bitcoin', lang: 'en', patternName: 'keyword_en_bitcoin' },
  { term: 'ethereum', lang: 'en', patternName: 'keyword_en_ethereum' },
  { term: 'crypto wallet', lang: 'en', patternName: 'keyword_en_crypto_wallet' },
  { term: 'cryptocurrency', lang: 'en', patternName: 'keyword_en_cryptocurrency' },
  { term: 'tether', lang: 'en', patternName: 'keyword_en_tether' },
  { term: 'usdt', lang: 'en', patternName: 'keyword_en_usdt' },
  { term: 'metamask', lang: 'en', patternName: 'keyword_en_metamask' },
  { term: 'binance', lang: 'en', patternName: 'keyword_en_binance' },
  { term: 'coinbase', lang: 'en', patternName: 'keyword_en_coinbase' },
  { term: 'seed phrase', lang: 'en', patternName: 'keyword_en_seed_phrase' },
  { term: 'private key', lang: 'en', patternName: 'keyword_en_private_key' },
  { term: 'hawala', lang: 'en', patternName: 'keyword_en_hawala' },
  { term: 'money transfer agent', lang: 'en', patternName: 'keyword_en_money_transfer_agent' },
  { term: 'trc20', lang: 'en', patternName: 'keyword_en_trc20' },
  { term: 'erc20', lang: 'en', patternName: 'keyword_en_erc20' },

  { term: 'حواله', lang: 'fa', patternName: 'keyword_fa_hawala' }, // hawala
  { term: 'کیف پول', lang: 'fa', patternName: 'keyword_fa_wallet' }, // wallet
  { term: 'ارز دیجیتال', lang: 'fa', patternName: 'keyword_fa_digital_currency' }, // digital currency
  { term: 'رمزارز', lang: 'fa', patternName: 'keyword_fa_cryptocurrency' }, // cryptocurrency
  { term: 'بیت کوین', lang: 'fa', patternName: 'keyword_fa_bitcoin' }, // bitcoin (space-joined)
  { term: 'بیت‌کوین', lang: 'fa', patternName: 'keyword_fa_bitcoin_zwnj' }, // bitcoin (ZWNJ-joined)
  { term: 'صرافی', lang: 'fa', patternName: 'keyword_fa_exchange_house' }, // money-exchange house
  { term: 'تتر', lang: 'fa', patternName: 'keyword_fa_tether' }, // tether
];
