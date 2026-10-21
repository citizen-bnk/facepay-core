import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApi } from './openapi.js';

export function docsAsset(name: 'index.html' | 'styles.css' | 'app.js' | 'runner.js' | 'logo.svg'): string {
  return readFileSync(join(process.cwd(), 'src', 'api', 'docs-assets', name), 'utf8');
}

export function docsHtml(): string {
  return docsAsset('index.html').replace('__OPENAPI__', JSON.stringify(buildOpenApi()).replace(/</g, '\\u003c'));
}
