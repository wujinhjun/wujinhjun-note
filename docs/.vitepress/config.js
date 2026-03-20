import { defineConfig } from 'vitepress';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, '..');

/** 根据 docs 目录结构自动生成侧边栏 */
function extractPageMetadata(mdFilePath) {
  const raw = fs.readFileSync(mdFilePath, 'utf8');
  if (!raw.startsWith('---')) return null;

  // 只解析形如：
  // ---
  // metadata:
  //   title: "..."
  //   path: "/..."
  // ---
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];

  // 优先匹配 metadata 下的 title/path；如果没找到则回退到全局 title/path。
  const metadataBlock = fm.match(/metadata:\s*\n([\s\S]*?)(?:\n\S|\s*$)/m);
  const scope = metadataBlock?.[1] ?? fm;

  const titleMatch = scope.match(/^\s*title:\s*["']?(.+?)["']?\s*$/m);
  const pathMatch = scope.match(/^\s*path:\s*["']?(.+?)["']?\s*$/m);

  const title = titleMatch?.[1]?.trim();
  const pagePath = pathMatch?.[1]?.trim();

  if (!title && !pagePath) return null;
  return { title, path: pagePath };
}

function loadSidebarConfig(dirPath) {
  // 每个目录下放置一个目录级配置文件，例如：
  // docs/react/sidebar.config.json
  // {
  //   "index.md": { "metadata": { "title": "...", "path": "/react/" } },
  //   "0-preface.md": { "metadata": { "title": "...", "path": "/react/0-preface" } }
  // }
  const configPath = path.join(dirPath, 'sidebar.config.json');
  if (!fs.existsSync(configPath)) return null;

  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);

  // 支持两种格式：
  // 1) 直接以文件名为 key 的映射
  // 2) { items: [{ file, metadata }] }
  if (Array.isArray(parsed?.items)) {
    const map = {};
    for (const item of parsed.items) {
      if (!item?.file) continue;
      map[item.file] = item;
    }
    return map;
  }

  return parsed;
}

function getSidebar() {
  const sidebar = [];
  const dirs = fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        !d.name.startsWith('.') &&
        d.name !== 'public' &&
        d.name !== 'wip' &&
        d.name !== '_wip',
    );

  for (const dir of dirs) {
    const dirPath = path.join(docsDir, dir.name);
    const dirSidebarConfig = loadSidebarConfig(dirPath);
    const files = fs
      .readdirSync(dirPath)
      .filter((f) => {
        if (!f.endsWith('.md')) return false;
        // 支持在任意目录放“wip 文件”（例如：wip-xxx.md / _wip-xxx.md / .wip-xxx.md）
        if (f.startsWith('wip') || f.startsWith('_wip') || f.startsWith('.wip'))
          return false;
        return true;
      })
      .sort((a, b) => {
        if (a === 'index.md') return -1;
        if (b === 'index.md') return 1;
        return a.localeCompare(b, 'zh-CN');
      });

    const items = files.map((file) => {
      const base = file.replace(/\.md$/, '');
      const computedLink = `/${dir.name}/${base === 'index' ? '' : base}`;
      const computedText = base === 'index' ? '概览' : base;

      const mdFilePath = path.join(dirPath, file);
      const metaFromMd = extractPageMetadata(mdFilePath);
      const metaFromDir =
        dirSidebarConfig?.[file]?.metadata || dirSidebarConfig?.[file];

      const title = metaFromDir?.title || metaFromMd?.title || computedText;
      const link = metaFromDir?.path || metaFromMd?.path || computedLink;

      return {
        text: title,
        link,
      };
    });

    if (items.length > 0) {
      sidebar.push({
        text: dir.name.charAt(0).toUpperCase() + dir.name.slice(1),
        items,
      });
    }
  }

  return sidebar;
}

export default defineConfig({
  title: '技术笔记',
  description: '个人技术文章与学习笔记',
  base: '/wujinhjun-note/',
  // CI/CD 中如果有“链接但页面尚未补齐”的情况，不要直接导致构建失败
  ignoreDeadLinks: true,
  // 构建时忽略 WIP/灵感草稿：既不生成页面，也不进入站内搜索
  srcExclude: ['wip/**', '**/wip*.md', '**/_wip*.md', '**/.wip*.md'],
  themeConfig: {
    nav: [{ text: '首页', link: '/' }],
    sidebar: getSidebar(),
    socialLinks: [{ icon: 'github', link: 'https://github.com' }],
  },
});
