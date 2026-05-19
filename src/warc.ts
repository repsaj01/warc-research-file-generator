/**
 * WARC record parsing utilities.
 * Provides a Transform stream that splits a decompressed WARC byte stream
 * into individual records, and helpers to extract header fields.
 */

import { Transform, TransformCallback } from "stream";
import { createHash } from "crypto";
import { WARC_HEADER_MARKER, CRLFCRLF } from "./types.js";

/**
 * Transform stream that reads decompressed WARC data and emits complete
 * WARC records as individual Buffer chunks. Detects record boundaries by
 * looking for the "WARC/1." signature preceded by a blank line (CRLFCRLF).
 */
export class WarcRecordAccumulator extends Transform {
  private buffer: Buffer = Buffer.alloc(0);

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.emitCompleteRecords();
    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.buffer.length > 0) {
      this.push(this.buffer);
    }
    callback();
  }

  private emitCompleteRecords(): void {
    let searchFrom = 0;

    while (true) {
      const nextStart = this.findWarcHeader(searchFrom + 1);
      if (nextStart === -1) break;

      const record = this.buffer.subarray(searchFrom, nextStart);
      if (record.length > 0) {
        this.push(record);
      }
      searchFrom = nextStart;
    }

    if (searchFrom > 0) {
      this.buffer = Buffer.from(this.buffer.subarray(searchFrom));
    }
  }

  private findWarcHeader(from: number): number {
    let pos = from;
    while (pos < this.buffer.length - WARC_HEADER_MARKER.length) {
      const idx = this.buffer.indexOf(WARC_HEADER_MARKER, pos);
      if (idx === -1) return -1;

      if (idx === 0 || (idx >= 4 && this.buffer.subarray(idx - 4, idx).equals(CRLFCRLF))) {
        return idx;
      }
      pos = idx + 1;
    }
    return -1;
  }
}

/**
 * Extract a specific header value from a WARC record's header block.
 */
function extractHeader(record: Buffer, headerName: string): string | null {
  const headerEnd = record.indexOf(CRLFCRLF);
  if (headerEnd === -1) return null;

  const header = record.subarray(0, headerEnd).toString("utf-8");
  const regex = new RegExp(`${headerName}:\\s*(.+)`, "i");
  const match = header.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extract the WARC-Target-URI from a record.
 */
export function extractTargetUri(record: Buffer): string | null {
  return extractHeader(record, "WARC-Target-URI");
}

/**
 * Extract the WARC-Type from a record (lowercased).
 */
export function extractWarcType(record: Buffer): string | null {
  const type = extractHeader(record, "WARC-Type");
  return type ? type.toLowerCase() : null;
}

/**
 * Derive a filesystem-safe name from a URI, falling back to a hash.
 */
export function sanitiseFilename(uri: string): string {
  try {
    const url = new URL(uri);
    return url.hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
  } catch {
    const hash = createHash("md5").update(uri).digest("hex").substring(0, 12);
    return `page-${hash}`;
  }
}
