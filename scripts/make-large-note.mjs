#!/usr/bin/env node
// Writes a markdown note of a chosen size, for trying Compose's large-file
// editor. The text is sections of headings, a list, a table, a code block and
// math, so a window of it shows every kind of block.
//
//   node scripts/make-large-note.mjs <size> <file> [--force]
//
//   node scripts/make-large-note.mjs 3MB "/tmp/Large Notes/Three megabytes.md"
//   node scripts/make-large-note.mjs 10GB "/tmp/Large Notes/Ten gigabytes.md"
//
// <size> is a number and KB, MB or GB (1024-based); the note is whole sections
// and ends at least that long. An existing file is not overwritten without
// --force, and nothing is written unless the disk has the size and 1 GB over.
import { createWriteStream } from "node:fs";
import { mkdir, rm, statfs, access } from "node:fs/promises";
import { dirname } from "node:path";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

const UNITS = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
const SPARE_DISK_BYTES = 1024 ** 3;
const SECTIONS_PER_WRITE = 2000;

/** `"200MB"` → bytes. Throws on anything that is not a number and a unit. */
export function parseSize(text) {
  const match = /^(\d+(?:\.\d+)?)\s*(KB|MB|GB)$/i.exec(text.trim());
  if (!match) throw new Error(`size "${text}" is not a number and KB, MB or GB, like 3MB`);
  return Math.round(Number(match[1]) * UNITS[match[2].toUpperCase()]);
}

/** Section `n` of the note: the same text for the same `n`. */
export function section(n) {
  return [
    `## Section ${n}`,
    "",
    `Paragraph ${n} with **bold**, *italic* and \`code\`, long enough to wrap on the page.`,
    "",
    `- first point of ${n}`,
    `- second point`,
    "",
    "| a | b |",
    "| - | - |",
    `| ${n} | x |`,
    "",
    "```ts",
    `const section = ${n};`,
    "```",
    "",
    `Inline math $x_{${n}} = \\frac{${n}}{2}$ here.`,
    "",
    "",
  ].join("\n");
}

const exists = (path) => access(path).then(() => true, () => false);

/** Writes the note at `path`. Returns the bytes and sections written. */
export async function makeLargeNote({ size, path, force = false }) {
  if (!force && (await exists(path))) throw new Error(`${path} exists; pass --force to replace it`);
  await mkdir(dirname(path), { recursive: true });
  const { bavail, bsize } = await statfs(dirname(path));
  if (bavail * bsize < size + SPARE_DISK_BYTES) {
    throw new Error(`not enough free disk for ${size} bytes: ${bavail * bsize} free, and 1 GB is kept spare`);
  }
  const out = createWriteStream(path);
  const failed = once(out, "error").then(([error]) => Promise.reject(error));
  failed.catch(() => {});
  let bytes = 0;
  let next = 0;
  const write = async (text) => {
    bytes += Buffer.byteLength(text);
    if (!out.write(text)) await Promise.race([once(out, "drain"), failed]);
  };
  try {
    await write("# Large note\n\nA generated note for trying large files.\n\n");
    while (bytes < size) {
      let batch = "";
      for (let at = 0; at < SECTIONS_PER_WRITE; at++) batch += section(next++);
      await write(batch);
    }
    out.end();
    await Promise.race([once(out, "finish"), failed]);
  } catch (error) {
    out.destroy();
    await rm(path, { force: true });
    throw error;
  }
  return { bytes, sections: next };
}

async function main(args) {
  const force = args.includes("--force");
  const [sizeText, path] = args.filter((arg) => arg !== "--force");
  if (!sizeText || !path) {
    console.error("usage: node scripts/make-large-note.mjs <size> <file> [--force]");
    process.exit(2);
  }
  const { bytes, sections } = await makeLargeNote({ size: parseSize(sizeText), path, force });
  console.log(`${path}: ${bytes} bytes, ${sections} sections`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
