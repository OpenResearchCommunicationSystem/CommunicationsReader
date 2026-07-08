import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline as streamPipeline } from 'node:stream/promises';

// Run manually, once, on a networked dev/build machine before `npm run
// package` -- NOT part of the automated build (the investigator's
// air-gapped machine never runs this). Downloads the pre-converted ONNX
// weights that src/translate/translate.js loads with
// `local_files_only: true`, into models/translation/<code>/ (gitignored,
// asarUnpack'd in package.json -- see that file's build.asarUnpack).
//
// Only covers the four languages with an existing ONNX conversion on the
// Hugging Face Hub (ara/chi_sim/rus/tur, all under the Xenova namespace).
// Greek (ell) and Farsi (fas) have no pre-converted ONNX anywhere as of
// this writing -- see the plan doc's model-bundling section -- and need a
// one-time manual conversion instead; this script prints where to put the
// output rather than attempting it, since that step needs a Python +
// `optimum` environment this script can't assume exists.
const here = path.dirname(fileURLToPath(import.meta.url));
const MODELS_ROOT = path.join(here, '..', 'models', 'translation');

// The fixed file set transformers.js' seq2seq loader actually requests
// (config + generation config + SentencePiece tokenizer files + the two
// q8-quantized ONNX graphs) -- confirmed by reading
// node_modules/@huggingface/transformers/src/utils/model_registry/
// get_model_files.js and src/models/session_config.js, not guessed.
const REQUIRED_FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'source.spm',
  'target.spm',
  'vocab.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];
// Present on some repos, not others -- fetched best-effort, missing is not
// an error (transformers.js falls back to the .spm-derived slow tokenizer
// when tokenizer.json is absent).
const OPTIONAL_FILES = ['tokenizer.json'];

const READY_MODELS = {
  ara: 'Xenova/opus-mt-ar-en',
  chi_sim: 'Xenova/opus-mt-zh-en',
  rus: 'Xenova/opus-mt-ru-en',
  tur: 'Xenova/opus-mt-tr-en',
};

const NEEDS_MANUAL_CONVERSION = {
  ell: {
    source: 'Helsinki-NLP/opus-mt-tc-big-el-en',
    note: 'Not just "not yet converted" -- actually tried during implementation and hit a real wall. ' +
      '`optimum-cli export onnx --model Helsinki-NLP/opus-mt-tc-big-el-en --task text2text-generation-with-past` ' +
      'exports working ONNX graphs fine, but transformers.js\'s MarianTokenizer needs a tokenizer.json ' +
      '(not just source.spm/target.spm/vocab.json), and this model has none published anywhere. Hand-building ' +
      'one (tokenizers.models.Unigram seeded from source.spm scores, IDs aligned to vocab.json) encodes input ' +
      'correctly but the model then decodes into repetition-looping garbage -- see src/translate/translate.js\'s ' +
      'comment on AVAILABLE_LANGS. Don\'t just re-run the same conversion and assume it\'ll work; the fix (if any) ' +
      'needs to replicate whatever Xenova\'s own undocumented tokenizer conversion script does differently.',
  },
  fas: {
    source: 'persiannlp/mt5-small-parsinlu-opus-translation_fa_en',
    note: 'No pre-converted ONNX exists. This is an mT5 model (single shared spiece.model, not ' +
      'source.spm/target.spm) -- convert with:\n' +
      '    optimum-cli export onnx --model persiannlp/mt5-small-parsinlu-opus-translation_fa_en --task text2text-generation-with-past models/translation/fas-raw/\n' +
      '  then quantize and place the result in models/translation/fas/. CC-BY-NC-SA-4.0 licensed -- ' +
      'confirmed fine for this non-commercial tool, but don\'t redistribute the weights themselves ' +
      'outside this project without re-checking that.',
  },
};

async function downloadFile(repoId, filename, destPath) {
  const url = `https://huggingface.co/${repoId}/resolve/main/${filename}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} -> HTTP ${res.status}`);
  }
  mkdirSync(path.dirname(destPath), { recursive: true });
  await streamPipeline(res.body, createWriteStream(destPath));
}

async function fetchReadyModel(code, repoId) {
  const destDir = path.join(MODELS_ROOT, code);
  console.log(`\n${code} <- ${repoId}`);
  for (const filename of REQUIRED_FILES) {
    const destPath = path.join(destDir, filename);
    if (existsSync(destPath)) {
      console.log(`  skip (already present): ${filename}`);
      continue;
    }
    process.stdout.write(`  fetching ${filename}... `);
    await downloadFile(repoId, filename, destPath);
    console.log('done');
  }
  for (const filename of OPTIONAL_FILES) {
    const destPath = path.join(destDir, filename);
    if (existsSync(destPath)) continue;
    try {
      process.stdout.write(`  fetching ${filename} (optional)... `);
      await downloadFile(repoId, filename, destPath);
      console.log('done');
    } catch (err) {
      console.log(`skipped (${err.message})`);
    }
  }
}

async function main() {
  for (const [code, repoId] of Object.entries(READY_MODELS)) {
    await fetchReadyModel(code, repoId);
  }

  console.log('\n--- Languages needing a one-time manual ONNX conversion ---');
  for (const [code, { source, note }] of Object.entries(NEEDS_MANUAL_CONVERSION)) {
    const destDir = path.join(MODELS_ROOT, code);
    const alreadyDone = existsSync(path.join(destDir, 'config.json'));
    console.log(`\n${code} (source: ${source}) -- ${alreadyDone ? 'already present, skipping' : 'NOT YET DONE'}`);
    if (!alreadyDone) console.log(`  ${note}`);
  }

  console.log('\nDone. Verify with `npm test` and by launching the app before packaging.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
