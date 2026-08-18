// The agents' noticeboard. One note per file in docs/board/, because parallel agents writing one
// shared file would clobber each other, and this project has run sixteen agents at once.
// docs/board/README.md is the protocol. The rule it exists for: a finding that lives only in a
// transcript is treated as never made.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs', 'board');
const args = process.argv.slice(2);
const cmd = args[0] || 'list';
const flag = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

function notes() {
  return fs.readdirSync(DIR).filter((f) => /^\d{8}-.+\.md$/.test(f)).sort().reverse().map((f) => {
    const text = fs.readFileSync(path.join(DIR, f), 'utf8');
    const head = {};
    for (const line of text.split('\n').slice(0, 8)) {
      const m = /^(id|posted|from|status|needs):\s*(.+)$/.exec(line);
      if (m) head[m[1]] = m[2].trim();
    }
    return { file: f, text, ...head };
  });
}

if (cmd === 'list') {
  const all = args.includes('--all');
  const shown = notes().filter((n) => all || n.status === 'open' || n.status === 'for-owner');
  if (!shown.length) { console.log('The board is clear.'); process.exit(0); }
  for (const n of shown) {
    console.log(`[${(n.status || '?').toUpperCase().padEnd(9)}] ${n.id || n.file}`);
    console.log(`  from: ${n.from || '?'}   needs: ${n.needs || '?'}`);
  }
  console.log(`\n${shown.length} note(s). Read the file in docs/board/ before acting on one.`);
} else if (cmd === 'post') {
  const slug = flag('slug'), from = flag('from'), needs = flag('needs'), body = flag('body');
  if (!slug || !from || !needs || !body) {
    console.error('post needs --slug --from --needs --body'); process.exit(1);
  }
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10);
  const id = ymd.replace(/-/g, '') + '-' + slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const file = path.join(DIR, id + '.md');
  if (fs.existsSync(file)) { console.error('note exists: ' + id); process.exit(1); }
  fs.writeFileSync(file,
    `id: ${id}\nposted: ${ymd}\nfrom: ${from}\nstatus: open\nneeds: ${needs}\n\n${body}\n`);
  console.log('posted ' + id);
} else if (cmd === 'take' || cmd === 'resolve') {
  const id = args[1];
  const n = notes().find((x) => x.id === id || x.file === id + '.md');
  if (!n) { console.error('no such note: ' + id); process.exit(1); }
  if (n.status === 'for-owner' && cmd === 'resolve') {
    console.error('for-owner notes are resolved by the owner, not by an agent'); process.exit(1);
  }
  const who = flag('by'), note = flag('note');
  let text = n.text;
  if (cmd === 'take') {
    if (!who) { console.error('take needs --by'); process.exit(1); }
    text = text.replace(/^status: .+$/m, `status: taken\ntaken-by: ${who}`);
  } else {
    if (!note) { console.error('resolve needs --note'); process.exit(1); }
    text = text.replace(/^status: .+$/m, 'status: resolved')
      + `\nresolved: ${new Date().toISOString().slice(0, 10)}: ${note}\n`;
  }
  fs.writeFileSync(path.join(DIR, n.file), text);
  console.log(cmd + 'd ' + (n.id || n.file));
} else {
  console.error('commands: list [--all], post, take <id> --by, resolve <id> --note');
  process.exit(1);
}
