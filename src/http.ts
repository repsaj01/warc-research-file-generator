/**
 * HTTP utilities for fetching Common Crawl data.
 * Handles redirects, progress reporting, and streaming downloads.
 */

import { createWriteStream } from "fs";
import { createGunzip } from "zlib";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import http from "http";
import https from "https";

/**
 * Fetch a URL and return the response as a Readable stream.
 * Follows 301/302 redirects automatically.
 */
export function fetchStream(url: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            fetchStream(location).then(resolve, reject);
            return;
          }
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        resolve(res as unknown as Readable);
      })
      .on("error", reject);
  });
}

/**
 * Fetch a gzipped text file from a URL and return its contents as a string.
 */
export async function fetchGzippedText(url: string): Promise<string> {
  const stream = await fetchStream(url);
  const gunzip = createGunzip();
  const chunks: Buffer[] = [];

  await pipeline(stream, gunzip, async function* (source) {
    for await (const chunk of source) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  });

  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Download a file from a URL to a local path, printing progress to stderr.
 */
export function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;

    const doRequest = (requestUrl: string) => {
      client
        .get(requestUrl, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const location = res.headers.location;
            if (location) {
              doRequest(location);
              return;
            }
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`));
            return;
          }

          const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
          let downloadedBytes = 0;
          let lastPercent = -1;

          const fileStream = createWriteStream(destPath);

          res.on("data", (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
              const percent = Math.floor((downloadedBytes / totalBytes) * 100);
              if (percent !== lastPercent && percent % 5 === 0) {
                lastPercent = percent;
                const dlMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
                const totMB = (totalBytes / (1024 * 1024)).toFixed(1);
                process.stderr.write(`\r  Downloading: ${dlMB}/${totMB} MB (${percent}%)`);
              }
            }
          });

          res.pipe(fileStream);
          fileStream.on("finish", () => {
            process.stderr.write("\n");
            resolve();
          });
          fileStream.on("error", reject);
        })
        .on("error", reject);
    };

    doRequest(url);
  });
}
