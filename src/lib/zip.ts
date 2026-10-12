import { createWriteStream, type WriteStream } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

/**
 * A small ZIP writer for the workspace export (NEXT_PHASES G17): entries are
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

/** The ZIP limit without ZIP64, with room for the directory. */
export const ZIP_MAX_BYTES = 0xffffffff - 64 * 1024 * 1024;

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

  constructor(path: string) {
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
    const header = Buffer.alloc(30);
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
      const header = Buffer.alloc(46);
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
    const end = Buffer.alloc(22);
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
