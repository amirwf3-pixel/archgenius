#!/usr/bin/env node
/**
 * sources/register-source.js
 *
 * Helper CLI that registers a primary-source PDF into the source registry.
 *
 * Usage:
 *   node sources/register-source.js <sourceId> <path-to-pdf>
 *
 * It computes the SHA-256 digest, updates packages/core/src/regulations/
 * packs/source-registry.ts in-place by setting documentPath and digest for
 * the matching source entry, and prints the new registry line to stdout.
 *
 * After running this you still need to:
 *   1. Mark individual clauses as verified (status: 'VERIFIED') in the
 *      rule's sources[] entries and on the rule itself, with verifiedAt.
 *   2. Add boundary/regression tests for each newly verified rule.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [,, sourceId, relPath] = process.argv;
if (!sourceId || !relPath) {
  console.error('Usage: node sources/register-source.js <sourceId> <path-to-pdf>');
  process.exit(1);
}

const absPath = resolve(process.cwd(), relPath);
const buf = readFileSync(absPath);
const hash = createHash('sha256').update(buf).digest('hex');
console.error(`SHA-256(${relPath}) = ${hash}`);
console.error(`Size: ${buf.length} bytes`);

const registryPath = resolve(process.cwd(), 'packages/core/src/regulations/packs/source-registry.ts');
let src = readFileSync(registryPath, 'utf8');

// Find the entry with the matching id.
const entryRegex = new RegExp(
  `(\\{[^}]*id:\\s*'${sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[^}]*)(verificationState:\\s*'not-obtained')`,
  's'
);
if (!entryRegex.test(src)) {
  console.error(`No entry with id '${sourceId}' found in source-registry.ts`);
  process.exit(2);
}

const relFromPackageSrc = relPath.startsWith('sources/') ? relPath : `sources/${relPath.split('/').pop()}`;
const today = new Date().toISOString().slice(0, 10);

// Replace verificationState and add documentPath + digest.
src = src.replace(entryRegex, (_, head) => {
  // Strip existing documentPath / digest lines if present.
  let next = head;
  next = next.replace(/documentPath:\s*[^,]+,\s*/g, '');
  next = next.replace(/digest:\s*\{[^}]+\},\s*/g, '');
  next = next.replace(/verificationState:\s*'[^']*',?\s*/g, '');
  // Close the brace so we can insert fields.
  const trimmed = next.replace(/,\s*$/, '');
  return `${trimmed},\n    documentPath: '${relFromPackageSrc}',\n    digest: { algorithm: 'sha256' as const, value: '${hash}' },\n    verificationState: 'obtained-authenticated' as const,\n    retrievedAt: '${today}',`;
});

writeFileSync(registryPath, src);
console.error(`Updated ${registryPath} for ${sourceId}`);
console.error('Now review the entry, set edition/publicationDate if necessary,');
console.error('and promote individual rules by setting their status to VERIFIED');
console.error('along with SourceRef.page numbers and verifiedAt dates.');
