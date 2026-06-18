import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(root, 'src', 'content', 'posts');
const goodreadsUserId = process.env.GOODREADS_USER_ID ?? '177156744';
const perPage = 200;
const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

const manualMatches = new Map([
  ['src/content/posts/2025/2025-03-24-audiobook-the-house-on-the-cerulean-sea-tj-klune.md', '45047384'],
  ['src/content/posts/2025/2025-08-02-25-june-part-2-theme-pride-month.md', '218093188'],
  ['src/content/posts/2025/2025-09-07-additional-review-i-no-more-fish-in-the-sea.md', '224003301'],
  ['src/content/posts/2025/2025-10-22-25-october-theme-agatha-christie.md', '27170980'],
]);

function contentFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return contentFiles(fullPath);
    return /\.(md|mdx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function frontmatterBlock(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  return {
    full: match[0],
    body: match[1],
    start: match.index ?? 0,
    end: match[0].length,
    newline: match[0].includes('\r\n') ? '\r\n' : '\n',
  };
}

function frontmatterFor(source) {
  const block = frontmatterBlock(source);
  return block ? yaml.load(block.body) ?? {} : {};
}

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/#\d+/g, '')
    .replace(/\b(no|number)\.?\s*\d+\b/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[:;,.!?"'`\u2018\u2019\u201c\u201d/\\|_+*=<>~^$%@]+/g, ' ')
    .replace(/[-\u2013\u2014]+/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAuthor(value = '') {
  return normalize(value)
    .replace(/\b(author|goodreads)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dateOnly(rawDate) {
  if (!rawDate) return '';
  const date = new Date(rawDate);
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0, 10);
}

async function fetchShelfPage(page) {
  const url = new URL(`https://www.goodreads.com/review/list_rss/${goodreadsUserId}`);
  url.searchParams.set('shelf', 'read');
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', String(page));

  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; PurrfectProseGoodreadsSync/1.0)',
    },
  });

  if (!response.ok) {
    throw new Error(`Goodreads returned ${response.status} ${response.statusText} for ${url}`);
  }

  return response.text();
}

function parseShelfItems(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];

  $('item').each((_, element) => {
    const item = $(element);
    const title = item.children('title').first().text().trim();
    const author = item.children('author_name').first().text().trim();
    const readAt = dateOnly(item.children('user_read_at').first().text().trim());

    items.push({
      title,
      author,
      readAt,
      bookId: item.children('book_id').first().text().trim(),
      reviewUrl: item.children('link').first().text().trim(),
      titleKey: normalize(title),
      authorKey: normalizeAuthor(author),
    });
  });

  return items;
}

async function fetchReadShelf() {
  const items = [];

  for (let page = 1; ; page += 1) {
    const pageItems = parseShelfItems(await fetchShelfPage(page));
    items.push(...pageItems);
    if (pageItems.length < perPage) break;
  }

  return items;
}

function wordScore(localTitle, goodreadsTitle) {
  const localWords = new Set(localTitle.split(' ').filter((word) => word.length > 1));
  const goodreadsWords = new Set(goodreadsTitle.split(' ').filter((word) => word.length > 1));
  let common = 0;

  for (const word of localWords) {
    if (goodreadsWords.has(word)) common += 1;
  }

  return Math.round((common / Math.max(localWords.size, goodreadsWords.size, 1)) * 70);
}

function scoreMatch(post, item) {
  const localTitle = normalize(post.bookTitle);
  const goodreadsTitle = item.titleKey;
  const localAuthor = normalizeAuthor(post.bookAuthor);
  const goodreadsAuthor = item.authorKey;
  let score = 0;

  if (localTitle && localTitle === goodreadsTitle) score += 100;
  else if (localTitle && (localTitle.includes(goodreadsTitle) || goodreadsTitle.includes(localTitle))) score += 78;
  else score += wordScore(localTitle, goodreadsTitle);

  if (localAuthor && localAuthor === goodreadsAuthor) score += 30;
  else if (localAuthor && (localAuthor.includes(goodreadsAuthor) || goodreadsAuthor.includes(localAuthor))) score += 20;
  else if (localAuthor && goodreadsAuthor) {
    const localParts = new Set(localAuthor.split(' '));
    const goodreadsParts = new Set(goodreadsAuthor.split(' '));
    for (const part of localParts) {
      if (goodreadsParts.has(part)) score += 8;
    }
  }

  return score;
}

