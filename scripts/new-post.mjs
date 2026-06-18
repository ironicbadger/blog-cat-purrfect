import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = path.join(root, 'templates', 'review.md');
const postsRoot = path.join(root, 'src', 'content', 'posts');
const coversRoot = path.join(root, 'public', 'images', 'covers');

const MAX_COVER_WIDTH = 720;
const MAX_COVER_HEIGHT = 1080;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const WEBP_QUALITY = 82;

function todayParts() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return { year, month, day, date: `${year}-${month}-${day}` };
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function splitFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Template is missing frontmatter: ${path.relative(root, templatePath)}`);
  }

  return {
    data: yaml.load(match[1]) ?? {},
    body: match[2],
  };
}

function contentFiles(dir) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return contentFiles(fullPath);
    return /\.(md|mdx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function existingSlugs() {
  const slugs = new Set();

  for (const file of contentFiles(postsRoot)) {
    const source = readFileSync(file, 'utf8');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) continue;

    const data = yaml.load(match[1]) ?? {};
    if (typeof data.slug === 'string' && data.slug.trim()) {
      slugs.add(data.slug.trim());
    }
  }

  return slugs;
}

function uniquePostPath(year, date, baseSlug) {
  const yearDir = path.join(postsRoot, year);
  const slugs = existingSlugs();
  let suffix = 0;

  while (true) {
    const slug = suffix === 0 ? baseSlug : `${baseSlug}-${suffix + 1}`;
    const filePath = path.join(yearDir, `${date}-${slug}.md`);
    if (!existsSync(filePath) && !slugs.has(slug)) return { yearDir, slug, filePath };
    suffix += 1;
  }
}

async function promptForPostDetails() {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
    }

    const [titleLine = '', coverLine = ''] = input.split(/\r?\n/);
    const title = titleLine.trim();
    if (!title) {
      throw new Error('Post title is required.');
    }

    return { title, coverUrl: coverLine.trim() };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const title = (await rl.question('Post title: ')).trim();
    if (!title) {
      throw new Error('Post title is required.');
    }

    const coverUrl = (await rl.question('Cover image URL (optional): ')).trim();
    return { title, coverUrl };
  } finally {
    rl.close();
  }
}

function uniqueCoverPath(year, month, slug) {
  const coverDir = path.join(coversRoot, year, month);
  let suffix = 0;

  while (true) {
    const filename = suffix === 0 ? `${slug}.webp` : `${slug}-${suffix + 1}.webp`;
    const filePath = path.join(coverDir, filename);
    const publicPath = `/images/covers/${year}/${month}/${filename}`;
    if (!existsSync(filePath)) return { coverDir, filePath, publicPath };
    suffix += 1;
  }
}

function imageUrlFor(rawUrl) {
  if (!rawUrl) return undefined;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Cover image URL must be a full public URL, like https://example.com/cover.jpg');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Cover image URL must start with http:// or https://');
  }

  return url;
}

async function downloadCover(rawUrl, year, month, slug) {
  const url = imageUrlFor(rawUrl);
  if (!url) return '';

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'cat-blog-purrfect-authoring/1.0',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Cover image download failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new Error('Cover image is too large. Try an image under 25 MB.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Cover image is too large. Try an image under 25 MB.');
  }

  const { coverDir, filePath, publicPath } = uniqueCoverPath(year, month, slug);
  mkdirSync(coverDir, { recursive: true });

  await sharp(buffer, { animated: false })
    .rotate()
    .resize({
      width: MAX_COVER_WIDTH,
      height: MAX_COVER_HEIGHT,
      fit: 'inside',
    })
    .webp({
      effort: 6,
      quality: WEBP_QUALITY,
    })
    .toFile(filePath);

  console.log(`Saved cover ${path.relative(root, filePath)}`);
  return publicPath;
}

async function main() {
  const { title, coverUrl } = await promptForPostDetails();
  const baseSlug = slugify(title);

  if (!baseSlug) {
    throw new Error('Post title must include at least one letter or number.');
  }

  const template = splitFrontmatter(readFileSync(templatePath, 'utf8'));
  const { year, month, date } = todayParts();
  const { yearDir, slug, filePath } = uniquePostPath(year, date, baseSlug);
  const cover = await downloadCover(coverUrl, year, month, slug);

  const frontmatter = {
    title,
    slug,
    description: template.data.description ?? 'One or two sentences for the listing page.',
    pubDate: date,
    updatedDate: date,
    author: template.data.author ?? 'Catherine K',
    tags: Array.isArray(template.data.tags) ? template.data.tags : [],
    genres: Array.isArray(template.data.genres) ? template.data.genres : [],
    bookTitle: template.data.bookTitle ?? '',
    bookAuthor: template.data.bookAuthor ?? '',
    publicationYear: '',
    series: '',
    format: template.data.format ?? 'Book',
    rating: '',
    outcome: '',
    cover,
    draft: true,
  };

  const output = `---\n${yaml.dump(frontmatter, { lineWidth: 1000 })}---\n\n${template.body}`;

  mkdirSync(yearDir, { recursive: true });
  writeFileSync(filePath, output, 'utf8');

  console.log(`Created ${path.relative(root, filePath)}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
