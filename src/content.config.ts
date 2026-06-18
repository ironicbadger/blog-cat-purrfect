import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    description: z.string().optional(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    dateFinished: z.coerce.date().optional(),
    author: z.string().default('Catherine K'),
    tags: z.array(z.string()).default([]),
    genres: z.array(z.string()).default([]),
    bookTitle: z.string().optional(),
    bookAuthor: z.string().optional(),
    publicationYear: z.preprocess(
      (value) => (value === '' || value === null ? undefined : value),
      z.coerce.number().int().optional()
    ),
    series: z.string().optional(),
    format: z.string().optional(),
    rating: z.union([z.number(), z.string()]).optional(),
    outcome: z.string().optional(),
    cover: z.string().optional(),
    legacyUrl: z.url().optional(),
    canonicalUrl: z.url().optional(),
    ghostId: z.string().optional(),
    challengeItems: z.array(z.object({
      month: z.string(),
      prompt: z.string(),
      selection: z.string().optional(),
      bookTitle: z.string().optional(),
      bookAuthor: z.string().optional(),
      reviewSlug: z.string().optional(),
      reviewSlugs: z.array(z.string()).optional(),
      done: z.boolean().default(false),
    })).optional(),
    draft: z.boolean().default(false),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    description: z.string().optional(),
    updatedDate: z.coerce.date().optional(),
    cover: z.string().optional(),
    legacyUrl: z.url().optional(),
    canonicalUrl: z.url().optional(),
    ghostId: z.string().optional(),
  }),
});

export const collections = { posts, pages };
