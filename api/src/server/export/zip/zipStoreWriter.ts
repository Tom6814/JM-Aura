import fs from "node:fs/promises";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";
import { crc32 } from "./crc32";

type ZipEntry = {
  name: string;
  nameBytes: Buffer;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  modTime: number; // DOS time
  modDate: number; // DOS date
};

/**
 * Minimal ZIP "store" writer.
 *
 * Writes:
 * - local file headers + data for each entry (no compression)
 * - central directory
 * - end of central directory record
 *
 * Limitations:
 * - no Zip64
 * - only supports addFile(name, bytes) with full buffer available
 * - no extra fields / comments
 */
export class ZipStoreWriter {
  static async open(zipPath: string): Promise<ZipStoreWriter> {
    await fs.mkdir(path.dirname(zipPath), { recursive: true });
    const handle = await fs.open(zipPath, "w");
    return new ZipStoreWriter(handle);
  }

  private offset = 0;
  private readonly entries: ZipEntry[] = [];
  private closed = false;

  private constructor(private readonly handle: FileHandle) {}

  async addFile(name: string, bytes: Uint8Array): Promise<void> {
    this.assertOpen();
    const nameBytes = Buffer.from(name, "utf8");
    if (nameBytes.length > 0xffff) {
      throw new Error(`zip entry name too long: ${nameBytes.length}`);
    }

    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const size = data.length;
    if (size > 0xffffffff) {
      throw new Error(`zip entry too large (no Zip64): ${size}`);
    }

    const { time, date } = dateToDos(new Date());
    const crc = crc32(data);

    const localHeaderOffset = this.offset;

    // Local file header (30 bytes fixed + name)
    const local = Buffer.allocUnsafe(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0, 6); // general purpose bit flag
    local.writeUInt16LE(0, 8); // compression method (store)
    local.writeUInt16LE(time, 10); // last mod file time
    local.writeUInt16LE(date, 12); // last mod file date
    local.writeUInt32LE(crc >>> 0, 14); // crc32
    local.writeUInt32LE(size >>> 0, 18); // compressed size
    local.writeUInt32LE(size >>> 0, 22); // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26); // file name length
    local.writeUInt16LE(0, 28); // extra field length

    await this.write(local);
    await this.write(nameBytes);
    await this.write(data);

    this.entries.push({
      name,
      nameBytes,
      crc32: crc,
      compressedSize: size,
      uncompressedSize: size,
      localHeaderOffset,
      modTime: time,
      modDate: date,
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const centralDirectoryOffset = this.offset;

    for (const e of this.entries) {
      const central = Buffer.allocUnsafe(46);
      central.writeUInt32LE(0x02014b50, 0); // central file header signature
      central.writeUInt16LE((3 << 8) | 20, 4); // version made by (3=unix, 20=2.0)
      central.writeUInt16LE(20, 6); // version needed to extract
      central.writeUInt16LE(0, 8); // general purpose bit flag
      central.writeUInt16LE(0, 10); // compression method
      central.writeUInt16LE(e.modTime, 12); // time
      central.writeUInt16LE(e.modDate, 14); // date
      central.writeUInt32LE(e.crc32 >>> 0, 16); // crc32
      central.writeUInt32LE(e.compressedSize >>> 0, 20); // compressed size
      central.writeUInt32LE(e.uncompressedSize >>> 0, 24); // uncompressed size
      central.writeUInt16LE(e.nameBytes.length, 28); // file name length
      central.writeUInt16LE(0, 30); // extra field length
      central.writeUInt16LE(0, 32); // file comment length
      central.writeUInt16LE(0, 34); // disk number start
      central.writeUInt16LE(0, 36); // internal file attributes
      central.writeUInt32LE(0, 38); // external file attributes
      central.writeUInt32LE(e.localHeaderOffset >>> 0, 42); // relative offset of local header

      await this.write(central);
      await this.write(e.nameBytes);
    }

    const centralDirectorySize = this.offset - centralDirectoryOffset;
    if (centralDirectoryOffset > 0xffffffff || centralDirectorySize > 0xffffffff) {
      throw new Error("zip too large for non-zip64 writer");
    }

    // End of central directory record (22 bytes, no comment)
    const end = Buffer.allocUnsafe(22);
    end.writeUInt32LE(0x06054b50, 0); // end of central dir signature
    end.writeUInt16LE(0, 4); // number of this disk
    end.writeUInt16LE(0, 6); // number of the disk with the start of the central directory
    end.writeUInt16LE(this.entries.length, 8); // total entries on this disk
    end.writeUInt16LE(this.entries.length, 10); // total entries
    end.writeUInt32LE(centralDirectorySize >>> 0, 12); // size of central directory
    end.writeUInt32LE(centralDirectoryOffset >>> 0, 16); // offset of start of central directory
    end.writeUInt16LE(0, 20); // .ZIP file comment length

    await this.write(end);
    await this.handle.close();
  }

  private async write(buf: Buffer): Promise<void> {
    // Use explicit position to avoid relying on the handle's internal cursor.
    const { bytesWritten } = await this.handle.write(buf, 0, buf.length, this.offset);
    if (bytesWritten !== buf.length) {
      throw new Error(`short write: expected=${buf.length} actual=${bytesWritten}`);
    }
    this.offset += buf.length;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("ZipStoreWriter is closed");
    }
  }
}

function dateToDos(d: Date): { time: number; date: number } {
  // ZIP stores local time. We don't care about exactness for exports; just keep it valid.
  let year = d.getFullYear();
  if (year < 1980) year = 1980;
  if (year > 2107) year = 2107;

  const month = d.getMonth() + 1; // 1-12
  const day = d.getDate(); // 1-31
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = d.getSeconds();

  const time = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | ((Math.floor(seconds / 2) & 0x1f) << 0);
  const date = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { time, date };
}

