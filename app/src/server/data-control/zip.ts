import { createWriteStream, type WriteStream } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

/**
 * A small ZIP writer for the workspace export: entries are
 * added one at a time and written straight to disk, so only one file is in
 * memory at once. No ZIP64: the export stops adding media before 4 GB.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index++) crc = CRC_TABLE[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP32 unsigned field limit; ZIP64 requires a different writer, not a Root switch. */
export const ZIP32_MAX_BYTES = 0xffffffff;
const ZIP32_MAX_ENTRIES = 0xffff;
const LOCAL_HEADER_BYTES = 30;
const DIRECTORY_HEADER_BYTES = 46;
const END_HEADER_BYTES = 22;

interface Entry {
  name: Buffer;
  crc: number;
  method: number;
  compressed: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

function dosTime(at: Date) {
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((Math.max(at.getFullYear(), 1980) - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

export class ZipWriter {
  private readonly stream: WriteStream;
  private readonly entries: Entry[] = [];
  private offset = 0;
  private directoryBytes = 0;

  constructor(path: string, private readonly maxBytes = ZIP32_MAX_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < END_HEADER_BYTES || maxBytes > ZIP32_MAX_BYTES) throw new Error('Invalid ZIP32 byte limit.');
    this.stream = createWriteStream(path);
  }

  /** Bytes written so far. */
  get bytes(): number {
    return this.offset;
  }

  private write(chunk: Buffer): Promise<void> {
    this.offset += chunk.length;
    return new Promise((resolve, reject) => {
      this.stream.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
  }

  async add(name: string, content: string | Buffer, at = new Date()): Promise<void> {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const deflated = deflateRawSync(data);
    // Already-compressed files (photos, video) are stored as they are.
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const { time, date } = dosTime(at);
    const entry: Entry = {
      name: Buffer.from(name, 'utf8'),
      crc: crc32(data),
      method: stored ? 0 : 8,
      compressed: body.length,
      size: data.length,
      offset: this.offset,
      time,
      date,
    };
    const directoryBytes = this.directoryBytes + DIRECTORY_HEADER_BYTES + entry.name.length;
    if (entry.name.length > 0xffff || this.entries.length >= ZIP32_MAX_ENTRIES || data.length > ZIP32_MAX_BYTES || body.length > ZIP32_MAX_BYTES
      || this.offset + LOCAL_HEADER_BYTES + entry.name.length + body.length + directoryBytes + END_HEADER_BYTES > this.maxBytes) {
      throw new Error('Workspace archive exceeds the configured archive size limit.');
    }
    this.directoryBytes = directoryBytes;
    const header = Buffer.alloc(LOCAL_HEADER_BYTES);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names.
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.compressed, 18);
    header.writeUInt32LE(entry.size, 22);
    header.writeUInt16LE(entry.name.length, 26);
    header.writeUInt16LE(0, 28);
    await this.write(Buffer.concat([header, entry.name]));
    await this.write(body);
    this.entries.push(entry);
  }

  async close(): Promise<number> {
    const start = this.offset;
    for (const entry of this.entries) {
      const header = Buffer.alloc(DIRECTORY_HEADER_BYTES);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt16LE(entry.time, 12);
      header.writeUInt16LE(entry.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressed, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      header.writeUInt32LE(entry.offset, 42);
      await this.write(Buffer.concat([header, entry.name]));
    }
    const end = Buffer.alloc(END_HEADER_BYTES);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
    await new Promise<void>((resolve, reject) => this.stream.end((error?: Error | null) => (error ? reject(error) : resolve())));
    return this.offset;
  }

  /** Stop and leave the file for the caller to delete. */
  abort(): void {
    this.stream.destroy();
  }
}
