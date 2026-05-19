# fetch-commoncrawl

Downloads WARC files from [Common Crawl](https://commoncrawl.org/) and splits them into size-categorised files.

## Structure

```
src/
- main.ts          CLI entrypoint and orchestration
- types.ts         Shared types, constants, and size category definitions
- http.ts          HTTP utilities (streaming downloads, progress, gzip)
- commoncrawl.ts   Common Crawl API client (segment path resolution)
- warc.ts          WARC record parsing (Transform stream, header extraction)
- splitter.ts      Core splitting logic (page groups → categorised files)
```

## Usage

```bash
# Install dependencies (from the project root)
npm install

# Generate 5 files per category (XS, S, M, L)
npx tsx src/main.ts

# Only generate Large files
npx tsx src/main.ts --categories L --per-category 5

# Full reproducible set for benchmarking
npx tsx src/main.ts --categories XS,S,M,L --per-category 10

# Preview what would be downloaded
npx tsx src/main.ts --dry-run
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--output <dir>` | `./data/warc-commoncrawl` | Output directory |
| `--crawl <id>` | `CC-MAIN-2026-12` | Common Crawl crawl ID |
| `--segment <n>` | `0` | Segment index within the crawl |
| `--categories <list>` | `XS,S,M,L` | Comma-separated categories |
| `--per-category <n>` | `5` | Files to produce per category |
| `--keep-source` | `false` | Keep the downloaded `.warc.gz` |
| `--dry-run` | `false` | Show plan without downloading |

## Size categories

| Category | Range | Strategy |
|----------|-------|----------|
| XS | < 100 KB | Individual page groups |
| S | 100 KB – 1 MB | Individual page groups |
| M | 1 – 10 MB | Individual page groups |
| L | > 10 MB | Bundled consecutive records (~15 MB each) |

## Idempotency

The script counts existing `cc-*.warc` files in the output directory and only generates what's missing. Run it again with `--segment 1` to pull from a different segment if the first didn't have enough pages in a given size range.

## Notes

- Segment files are ~1 GB compressed. The download can take a while.
- The source `.warc.gz` is deleted after splitting unless `--keep-source` is passed.
- L-category files are built by bundling records because individual web pages rarely exceed 10 MB.
- Available crawl IDs can be found at https://index.commoncrawl.org/
