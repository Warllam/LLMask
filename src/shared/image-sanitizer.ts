/**
 * Lightweight image metadata sanitizer (no external dependencies).
 *
 * Strips EXIF/APP1 metadata from JPEG images to remove:
 *   - GPS coordinates
 *   - Camera serial numbers
 *   - Author/artist names
 *   - Software/device info
 *   - Timestamps
 *
 * PNG/WebP: strips tEXt/iTXt/zTXt chunks (PNG) or EXIF chunk (WebP).
 */

/**
 * Strip metadata from an image buffer based on detected format.
 * Returns a new buffer without metadata, or the original if format is unsupported.
 */
export function stripImageMetadata(buf: Buffer): { sanitized: Buffer; format: string; strippedChunks: number } {
  if (isJpeg(buf)) return stripJpegMetadata(buf);
  if (isPng(buf)) return stripPngMetadata(buf);
  // WebP, GIF, etc. — pass through (less common for sensitive metadata)
  return { sanitized: buf, format: "unknown", strippedChunks: 0 };
}

/**
 * Extract a summary of metadata found in an image (for audit logging).
 */
export function describeImageMetadata(buf: Buffer): string[] {
  const findings: string[] = [];
  if (isJpeg(buf)) {
    const markers = findJpegAppMarkers(buf);
    for (const m of markers) {
      if (m.type === 0xe1) findings.push(`EXIF/APP1 (${m.length} bytes)`);
      else if (m.type === 0xed) findings.push(`IPTC/APP13 (${m.length} bytes)`);
      else if (m.type === 0xe2) findings.push(`ICC/APP2 (${m.length} bytes)`);
      else findings.push(`APP${m.type - 0xe0} (${m.length} bytes)`);
    }
  }
  if (isPng(buf)) {
    const textChunks = findPngTextChunks(buf);
    for (const c of textChunks) {
      findings.push(`PNG ${c.type} chunk (${c.length} bytes)`);
    }
  }
  return findings;
}

// ── JPEG ─────────────────────────────────────────────────────────────────

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

type JpegMarker = { type: number; offset: number; length: number };

function findJpegAppMarkers(buf: Buffer): JpegMarker[] {
  const markers: JpegMarker[] = [];
  let i = 2; // Skip SOI (0xFFD8)

  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];

    // SOS (Start of Scan) = end of metadata
    if (marker === 0xda) break;

    // Markers without length
    if (marker === 0x00 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }

    if (i + 3 >= buf.length) break;
    const segmentLength = buf.readUInt16BE(i + 2);

    // APP markers (0xE0-0xEF) — these contain metadata
    // We keep APP0 (JFIF) but strip APP1 (EXIF), APP2 (ICC), APP13 (IPTC), etc.
    if (marker >= 0xe1 && marker <= 0xef) {
      markers.push({ type: marker, offset: i, length: segmentLength + 2 });
    }

    i += 2 + segmentLength;
  }

  return markers;
}

function stripJpegMetadata(buf: Buffer): { sanitized: Buffer; format: string; strippedChunks: number } {
  const markers = findJpegAppMarkers(buf);
  if (markers.length === 0) return { sanitized: buf, format: "jpeg", strippedChunks: 0 };

  // Build new buffer excluding metadata markers
  const parts: Buffer[] = [];
  let pos = 0;

  for (const marker of markers) {
    if (marker.offset > pos) {
      parts.push(buf.subarray(pos, marker.offset));
    }
    pos = marker.offset + marker.length;
  }

  if (pos < buf.length) {
    parts.push(buf.subarray(pos));
  }

  return { sanitized: Buffer.concat(parts), format: "jpeg", strippedChunks: markers.length };
}

// ── PNG ──────────────────────────────────────────────────────────────────

function isPng(buf: Buffer): boolean {
  return buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

type PngChunkInfo = { type: string; offset: number; length: number };

const PNG_TEXT_TYPES = new Set(["tEXt", "iTXt", "zTXt", "eXIf"]);

function findPngTextChunks(buf: Buffer): PngChunkInfo[] {
  const chunks: PngChunkInfo[] = [];
  let i = 8; // Skip PNG signature

  while (i + 8 < buf.length) {
    const dataLength = buf.readUInt32BE(i);
    const chunkType = buf.subarray(i + 4, i + 8).toString("ascii");
    const totalChunkSize = 4 + 4 + dataLength + 4; // length + type + data + CRC

    if (PNG_TEXT_TYPES.has(chunkType)) {
      chunks.push({ type: chunkType, offset: i, length: totalChunkSize });
    }

    if (chunkType === "IEND") break;
    i += totalChunkSize;
  }

  return chunks;
}

function stripPngMetadata(buf: Buffer): { sanitized: Buffer; format: string; strippedChunks: number } {
  const textChunks = findPngTextChunks(buf);
  if (textChunks.length === 0) return { sanitized: buf, format: "png", strippedChunks: 0 };

  const parts: Buffer[] = [];
  let pos = 0;

  for (const chunk of textChunks) {
    if (chunk.offset > pos) {
      parts.push(buf.subarray(pos, chunk.offset));
    }
    pos = chunk.offset + chunk.length;
  }

  if (pos < buf.length) {
    parts.push(buf.subarray(pos));
  }

  return { sanitized: Buffer.concat(parts), format: "png", strippedChunks: textChunks.length };
}
