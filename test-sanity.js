const fs = require('fs');
const vm = require('vm');

const javascriptFiles = [
  'server.js',
  'init-data.js',
  'test-system.js',
  'test-card-entry.js',
  'test-downloads.js',
  'test-upload.js',
  'test-tokens-live.js'
];

for (const file of javascriptFiles) {
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
  console.log(`PASS JavaScript syntax: ${file}`);
}

const htmlFiles = ['index.html', 'counter.html', 'admin.html', 'display.html', 'print-qr.html'];
const checkedTags = new Set(['html', 'head', 'body', 'nav', 'main', 'header', 'footer', 'section', 'form', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'script', 'style']);

for (const name of htmlFiles) {
  const file = `public/${name}`;
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
  scripts.forEach((source, index) => new vm.Script(source, { filename: `${file}:inline-${index + 1}` }));

  const structural = html
    .replace(/(<script(?:\s[^>]*)?>)[\s\S]*?(<\/script>)/gi, '<script></script>')
    .replace(/(<style(?:\s[^>]*)?>)[\s\S]*?(<\/style>)/gi, '<style></style>');
  const stack = [];
  for (const match of structural.matchAll(/<\/?([a-z][a-z0-9-]*)(?:\s[^<>]*?)?\s*\/?\s*>/gi)) {
    const raw = match[0];
    const tag = match[1].toLowerCase();
    if (!checkedTags.has(tag)) continue;
    if (!raw.startsWith('</')) stack.push(tag);
    else {
      const expected = stack.pop();
      if (expected !== tag) throw new Error(`${file}: expected </${expected}> before </${tag}>`);
    }
  }
  if (stack.length) throw new Error(`${file}: unclosed tags: ${stack.join(', ')}`);
  console.log(`PASS HTML and inline scripts: ${file}`);
}
