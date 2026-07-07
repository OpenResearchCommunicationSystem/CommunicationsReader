import { importArchive } from './index.js';

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('Usage: node src/parser/cli-test.js path/to/archive.zip');
  process.exit(1);
}

const result = await importArchive({ zipPath, outputAttachmentsDir: null });

console.log(`Container type: ${result.containerType}`);
if (result.note) console.log(`Note: ${result.note}`);
console.log(
  `Summary: ${result.summary.succeeded} succeeded, ${result.summary.failed} failed, ${result.summary.total} total`
);

if (result.failures.length > 0) {
  console.log('\nFailures:');
  for (const f of result.failures) {
    console.log(`  - source: ${JSON.stringify(f.sourceInfo)}`);
    console.log(`    error: ${f.error.message}`);
    console.log(`    header snippet: ${f.headerSnippet.slice(0, 200).replace(/\n/g, '\\n')}`);
  }
}

if (result.messages.length > 0) {
  const sample = result.messages[0];
  console.log('\nSample message (first succeeded):');
  console.log(`  from: ${sample.from}`);
  console.log(`  subject: ${sample.subject}`);
  console.log(`  date: ${sample.date ? new Date(sample.date).toISOString() : null}`);
  console.log(`  messageId: ${sample.messageId}`);
  console.log(`  bodyEmpty: ${sample.bodyEmpty}`);
  console.log(`  attachments: ${sample.attachments.length}`);
  console.log(`  rawHash: ${sample.rawHash}`);
  console.log(`  normalizedHash: ${sample.normalizedHash}`);
  console.log(`  encodingUncertain: ${sample.encodingUncertain}`);
  console.log(`  charsetOverridden: ${sample.charsetOverridden}`);
}
