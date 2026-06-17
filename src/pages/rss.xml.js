import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE } from '@/lib/site';
import { excerptFor, isPublished, postUrl, sortPosts } from '@/lib/posts';

export async function GET(context) {
  const posts = sortPosts((await getCollection('posts')).filter(isPublished));

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: excerptFor(post),
      pubDate: post.data.pubDate,
      link: postUrl(post),
    })),
  });
}
