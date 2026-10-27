import { readFileSync } from 'fs';
const css = readFileSync('public/styles.css', 'utf8');
const html = readFileSync('public/index.html', 'utf8');

const classes = ['span-2', 'text-right', 'text-center', 'mt-4', 'filter-actions'];
console.log('=== CSS class coverage ===');
classes.forEach(cls => {
  const inHtml = html.includes(cls);
  const inCss = css.includes('.' + cls);
  if (inHtml && !inCss) {
    console.log('MISSING in CSS, used in HTML: .' + cls);
  } else if (inHtml && inCss) {
    console.log('OK: .' + cls);
  } else {
    console.log('not used: .' + cls);
  }
});

// Check all classes used in HTML that might be missing from CSS
const htmlClasses = new Set();
const classRe = /class="([^"]*)"/g;
let m;
while ((m = classRe.exec(html)) !== null) {
  m[1].split(/\s+/).forEach(c => { if (c) htmlClasses.add(c); });
}
console.log('\n=== All HTML classes not found in CSS ===');
for (const cls of htmlClasses) {
  if (!css.includes('.' + cls) && !['active', 'hidden', 'selected', 'disabled'].includes(cls)) {
    console.log('  Missing: .' + cls);
  }
}

