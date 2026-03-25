import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const docsDir = path.join(projectRoot, 'docs');
const distDir = path.join(docsDir, '.vitepress', 'dist');

// 站点完整 URL（包含 base path）
const WEBSITE_URL =
  process.env.WEBSITE_URL || 'https://wujinhjun.github.io/wujinhjun-note/';

function escapeXml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function cdataEscape(str) {
  // 防止 CDATA 结束符注入
  return String(str).replaceAll(']]>', ']]]]><![CDATA[>');
}

function parseFrontMatter(raw) {
  if (!raw.startsWith('---')) return null;
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];

  // 支持：
  // metadata:
  //   title: ...
  //   path: ...
  const metadataBlock = fm.match(/metadata:\s*\n([\s\S]*?)(?:\n\S|\s*$)/m);
  const scope = metadataBlock?.[1] ?? fm;

  const titleMatch = scope.match(/^\s*title:\s*["']?(.+?)["']?\s*$/m);
  const pathMatch = scope.match(/^\s*path:\s*["']?(.+?)["']?\s*$/m);

  return {
    title: titleMatch?.[1]?.trim(),
    pagePath: pathMatch?.[1]?.trim(),
  };
}

function guessTitleFromBody(raw) {
  const body = raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
  const lines = body.split(/\r?\n/);
  const heading = lines.find((l) => /^#\s+/.test(l) && !/^#{2,}\s+/.test(l));
  if (!heading) {
    // 兜底：找第一个非空行
    const first = lines.find((l) => l.trim().length > 0);
    return first ? first.trim().replaceAll(/^#+\s+/, '') : 'Untitled';
  }
  return heading.replace(/^#\s+/, '').trim();
}

function guessDescription(raw) {
  let body = raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
  body = body.replace(/^\s+/, '');

  const lines = body.split(/\r?\n/);
  let started = false;
  const buf = [];

  for (const line of lines) {
    const t = line.trim();
    if (!started) {
      if (t.length === 0) continue;
      if (/^#\s+/.test(t)) continue; // 跳过标题行
      started = true;
    }
    if (!started) continue;
    if (t.length === 0) break; // 一段段落的第一段就够
    // 简单清理 Markdown
    buf.push(t.replaceAll(/`([^`]+)`/g, '$1'));
    if (buf.join(' ').length >= 300) break;
  }

  const desc = buf.join(' ').trim();
  return desc.length > 0 ? desc : '';
}

function toInternalLinkFromDocsPath(filePath) {
  const rel = path.relative(docsDir, filePath).replaceAll(path.sep, '/');
  const relNoExt = rel.replace(/\.md$/i, '');

  if (relNoExt.endsWith('/index')) {
    const dir = relNoExt.slice(0, -'/index'.length);
    return `/${dir}/`;
  }

  return `/${relNoExt}`;
}

function toAbsoluteUrl(internalLink) {
  const site = WEBSITE_URL.endsWith('/') ? WEBSITE_URL : `${WEBSITE_URL}/`;
  const internal = internalLink.startsWith('/')
    ? internalLink.slice(1)
    : internalLink;
  return new URL(internal, site).toString();
}

function isWipFile(fileName) {
  return (
    fileName.startsWith('wip') ||
    fileName.startsWith('_wip') ||
    fileName.startsWith('.wip')
  );
}

function collectMarkdownFiles() {
  // 模仿你在 VitePress config 里生成 sidebar 的策略：只扫描 docs 目录下的一级目录
  const topDirs = fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        !d.name.startsWith('.') &&
        d.name !== 'public' &&
        d.name !== 'wip' &&
        d.name !== '_wip',
    );

  const files = [];
  for (const d of topDirs) {
    const dirPath = path.join(docsDir, d.name);
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!e.name.endsWith('.md')) continue;
      if (isWipFile(e.name)) continue;
      files.push({
        top: d.name,
        filePath: path.join(dirPath, e.name),
      });
    }
  }

  return files;
}

function buildChannelRss({ title, link, description, items }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escapeXml(title)}</title>
  <link>${escapeXml(link)}</link>
  <description>${escapeXml(description)}</description>
${items
  .map(
    (item) => `  <item>
    <title>${escapeXml(item.title)}</title>
    <link>${escapeXml(item.link)}</link>
    <guid isPermaLink="true">${escapeXml(item.link)}</guid>
    <pubDate>${item.pubDateRfc2822}</pubDate>
    ${
      item.description
        ? `<description><![CDATA[${cdataEscape(
            item.description,
          )}]]></description>`
        : ''
    }
  </item>`,
  )
  .join('\n')}
</channel>
</rss>
`;
}

function main() {
  if (!fs.existsSync(distDir)) {
    throw new Error(
      `RSS 生成失败：找不到 dist 目录：${distDir}。请先运行 VitePress build。`,
    );
  }

  const allMarkdownFiles = collectMarkdownFiles();

  const pages = allMarkdownFiles
    .filter((x) => path.basename(x.filePath) !== 'index.md')
    .map((x) => {
      const raw = fs.readFileSync(x.filePath, 'utf8');
      const fm = parseFrontMatter(raw);
      const title = fm?.title || guessTitleFromBody(raw);
      // 你的 VitePress 当前输出是 cleanUrls=false，页面实际文件名带 `.html`。
      const internalLinkNoExt =
        fm?.pagePath || toInternalLinkFromDocsPath(x.filePath);
      const internalLink = internalLinkNoExt.endsWith('.html')
        ? internalLinkNoExt
        : `${internalLinkNoExt}.html`;
      const link = toAbsoluteUrl(internalLink);
      const stat = fs.statSync(x.filePath);

      return {
        top: x.top,
        title,
        link,
        pubDate: stat.mtime,
        pubDateRfc2822: stat.mtime.toUTCString(),
        description: guessDescription(raw),
      };
    });

  // 全站 RSS：所有非 index 页面（排除 wip）
  const allItems = [...pages].sort((a, b) => b.pubDate - a.pubDate);

  // 随笔 RSS：仅 essays 目录
  const essaysItems = pages
    .filter((p) => p.top === 'essays')
    .sort((a, b) => b.pubDate - a.pubDate);

  const allFeedXml = buildChannelRss({
    title: '技术笔记 RSS',
    link: toAbsoluteUrl('/'),
    description: '方土居士的技术笔记：React/随笔等最新文章更新。',
    items: allItems,
  });

  const essaysFeedXml = buildChannelRss({
    title: '随笔 RSS',
    link: toAbsoluteUrl('/essays/'),
    description: '方土居士的随笔杂谈：最新随笔更新。',
    items: essaysItems,
  });

  fs.writeFileSync(path.join(distDir, 'rss.xml'), allFeedXml, 'utf8');
  const essaysDir = path.join(distDir, 'essays');
  fs.mkdirSync(essaysDir, { recursive: true });
  fs.writeFileSync(
    path.join(essaysDir, 'rss.xml'),
    essaysFeedXml,
    'utf8',
  );
}

main();

