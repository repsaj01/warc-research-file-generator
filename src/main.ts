/**
 * fetch-commoncrawl — CLI entrypoint.
 *
 * Downloads a WARC segment from Common Crawl and splits it into
 * size-categorised files for the benchmark suite.
 *
 * Usage:
 *   npx tsx src/main.ts [options]
 *
 * Options:
 *   --output <dir>       Output directory (default: ./data/warc-commoncrawl)
 *   --crawl <id>         Common Crawl crawl ID (default: CC-MAIN-2026-09)
 *   --segment <index>    Segment index to download (default: 0)
 *   --categories <list>  Comma-separated: XS,S,M,L (default: all)
 *   --per-category <n>   Files to produce per category (default: 5)
 *   --keep-source        Keep the downloaded .warc.gz after splitting
 *   --dry-run            Show plan without downloading
 *
 * Examples:
 *   npx tsx src/main.ts
 *   npx tsx src/main.ts --categories L --per-category 10
 *   npx tsx src/main.ts --crawl CC-MAIN-2026-05 --per-category 8
 */

import { mkdirSync, existsSync, statSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import { FetcherOptions, SIZE_CATEGORIES, SplitTarget } from "./types.js";
import { resolveSegmentUrl } from "./commoncrawl.js";
import { downloadFile } from "./http.js";
import { splitWarcBySize } from "./splitter.js";

function parseArgs(): FetcherOptions {
  const args = process.argv.slice(2);
  const opts: FetcherOptions = {
    output: "./data/warc-commoncrawl",
    crawl: "CC-MAIN-2026-12",
    segmentIndex: 0,
    categories: ["XS", "S", "M", "L"],
    perCategory: 5,
    keepSource: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--output":
        opts.output = args[++i];
        break;
      case "--crawl":
        opts.crawl = args[++i];
        break;
      case "--segment":
        opts.segmentIndex = parseInt(args[++i], 10);
        break;
      case "--categories":
        opts.categories = args[++i].split(",").map((c) => c.trim().toUpperCase());
        break;
      case "--per-category":
        opts.perCategory = parseInt(args[++i], 10);
        break;
      case "--keep-source":
        opts.keepSource = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        process.exit(1);
    }
  }

  return opts;
}

function formatBytes(bytes: number): string {
  if (bytes === Infinity) return "∞";
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Count existing output files that match a category pattern.
 */
function countExistingFiles(outputDir: string, categoryName: string): number {
  if (!existsSync(outputDir)) return 0;
  const pattern = `-${categoryName.toLowerCase()}-`;
  return readdirSync(outputDir).filter(
    (f) => f.startsWith("cc-") && f.includes(pattern) && f.endsWith(".warc")
  ).length;
}

/**
 * Build the target list, accounting for files already on disk.
 */
function buildTargets(opts: FetcherOptions): SplitTarget[] {
  return SIZE_CATEGORIES.filter((c) => opts.categories.includes(c.name)).map((category) => ({
    category,
    targetCount: opts.perCategory,
    produced: countExistingFiles(opts.output, category.name),
  }));
}

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log(`Crawl:          ${opts.crawl}`);
  console.log(`Segment index:  ${opts.segmentIndex}`);
  console.log(`Categories:     ${opts.categories.join(", ")}`);
  console.log(`Per category:   ${opts.perCategory}`);
  console.log(`Output:         ${opts.output}`);
  console.log();

  // Resolve the segment URL
  const segment = await resolveSegmentUrl(opts.crawl, opts.segmentIndex);
  console.log(`Found ${segment.totalSegments} segments in crawl ${opts.crawl}.`);
  console.log(`Selected: ${segment.filename}`);
  console.log(`URL: ${segment.url}`);

  if (opts.dryRun) {
    console.log("\n[Dry run] Would download and split this segment. Exiting.");
    return;
  }

  // Prepare output directory and targets
  mkdirSync(opts.output, { recursive: true });
  const targets = buildTargets(opts);

  const needed = targets.filter((t) => t.produced < t.targetCount);
  if (needed.length === 0) {
    console.log("\nAll categories already have enough files. Nothing to do.");
    console.log("Delete existing files or increase --per-category to regenerate.");
    return;
  }

  console.log("\nTarget status:");
  for (const t of targets) {
    const status =
      t.produced >= t.targetCount
        ? "✓ done"
        : `need ${t.targetCount - t.produced} more`;
    const range = `${formatBytes(t.category.minBytes)}–${formatBytes(t.category.maxBytes)}`;
    console.log(`  ${t.category.name} (${range}): ${t.produced}/${t.targetCount} (${status})`);
  }

  // Download the segment
  const sourcePath = join(opts.output, segment.filename);
  if (existsSync(sourcePath)) {
    const size = statSync(sourcePath).size;
    console.log(`\nSource file already exists (${formatBytes(size)}), skipping download.`);
  } else {
    console.log(`\nDownloading ${segment.filename}...`);
    await downloadFile(segment.url, sourcePath);
    const size = statSync(sourcePath).size;
    console.log(`Downloaded ${formatBytes(size)}.`);
  }

  // Split
  await splitWarcBySize(sourcePath, opts.output, targets);

  // Summary
  console.log("\n=== Summary ===");
  for (const t of targets) {
    const icon = t.produced >= t.targetCount ? "✓" : "✗";
    console.log(`  ${icon} ${t.category.name}: ${t.produced}/${t.targetCount} files`);
  }

  const unmet = targets.filter((t) => t.produced < t.targetCount);
  if (unmet.length > 0) {
    console.log("\nSome categories were not fully filled. Try:");
    console.log("  - A different segment: --segment 1");
    console.log("  - A different crawl:   --crawl CC-MAIN-2026-05");
    console.log("  - Running again (existing files are preserved and counted)");
  }

  // Clean up
  if (!opts.keepSource && existsSync(sourcePath)) {
    console.log(`\nRemoving source file ${segment.filename}...`);
    unlinkSync(sourcePath);
    console.log("Done.");
  } else if (opts.keepSource) {
    console.log(`\nSource file kept at ${sourcePath}`);
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
