import { getCollection } from 'astro:content';
import { excerptFor, isBrowsablePost, postUrl, sortPosts } from '@/lib/posts';

export async function GET() {
  const posts = sortPosts((await getCollection('posts')).filter(isBrowsablePost));

  return new Response(
    JSON.stringify(
      posts.map((post) => ({
        title: post.data.title,
        url: postUrl(post),
        date: post.data.pubDate.toISOString(),
        description: excerptFor(post),
        author: post.data.author,
        bookTitle: post.data.bookTitle,
        bookAuthor: post.data.bookAuthor,
        tags: post.data.tags,
        genres: post.data.genres,
        format: post.data.format,
        outcome: post.data.outcome,
      }))
    ),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    }
  );
}
