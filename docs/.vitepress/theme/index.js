import DefaultTheme from 'vitepress/theme';
import ArticleCatalog from './ArticleCatalog.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ArticleCatalog', ArticleCatalog);
  },
};
