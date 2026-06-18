import { loadTemplate } from './index';

export function buildSingleHtmlTemplate({ title }: { title: string }) {
  return renderTemplate(loadTemplate('html/page-shell'), {
    lang: 'zh-CN',
    title: escapeHtmlText(title),
  });
}

function renderTemplate(template: string, values: Record<string, string>) {
  return `${template.replace(/\{\{([a-zA-Z0-9]+)\}\}/g, (_match, key: string) => values[key] ?? '')}\n`;
}

function escapeHtmlText(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
