# PurrfectProse static site

This is a static Astro replacement for the old Ghost site at `https://purrfectprose.com`.

## Daily writing flow

1. Copy `templates/review.md` into `src/content/posts/`.
2. Rename it to something like `2026-06-20-my-book-review.md`.
3. Fill in the front matter and write the review below it in Markdown.
4. Run `npm run dev` to preview locally.
5. Run `npm run build` before deploying.

The public URL comes from the `slug` field, not the filename. For example:

```yaml
slug: my-book-review
```

builds:

```text
/my-book-review/
```

## Useful commands

```bash
npm run dev
npm run build
npm run check
npm run migrate:ghost
```

`npm run migrate:ghost` is the one-time importer used to pull the old Ghost content via the public content API. It writes Markdown files into `src/content/posts` and downloads images into `public/images/ghost`.

## Deploying

Cloudflare Pages project: `cat-blog-purrfect`

Production URL: `https://cat-blog-purrfect.pages.dev/`

GitHub Actions builds and deploys the site from `.github/workflows/cloudflare-pages.yml`. Pull requests run `npm run check` and `npm run build`; pushes deploy the built `dist/` directory with Wrangler. Pushing `main` updates production, and pushing any other branch creates a Cloudflare Pages preview deployment.

Add these repository secrets before relying on the workflow:

- `CLOUDFLARE_ACCOUNT_ID`: `87f000053c6198ee887e7781685c58f1`
- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with `Account > Cloudflare Pages > Edit` permission for this account

Do not commit the API token to the repo.

## Front matter fields

Core fields:

```yaml
title: Review title
slug: review-title
description: Short summary used in listings and RSS.
pubDate: 2026-06-20
author: Catherine K
tags:
  - Mystery
  - Audiobook
genres:
  - Mystery
bookTitle: The Book Title
bookAuthor: Author Name
format: Book
rating: 8
outcome: KEEP
cover: /images/covers/example.jpg
```

Optional fields include `series`, `updatedDate`, `canonicalUrl`, `legacyUrl`, and `draft`.

Set `draft: true` to keep a post out of the built site.

## Editing with Obsidian

Obsidian can open this repo as a vault. The most useful folder to pin is:

```text
src/content/posts
```

Images can live in `public/images/covers` and be referenced as `/images/covers/filename.jpg`.

## Built-in pages

- `/` has search and filters for date, format, book author, reviewer, genre/subject, tag, and outcome.
- `/archive/` is the chronological list.
- `/tags/` lists every tag.
- `/tag/example/` contains tag-specific archives.
- `/rss.xml` and `sitemap-index.xml` are generated at build time.
