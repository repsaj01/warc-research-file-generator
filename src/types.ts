/**
 * Shared types and constants for the Common Crawl WARC fetcher.
 */

export interface SizeCategory {
  name: string;
  label: string;
  minBytes: number;
  maxBytes: number;
}

export const SIZE_CATEGORIES: SizeCategory[] = [
  { name: "XS", label: "Extra-small", minBytes: 0, maxBytes: 100 * 1024 },
  { name: "S", label: "Small", minBytes: 100 * 1024, maxBytes: 1024 * 1024 },
  { name: "M", label: "Medium", minBytes: 1024 * 1024, maxBytes: 10 * 1024 * 1024 },
  { name: "L", label: "Large", minBytes: 10 * 1024 * 1024, maxBytes: Infinity },
];

export interface SplitTarget {
  category: SizeCategory;
  targetCount: number;
  produced: number;
}

export interface FetcherOptions {
  output: string;
  crawl: string;
  segmentIndex: number;
  categories: string[];
  perCategory: number;
  keepSource: boolean;
  dryRun: boolean;
}

export const WARC_HEADER_MARKER = Buffer.from("WARC/1.");
export const CRLFCRLF = Buffer.from("\r\n\r\n");

export const COMMONCRAWL_BASE = "https://data.commoncrawl.org";
