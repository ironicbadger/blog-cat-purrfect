import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacySourceDir = path.join(root, 'public', 'images', 'ghost');
const outputDir = path.join(root, 'public', 'images', 'covers');
const sourceDir = existsSync(legacySourceDir) ? legacySourceDir : outputDir;

const MAX_WIDTH = 720;
const MAX_HEIGHT = 1080;
const WEBP_QUALITY = 82;

const imagePattern = /\.(avif|gif|jpe?g|png|webp)$/i;

async function imageFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return imageFiles(fullPath);
      return imagePattern.test(entry.name) ? [fullPath] : [];
    })
  );

  return nested.flat().sort();
}

function publicPathFor(filePath, collisions) {
  const relative = path.relative(sourceDir, filePath);
  const parsed = path.parse(relative);
  const ext = parsed.ext.toLowerCase().replace(/^\./, '');
  const baseKey = path.join(parsed.dir, parsed.name);
  const suffix = collisions.get(baseKey) > 1 && ext !== 'webp' ? `-${ext}` : '';
  const filename = `${parsed.name}${suffix}.webp`;

  return `/images/covers/${path.posix.join(parsed.dir.split(path.sep).join(path.posix.sep), filename)}`;
}

function collisionCounts(files) {
  const counts = new Map();

  for (const file of files) {
    const relative = path.relative(sourceDir, file);
    const parsed = path.parse(relative);
    const key = path.join(parsed.dir, parsed.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

async function optimize(filePath, publicPath) {
  const destination = path.join(root, 'public', publicPath);
  await mkdir(path.dirname(destination), { recursive: true });

  const inputStats = await stat(filePath);
  const image = sharp(filePath, { animated: false }).rotate();
  const metadata = await image.metadata();
  const shouldResize =
    (metadata.width && metadata.width > MAX_WIDTH) || (metadata.height && metadata.height > MAX_HEIGHT);

  if (!shouldResize && path.resolve(filePath) === path.resolve(destination)) {
    return {
      input: filePath,
      output: destination,
      inputWidth: metadata.width,
      inputHeight: metadata.height,
      outputWidth: metadata.width,
      outputHeight: metadata.height,
      outputBytes: inputStats.size,
      skipped: true,
    };
  }

  let pipeline = image;
  if (shouldResize) {
    pipeline = pipeline.resize({
      width: MAX_WIDTH,
      height: MAX_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const writePath =
    path.resolve(filePath) === path.resolve(destination)
      ? `${destination}.tmp-${process.pid}.webp`
      : destination;

  const info = await pipeline
    .webp({
      effort: 6,
      quality: WEBP_QUALITY,
    })
    .toFile(writePath);

  if (writePath !== destination) {
    await rename(writePath, destination);
  }

  return {
    input: filePath,
    output: destination,
    inputWidth: metadata.width,
    inputHeight: metadata.height,
    outputWidth: info.width,
    outputHeight: info.height,
    outputBytes: info.size,
    skipped: false,
  };
}

if (!existsSync(sourceDir)) {
  console.log('No image directory found to optimize.');
  process.exit(0);
}

const files = await imageFiles(sourceDir);
const collisions = collisionCounts(files);
const results = [];

for (const file of files) {
  results.push(await optimize(file, publicPathFor(file, collisions)));
}

const totalBytes = results.reduce((sum, result) => sum + result.outputBytes, 0);
const resized = results.filter(
  (result) => result.inputWidth !== result.outputWidth || result.inputHeight !== result.outputHeight
);
const skipped = results.filter((result) => result.skipped);

console.log(
  `Optimized ${results.length} images to public/images/covers (${(totalBytes / 1024 / 1024).toFixed(2)} MB).`
);
console.log(`Resized ${resized.length} oversized images; smaller sources were left at native resolution.`);
if (skipped.length > 0) console.log(`Kept ${skipped.length} existing WebP images that were already within limits.`);
