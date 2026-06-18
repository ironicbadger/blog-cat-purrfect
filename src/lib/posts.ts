import type { CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

export function isPublished(post: Post) {
  return !post.data.draft;
}

export function isListPost(post: Post) {
  return post.filePath?.replace(/\\/g, '/').includes('src/content/posts/lists/') ?? false;
}

export function isBrowsablePost(post: Post) {
  return isPublished(post) && !isListPost(post);
}

export function sortPosts(posts: Post[]) {
  return [...posts].sort(comparePosts);
}

export function comparePosts(a: Post, b: Post) {
  const dateDelta = b.data.pubDate.valueOf() - a.data.pubDate.valueOf();
  if (dateDelta !== 0) return dateDelta;

  const aElla = readingWithEllaNumber(a);
  const bElla = readingWithEllaNumber(b);
  if (aElla !== undefined && bElla !== undefined && aElla !== bElla) {
    return bElla - aElla;
  }

  return a.data.title.localeCompare(b.data.title);
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function slugifyTag(tag: string) {
  return tag
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function titleCaseSlug(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getAllTags(posts: Post[]) {
  const tags = new Map<string, { name: string; slug: string; count: number }>();

  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = slugifyTag(tag);
      const current = tags.get(slug);
      tags.set(slug, {
        name: current?.name ?? tag,
        slug,
        count: (current?.count ?? 0) + 1,
      });
    }
  }

  return [...tags.values()].sort((a, b) =>
    b.count === a.count ? a.name.localeCompare(b.name) : b.count - a.count
  );
}

export function uniqueValues(posts: Post[], getValues: (post: Post) => string[] | string | undefined) {
  const values = new Map<string, number>();

  for (const post of posts) {
    const raw = getValues(post);
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const item of items) {
      const key = item.trim();
      if (key) values.set(key, (values.get(key) ?? 0) + 1);
    }
  }

  return [...values.entries()]
    .sort((a, b) => (b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]))
    .map(([name, count]) => ({ name, count }));
}

export function getYearGroups(posts: Post[]) {
  const groups = new Map<number, Post[]>();

  for (const post of sortPosts(posts)) {
    const year = post.data.pubDate.getUTCFullYear();
    const current = groups.get(year) ?? [];
    current.push(post);
    groups.set(year, current);
  }

  return [...groups.entries()].sort(([a], [b]) => b - a);
}

export function isAnnualListPost(post: Post) {
  return isListPost(post) && (post.data.slug === 'the-list' || /^the-list-\d{4}$/.test(post.data.slug));
}

export function listYearFor(post: Post) {
  const slugOrTitleYear = `${post.data.slug} ${post.data.title}`.match(/\b(20\d{2})\b/);
  if (slugOrTitleYear) return Number(slugOrTitleYear[1]);

  const tagYear = post.data.tags.find((tag) => /^20\d{2}$/.test(tag));
  return tagYear ? Number(tagYear) : undefined;
}

export function getAnnualListGroups(posts: Post[]) {
  const groups = new Map<number, Post[]>();

  for (const post of posts.filter(isAnnualListPost)) {
    const year = listYearFor(post) ?? post.data.pubDate.getUTCFullYear();
    const current = groups.get(year) ?? [];
    current.push(post);
    groups.set(year, sortPosts(current));
  }

  return [...groups.entries()].sort(([a], [b]) => b - a);
}

export type ChallengeItem = NonNullable<Post['data']['challengeItems']>[number];

export type ChallengeReference = {
  list: Post;
  listYear: number;
  item: ChallengeItem;
  reviewSlugs: string[];
};

export function reviewSlugsForChallengeItem(item: ChallengeItem) {
  return [...new Set([item.reviewSlug, ...(item.reviewSlugs ?? [])].filter((slug): slug is string => Boolean(slug)))];
}

export function challengeReferencesFor(post: Post, posts: Post[]): ChallengeReference[] {
  return posts
    .filter((entry) => isAnnualListPost(entry) && entry.data.challengeItems?.length)
    .flatMap((list) => {
      const listYear = listYearFor(list) ?? list.data.pubDate.getUTCFullYear();
      return (list.data.challengeItems ?? [])
        .map((item) => ({
          list,
          listYear,
          item,
          reviewSlugs: reviewSlugsForChallengeItem(item),
        }))
        .filter((reference) => reference.reviewSlugs.includes(post.data.slug));
    })
    .sort((a, b) => b.listYear - a.listYear || a.item.month.localeCompare(b.item.month));
}

export function postUrl(post: Post) {
  return `/${post.data.slug}/`;
}

export function excerptFor(post: Post, max = 180) {
  const text = post.data.description?.replace(/\s+/g, ' ').trim() ?? '';
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}...`;
}

export const categoryDefinitions = [
  {
    id: 'reading-with-ella',
    label: 'Reading with Ella',
    description: 'Shared reads, chapter books, picture-book discoveries, and Ella verdicts.',
    href: '/?category=reading-with-ella',
  },
  {
    id: 'monthly-challenge',
    label: 'Monthly Challenge',
    description: 'Books read for Catherine’s monthly themed prompts and recurring challenges.',
    href: '/?category=monthly-challenge',
  },
  {
    id: 'audiobooks',
    label: 'Audiobooks',
    description: 'Listened reads, narrator notes, and reviews for the queue.',
    href: '/?category=audiobooks',
  },
] as const;

export type CategoryId = (typeof categoryDefinitions)[number]['id'];

export function readingWithEllaNumber(post: Post) {
  const match = post.data.title.match(/reading with ella\s*-\s*book\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

export function postCategories(post: Post): CategoryId[] {
  const categories = new Set<CategoryId>();
  const title = post.data.title.toLowerCase();
  const tags = post.data.tags.map(slugifyTag);

  if (readingWithEllaNumber(post) !== undefined || tags.includes('ella')) {
    categories.add('reading-with-ella');
  }

  if (post.data.format?.toLowerCase() === 'audiobook' || title.startsWith('audiobook')) {
    categories.add('audiobooks');
  }

  if (tags.includes('themes')) {
    categories.add('monthly-challenge');
  }

  return [...categories];
}

export function categoryCount(posts: Post[], categoryId: CategoryId) {
  return posts.filter((post) => postCategories(post).includes(categoryId)).length;
}
