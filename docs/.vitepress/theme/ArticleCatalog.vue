<script setup>
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';
import { data as articles } from '../content.data.js';

const props = defineProps({
  directory: {
    type: String,
    default: '',
  },
});

const { page } = useData();

const entries = computed(() => {
  const currentDirectory = page.value.relativePath
    .split('/')
    .slice(0, -1)
    .join('/');
  const directory = (props.directory || currentDirectory).replace(
    /^\/+|\/+$/g,
    '',
  );
  const prefix = `/${directory}/`;

  return articles.filter((article) => {
    if (!article.url.startsWith(prefix) || article.url === prefix) return false;

    const relativePath = article.url.slice(prefix.length).replace(/\.html$/, '');
    return relativePath.length > 0 && !relativePath.includes('/');
  });
});
</script>

<template>
  <ul v-if="entries.length" class="article-catalog">
    <li v-for="article in entries" :key="article.url">
      <a :href="withBase(article.url)">{{ article.title }}</a>
    </li>
  </ul>
  <p v-else class="article-catalog-empty">暂无已发布文章。</p>
</template>
