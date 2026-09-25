import crypto from "crypto";
import fs from "fs";
import zlib from "zlib";

/**
 * Content hashes for the data files staged for the importer, used to tell an unchanged
 * layer from a changed one across deploys.
 *
 * A zip's own bytes can't be compared: every export writes new timestamps into the zip
 * entries, and the DBF header carries the date it was written on (bytes 1-3), so the
 * same data hashes differently from one run (or day) to the next. `zipContentHash`
 * hashes what is *inside* the zip instead, ignoring those bytes.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * Minimal zip reader (central directory + inflate): enough to hash the entries of the
 * plain zips the geographic-info-reader writes, without adding a dependency.
 * @param {Buffer} buffer
 * @returns {Array<{name: String, data: Buffer}>}
 */
export function readZipEntries(buffer) {
  let eocd = -1;
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= lowest; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) {
    throw new Error("zip64 is not supported");
  }

  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error("corrupt zip central directory");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error("corrupt zip local header");
    }
    // The local header's own name/extra lengths locate the data
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries.push({ name, data: compressed });
    } else if (method === 8) {
      entries.push({ name, data: zlib.inflateRawSync(compressed) });
    } else {
      throw new Error(`unsupported zip compression method ${method}`);
    }
  }
  return entries;
}

/**
 * Hash of the contents of a zip. Falls back to the hash of the file's bytes when the
 * zip can't be read (a false "changed" only costs a reimport, never stale data).
 * @param {String} zipPath
 * @returns {String}
 */
export function zipContentHash(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  try {
    const hash = crypto.createHash("sha256");
    const entries = readZipEntries(buffer).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
    for (const { name, data } of entries) {
      let content = data;
      if (name.toLowerCase().endsWith(".dbf") && data.length > 3) {
        content = Buffer.from(data);
        content.fill(0, 1, 4); // last-update date (YY MM DD)
      }
      hash.update(`${name}\0${content.length}\0`);
      hash.update(content);
    }
    return `z1:${hash.digest("hex")}`;
  } catch {
    return `f1:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
  }
}

/**
 * Hash of a file's bytes (GeoTIFFs are copied as they are).
 * @param {String} filePath
 * @returns {String}
 */
export function fileHash(filePath) {
  return `f1:${crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")}`;
}
