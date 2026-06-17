import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as cheerio from 'cheerio';
import yaml from 'js-yaml';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const SITE_URL = process.env.GHOST_SITE_URL ?? 'https://purrfectprose.com';
const CONTENT_KEY = process.env.GHOST_CONTENT_KEY ?? '067eb784583d7b71b8724c05a0';
const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, 'src/content/posts');
const PAGES_DIR = path.join(ROOT, 'src/content/pages');
const IMAGE_ROOT = path.join(ROOT, 'public/images/ghost');

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});

turndown.use(gfm);
turndown.keep(['u']);
turndown.addRule('ghostFigure', {
  filter: 'figure',
  replacement(content) {
    return `\n\n${content.trim()}\n\n`;
  },
});

const nonGenreTagSlugs = new Set([
  '2024',
  '2025',
  '2026',
  '2027',
  'audiobook',
  'bookbox',
  'keep',
  'list',
  'news',
  'premise',
  'themes',
]);

function apiUrl(resource, page = 1) {
  const url = new URL(`/ghost/api/content/${resource}/`, SITE_URL);
  url.searchParams.set('key', CONTENT_KEY);
  url.searchParams.set('limit', '100');
  url.searchParams.set('page', String(page));
  url.searchParams.set('include', 'tags,authors');
  url.searchParams.set('formats', 'html,plaintext');
  return url;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchAll(resource) {
  const items = [];
  let page = 1;
  let pages = 1;

  do {
    const payload = await fetchJson(apiUrl(resource, page));
    items.push(...(payload[resource] ?? []));
    pages = payload.meta?.pagination?.pages ?? page;
    page += 1;
  } while (page <= pages);

  return items;
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

function compactText(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function descriptionFor(item) {
  return compactText(item.custom_excerpt || item.excerpt || item.plaintext || '').slice(0, 320);
}

function dateOnly(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : undefined;
}

function dateTime(value) {
  return value ? new Date(value).toISOString() : undefined;
}

function tagNames(item) {
  return (item.tags ?? [])
    .filter((tag) => tag.visibility !== 'internal')
    .map((tag) => tag.name)
    .filter(Boolean);
}

function inferFormat(item, tags) {
  if (/^audiobook\s*-/i.test(item.title) || tags.some((tag) => slugify(tag) === 'audiobook')) {
    return 'Audiobook';
  }
  if (/^reading with ella/i.test(item.title) || tags.some((tag) => slugify(tag) === 'ella')) {
    return 'Read-aloud';
  }
  if (tags.some((tag) => slugify(tag) === 'graphic-novel')) {
    return 'Graphic novel';
  }
  if (tags.some((tag) => slugify(tag) === 'news')) {
    return 'Note';
  }
  return 'Book';
}

function inferOutcome(tags, text) {
  const outcomeTag = tags.find((tag) => /^[A-Z][A-Z\s-]{2,}$/.test(tag));
  if (outcomeTag) return outcomeTag.replace(/\s+/g, ' ').trim();

  const match = text.match(/staging outcome:\s*([a-z\s-]+)/i);
  if (match) return compactText(match[1]).toUpperCase();

  return undefined;
}

function inferRating(text) {
  const matches = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*\/\s*10\b/g)];
  if (!matches.length) return undefined;
  return Number(matches.at(-1)[1]);
}

function cleanBookTitle(value) {
  return value
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAudiobookTitle(title) {
  if (!/^audiobook\s*-/i.test(title)) return {};

  const cleaned = title.replace(/^audiobook\s*-\s*/i, '');
  const parts = cleaned.split(/\s+-\s+/).map(compactText).filter(Boolean);
  if (parts.length < 2) return { bookTitle: cleanBookTitle(cleaned) };

  let authorIndex = parts.length - 1;
  if (!/[a-z]/i.test(parts[authorIndex]) && parts.length > 2) {
    authorIndex -= 1;
  }

  return {
    bookTitle: cleanBookTitle(parts.slice(0, authorIndex).join(' - ')),
    bookAuthor: parts[authorIndex],
  };
}

function parseByline(value) {
  const text = compactText(value).replace(/^\W+|\W+$/g, '');
  if (text.split(/\s+/).length > 18) return {};

  const match = text.match(/^(.{2,}?)\s+by\s+([A-Z][A-Za-z .'\-&]+)$/);
  if (!match) return {};

  return {
    bookTitle: cleanBookTitle(match[1]),
    bookAuthor: compactText(match[2]),
  };
}

function inferBookMetadata(item, $, text) {
  const fromAudio = parseAudiobookTitle(item.title);
  if (fromAudio.bookTitle || fromAudio.bookAuthor) return fromAudio;

  const headingText = compactText($('h1,h2,h3,h4,p').first().text());
  const fromHeading = parseByline(headingText);
  if (fromHeading.bookTitle || fromHeading.bookAuthor) return fromHeading;

  const fromText = parseByline(text.split('\n').find((line) => /\sby\s/i.test(line)) ?? '');
  return fromText;
}

function inferSeries(bookTitle) {
  const match = bookTitle?.match(/\(([^)]*#\s*\d+[^)]*)\)/);
  return match ? compactText(match[1]) : undefined;
}

function genresFor(tags) {
  return tags.filter((tag) => {
    const slug = slugify(tag);
    return slug && !nonGenreTagSlugs.has(slug) && !/^\d{4}$/.test(slug);
  });
}

async function downloadImage(src) {
  if (!src) return undefined;

  const url = new URL(src, SITE_URL);
  if (!url.pathname.startsWith('/content/images/')) return src;

  const localPathFromContent = url.pathname.replace(/^\/content\/images\//, '');
  const destination = path.join(IMAGE_ROOT, localPathFromContent);
  const publicPath = `/images/ghost/${localPathFromContent}`;
  await mkdir(path.dirname(destination), { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`Skipped image ${url}: ${response.status}`);
    return src;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, buffer);
  return publicPath;
}

async function localizeImages(html, featureImage) {
  const $ = cheerio.load(html ?? '', { decodeEntities: false });
  const imageNodes = $('img').toArray();
  let firstImage;

  for (const node of imageNodes) {
    const image = $(node);
    const src = image.attr('src');
    const local = await downloadImage(src);
    if (local) {
      image.attr('src', local);
      firstImage ??= local;
    }
    image.removeAttr('srcset');
    image.removeAttr('sizes');
    image.removeAttr('class');
    image.removeAttr('loading');
    image.removeAttr('width');
    image.removeAttr('height');
  }

  const localFeature = featureImage ? await downloadImage(featureImage) : undefined;
  return {
    html: $('body').html() ?? $.root().html() ?? '',
    cover: localFeature ?? firstImage,
  };
}

function markdownFor(html) {
  return turndown
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function dumpMarkdown(frontmatter, markdown) {
  const cleaned = Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    })
  );

  return `---\n${yaml.dump(cleaned, {
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  })}---\n\n${markdown}\n`;
}

async function migratePost(item) {
  const localized = await localizeImages(item.html, item.feature_image);
  const $ = cheerio.load(localized.html, { decodeEntities: false });
  const text = compactText($.text());
  const tags = tagNames(item);
  const book = inferBookMetadata(item, $, text);
  const markdown = markdownFor(localized.html);
  const fileDate = dateOnly(item.published_at ?? item.created_at) ?? 'undated';
  const filePath = path.join(POSTS_DIR, `${fileDate}-${item.slug}.md`);

  await writeFile(
    filePath,
    dumpMarkdown(
      {
        title: item.title,
        slug: item.slug,
        description: descriptionFor(item),
        pubDate: dateTime(item.published_at ?? item.created_at),
        updatedDate: dateTime(item.updated_at),
        author: item.primary_author?.name ?? item.authors?.[0]?.name ?? 'Catherine K',
        tags,
        genres: genresFor(tags),
        bookTitle: book.bookTitle,
        bookAuthor: book.bookAuthor,
        series: inferSeries(book.bookTitle),
        format: inferFormat(item, tags),
        rating: inferRating(text),
        outcome: inferOutcome(tags, text),
        cover: localized.cover,
        legacyUrl: item.url,
        canonicalUrl: item.canonical_url,
        ghostId: item.id,
      },
      markdown
    )
  );

  return filePath;
}

async function migratePage(item) {
  const localized = await localizeImages(item.html, item.feature_image);
  const markdown = markdownFor(localized.html);
  const filePath = path.join(PAGES_DIR, `${item.slug}.md`);

  await writeFile(
    filePath,
    dumpMarkdown(
      {
        title: item.title,
        slug: item.slug,
        description: descriptionFor(item),
        updatedDate: dateTime(item.updated_at),
        cover: localized.cover,
        legacyUrl: item.url,
        canonicalUrl: item.canonical_url,
        ghostId: item.id,
      },
      markdown
    )
  );

  return filePath;
}

async function main() {
  await mkdir(POSTS_DIR, { recursive: true });
  await mkdir(PAGES_DIR, { recursive: true });
  await mkdir(IMAGE_ROOT, { recursive: true });

  const [posts, pages] = await Promise.all([
    fetchAll('posts'),
    fetchAll('pages'),
  ]);

  for (const post of posts) {
    await migratePost(post);
  }

  for (const page of pages) {
    await migratePage(page);
  }

  console.log(`Migrated ${posts.length} posts and ${pages.length} pages from ${SITE_URL}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
