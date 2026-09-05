import { createContentLoader } from 'vitepress';

export default createContentLoader('**/*.md', {
  transform(pages) {
    return pages
      .filter((page) => page.frontmatter.status === 'published')
      .map((page) => ({
        url: page.url,
        title: page.frontmatter.title,
        order: page.frontmatter.order ?? Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.order - b.order || a.url.localeCompare(b.url, 'zh-CN'));
  },
});
