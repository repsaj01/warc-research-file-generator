/**
 * WARC splitter — core domain logic.
 *
 * Takes a compressed Common Crawl segment and splits it into individual
 * .warc files categorised by uncompressed size. For the L category, where
 * individual pages are rarely > 10 MB, consecutive records are bundled
 * until the target size is reached.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { createGunzip } from "zlib";
import { join } from "path";
import { SplitTarget } from "./types.js";
import {
  WarcRecordAccumulator,
  extractTargetUri,
  extractWarcType,
  sanitiseFilename,
} from "./warc.js";

interface RecordGroup {
  records: Buffer[];
  totalBytes: number;
  targetUri: string | null;
}

/**
 * Write a completed record group to disk if it matches a needed category.
 * Returns true if the file was written, false otherwise.
 */
async function tryWriteGroup(
  group: RecordGroup,
  targets: SplitTarget[],
  outputDir: string,
  fileCounter: { value: number }
): Promise<boolean> {
  if (group.records.length === 0) return false;

  const size = group.totalBytes;
  const target = targets.find(
    (t) =>
      t.category.name !== "L" &&
      t.produced < t.targetCount &&
      size >= t.category.minBytes &&
      size < t.category.maxBytes
  );

  if (!target) return false;

  const hostname = group.targetUri
    ? sanitiseFilename(group.targetUri)
    : `record-${fileCounter.value}`;
  const catLabel = target.category.name.toLowerCase();
  const filename = `cc-${hostname}-${catLabel}-${target.produced + 1}.warc`;
  const filePath = join(outputDir, filename);

  const fileStream = createWriteStream(filePath);
  for (const record of group.records) {
    fileStream.write(record);
  }
  fileStream.end();
  await new Promise<void>((resolve) => fileStream.on("finish", resolve));

  target.produced++;
  fileCounter.value++;

  const displaySize = formatSize(size);
  console.log(`  [${target.category.name}] ${filename} (${displaySize}, ${group.records.length} records)`);

  return true;
}

const LARGE_BUNDLE_TARGET_BYTES = 15 * 1024 * 1024; // 15 MB per bundle

/**
 * Build large files by bundling consecutive records from the source until
 * each bundle crosses the target size threshold.
 */
async function buildLargeFiles(
  sourcePath: string,
  outputDir: string,
  target: SplitTarget
): Promise<void> {
  console.log("\nBuilding large files by combining records...");

  const sourceStream = createReadStream(sourcePath);
  const gunzip = createGunzip();
  const accumulator = new WarcRecordAccumulator();

  let bundle: Buffer[] = [];
  let bundleSize = 0;
  let bundleIndex = target.produced;

  const writeBundle = async () => {
    if (bundle.length === 0) return;
    bundleIndex++;
    const filename = `cc-bundle-l-${bundleIndex}.warc`;
    const filePath = join(outputDir, filename);

    const fileStream = createWriteStream(filePath);
    for (const record of bundle) {
      fileStream.write(record);
    }
    fileStream.end();
    await new Promise<void>((resolve) => fileStream.on("finish", resolve));

    target.produced++;
    console.log(`  [L] ${filename} (${formatSize(bundleSize)}, ${bundle.length} records)`);

    bundle = [];
    bundleSize = 0;
  };

  const recordStream = sourceStream.pipe(gunzip).pipe(accumulator);

  for await (const recordBuf of recordStream as AsyncIterable<Buffer>) {
    bundle.push(recordBuf);
    bundleSize += recordBuf.length;

    if (bundleSize >= LARGE_BUNDLE_TARGET_BYTES) {
      await writeBundle();
      if (target.produced >= target.targetCount) break;
    }
  }

  // Write any remainder if it qualifies as L
  if (bundleSize >= target.category.minBytes && target.produced < target.targetCount) {
    await writeBundle();
  }
}

/**
 * Split a compressed WARC segment into size-categorised .warc files.
 *
 * For XS, S, and M categories: individual page groups (a response record
 * plus its associated resources) are written as separate files.
 *
 * For L: consecutive records are bundled into ~15 MB files.
 */
export async function splitWarcBySize(
  sourcePath: string,
  outputDir: string,
  targets: SplitTarget[]
): Promise<void> {
  const nonLargeTargets = targets.filter(
    (t) => t.category.name !== "L" && t.produced < t.targetCount
  );
  const largeTarget = targets.find(
    (t) => t.category.name === "L" && t.produced < t.targetCount
  );

  // Phase 1: split individual pages into XS, S, M
  if (nonLargeTargets.length > 0) {
    console.log("\nSplitting WARC file into size categories...");
    await splitByPageGroups(sourcePath, outputDir, targets);
  }

  // Phase 2: bundle records for L
  if (largeTarget) {
    await buildLargeFiles(sourcePath, outputDir, largeTarget);
  }
}

/**
 * Split by page groups — processes the stream once and writes files for
 * XS, S, and M categories as matching page groups are found.
 */
async function splitByPageGroups(
  sourcePath: string,
  outputDir: string,
  targets: SplitTarget[]
): Promise<void> {
  const sourceStream = createReadStream(sourcePath);
  const gunzip = createGunzip();
  const accumulator = new WarcRecordAccumulator();

  let currentGroup: RecordGroup = { records: [], totalBytes: 0, targetUri: null };
  const fileCounter = { value: 0 };

  const recordStream = sourceStream.pipe(gunzip).pipe(accumulator);

  for await (const recordBuf of recordStream as AsyncIterable<Buffer>) {
    const warcType = extractWarcType(recordBuf);
    const targetUri = extractTargetUri(recordBuf);

    // Start a new group on response/resource/warcinfo records or a new URI
    const isNewPage =
      warcType === "response" ||
      warcType === "resource" ||
      warcType === "warcinfo" ||
      (targetUri && targetUri !== currentGroup.targetUri);

    if (isNewPage && currentGroup.records.length > 0) {
      await tryWriteGroup(currentGroup, targets, outputDir, fileCounter);
      currentGroup = { records: [], totalBytes: 0, targetUri: null };

      // Stop early if all non-L targets are met
      const allDone = targets
        .filter((t) => t.category.name !== "L")
        .every((t) => t.produced >= t.targetCount);
      if (allDone) {
        console.log("\nAll page-level categories filled.");
        break;
      }
    }

    currentGroup.records.push(recordBuf);
    currentGroup.totalBytes += recordBuf.length;
    if (targetUri) currentGroup.targetUri = targetUri;
  }

  // Don't forget the last group
  await tryWriteGroup(currentGroup, targets, outputDir, fileCounter);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
