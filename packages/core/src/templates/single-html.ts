import { loadTemplate } from './index';
import { OWNDESIGN_RUNTIME_SCRIPT_TAG } from './owndesign-runtime';

export function buildSingleHtmlTemplate({ title }: { title: string }) {
  return renderTemplate(loadTemplate('html/page-shell'), {
    lang: 'zh-CN',
    runtimeScript: OWNDESIGN_RUNTIME_SCRIPT_TAG,
    title: escapeHtmlText(title),
  });
}

function renderTemplate(template: string, values: Record<string, string>) {
  return `${template.replace(/\{\{([a-zA-Z0-9]+)\}\}/g, (_match, key: string) => values[key] ?? '')}\n`;
}

function escapeHtmlText(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