function findMatch(post, relativePath, shelfItems) {
  const manualBookId = manualMatches.get(relativePath);
  if (manualBookId) {
    const item = shelfItems.find((candidate) => candidate.bookId === manualBookId);
    if (item?.readAt) return { item, score: 999, manual: true };
  }

  const candidates = shelfItems
    .map((item) => ({ item, score: scoreMatch(post, item), manual: false }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const second = candidates[1];
  if (!best?.item.readAt) return undefined;
  if (best.score < 100) return undefined;
  if (second && best.score - second.score < 10 && best.score < 130) return undefined;

  return best;
}

function insertDateFinished(source, dateFinished) {
  const block = frontmatterBlock(source);
  if (!block) return source;

  if (/^dateFinished:/m.test(block.body)) {
    const body = block.body.replace(/^dateFinished:.*$/m, `dateFinished: ${dateFinished}`);
    return `${source.slice(0, block.start)}---${block.newline}${body}${block.newline}---${source.slice(block.end)}`;
  }

  const lines = block.body.split(/\r?\n/);
  let insertAt = lines.findIndex((line) => /^updatedDate:/.test(line));
  if (insertAt === -1) insertAt = lines.findIndex((line) => /^pubDate:/.test(line));
  if (insertAt === -1) insertAt = lines.findIndex((line) => /^author:/.test(line)) - 1;
  if (insertAt < 0) insertAt = lines.length - 1;

  lines.splice(insertAt + 1, 0, `dateFinished: ${dateFinished}`);
  return `${source.slice(0, block.start)}---${block.newline}${lines.join(block.newline)}${block.newline}---${source.slice(block.end)}`;
}

const shelfItems = await fetchReadShelf();
const shelfItemsWithReadDates = shelfItems.filter((item) => item.readAt).length;
const updates = [];
const skipped = [];

for (const filePath of contentFiles(contentDir).sort()) {
  const source = readFileSync(filePath, 'utf8');
  const post = frontmatterFor(source);
  const relativePath = path.relative(root, filePath).replace(/\\/g, '/');

  if (!post.bookTitle) continue;
  if (post.dateFinished && !force) continue;

  const match = findMatch(post, relativePath, shelfItems);
  if (!match) {
    skipped.push(relativePath);
    continue;
  }

  updates.push({
    filePath,
    relativePath,
    dateFinished: match.item.readAt,
    goodreadsTitle: match.item.title,
    goodreadsAuthor: match.item.author,
    manual: match.manual,
  });
}

if (!dryRun) {
  for (const update of updates) {
    const source = readFileSync(update.filePath, 'utf8');
    writeFileSync(update.filePath, insertDateFinished(source, update.dateFinished));
  }
}

const action = dryRun ? 'Would update' : 'Updated';
console.log(`Fetched ${shelfItems.length} Goodreads read-shelf items (${shelfItemsWithReadDates} with finished dates).`);
console.log(`${action} ${updates.length} post${updates.length === 1 ? '' : 's'}.`);

for (const update of updates) {
  const marker = update.manual ? 'manual match' : 'matched';
  console.log(`- ${update.relativePath}: ${update.dateFinished} (${marker}: ${update.goodreadsTitle} by ${update.goodreadsAuthor})`);
}

if (skipped.length > 0) {
  console.log(`Skipped ${skipped.length} post${skipped.length === 1 ? '' : 's'} without a confident Goodreads finished date.`);
  for (const relativePath of skipped) console.log(`- ${relativePath}`);
}
