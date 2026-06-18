import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = path.join(root, 'templates', 'review.md');
const postsRoot = path.join(root, 'src', 'content', 'posts');

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

function uniquePostPath(year, date, baseSlug) {
  const yearDir = path.join(postsRoot, year);
  let suffix = 0;

  while (true) {
    const slug = suffix === 0 ? baseSlug : `${baseSlug}-${suffix + 1}`;
    const filePath = path.join(yearDir, `${date}-${slug}.md`);
    if (!existsSync(filePath)) return { yearDir, slug, filePath };
    suffix += 1;
  }
}

async function promptForTitle() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const title = (await rl.question('Post title: ')).trim();
    if (!title) {
      console.error('Post title is required.');
      process.exit(1);
    }
    return title;
  } finally {
    rl.close();
  }
}

const title = await promptForTitle();
const baseSlug = slugify(title);

if (!baseSlug) {
  console.error('Post title must include at least one letter or number.');
  process.exit(1);
}

const template = splitFrontmatter(readFileSync(templatePath, 'utf8'));
const { year, date } = todayParts();
const { yearDir, slug, filePath } = uniquePostPath(year, date, baseSlug);

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
  cover: '',
  draft: true,
};

const output = `---\n${yaml.dump(frontmatter, { lineWidth: 1000 })}---\n\n${template.body}`;

mkdirSync(yearDir, { recursive: true });
writeFileSync(filePath, output, 'utf8');

console.log(`Created ${path.relative(root, filePath)}`);
