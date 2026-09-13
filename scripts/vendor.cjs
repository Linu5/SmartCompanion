const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules/@supabase/supabase-js');
const destination = path.join(root, 'public/vendor');
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(path.join(source, 'dist/umd/supabase.js'), path.join(destination, 'supabase.js'));
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(destination, 'supabase.LICENSE'));
console.log('Copied the pinned Supabase browser SDK and its license.');
