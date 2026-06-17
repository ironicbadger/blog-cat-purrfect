import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { imageSize } from 'image-size';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(root, 'src', 'content', 'posts');

const MIN_WIDTH = 120;
const MIN_HEIGHT = 180;
const MIN_PIXELS = 22_000;
const MIN_ASPECT = 0.42;
const MAX_ASPECT = 1.15;

function contentFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return contentFiles(fullPath);
    return /\.(md|mdx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function frontmatterFor(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? yaml.load(match[1]) ?? {} : {};
}

function validateCover(filePath, data) {
  if (!data.cover || data.format === 'Note') return [];

  const errors = [];
  const cover = String(data.cover);

  if (/^https?:\/\//.test(cover)) {
    return [`${filePath}: cover must be downloaded locally before build checks can validate it (${cover})`];
  }

  if (!cover.startsWith('/')) {
    return [`${filePath}: cover must be root-relative, for example /images/books/example.jpg (${cover})`];
  }

  const localCover = path.join(root, 'public', cover);

  let dimensions;
  try {
    dimensions = imageSize(readFileSync(localCover));
  } catch (error) {
    return [`${filePath}: cover cannot be read at ${cover} (${error.message})`];
  }

  const { width, height } = dimensions;
  const aspect = width / height;
  const pixels = width * height;
  const relativeFile = path.relative(root, filePath);

  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    errors.push(
      `${relativeFile}: ${cover} is ${width}x${height}; covers must be at least ${MIN_WIDTH}x${MIN_HEIGHT}`
    );
  }

  if (pixels < MIN_PIXELS) {
    errors.push(
      `${relativeFile}: ${cover} has ${pixels.toLocaleString('en')} pixels; covers must have at least ${MIN_PIXELS.toLocaleString('en')}`
    );
  }

  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) {
    errors.push(
      `${relativeFile}: ${cover} has aspect ratio ${aspect.toFixed(2)}; expected ${MIN_ASPECT}-${MAX_ASPECT}`
    );
  }

  return errors;
}

const errors = contentFiles(contentDir).flatMap((filePath) => validateCover(filePath, frontmatterFor(filePath)));

if (errors.length > 0) {
  console.error('\nCover validation failed:\n');
  for (const error of errors) console.error(`- ${error}`);
  console.error('\nReplace the cover image with a clean local book-cover crop, then rebuild.\n');
  process.exit(1);
}

console.log('Cover validation passed.');
