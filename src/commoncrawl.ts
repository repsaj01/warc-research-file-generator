/**
 * Common Crawl API client.
 * Resolves a crawl ID and segment index into a downloadable URL.
 */

import { COMMONCRAWL_BASE } from "./types.js";
import { fetchGzippedText } from "./http.js";

/**
 * Fetch the list of WARC segment paths for a given crawl.
 * Each path is relative to COMMONCRAWL_BASE.
 */
export async function getSegmentPaths(crawlId: string): Promise<string[]> {
  const url = `${COMMONCRAWL_BASE}/crawl-data/${crawlId}/warc.paths.gz`;
  console.log(`Fetching segment list from ${url}...`);

  const text = await fetchGzippedText(url);

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Resolve a crawl ID and segment index to a full download URL.
 */
export async function resolveSegmentUrl(
  crawlId: string,
  segmentIndex: number
): Promise<{ url: string; filename: string; totalSegments: number }> {
  const paths = await getSegmentPaths(crawlId);

  if (segmentIndex >= paths.length) {
    throw new Error(
      `Segment index ${segmentIndex} out of range (0-${paths.length - 1}) for crawl ${crawlId}.`
    );
  }

  const segmentPath = paths[segmentIndex];
  const parts = segmentPath.split("/");
  const filename = parts[parts.length - 1];

  return {
    url: `${COMMONCRAWL_BASE}/${segmentPath}`,
    filename,
    totalSegments: paths.length,
  };
}
