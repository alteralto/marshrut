#!/usr/bin/env node
'use strict';
// node cli.js ingest <dir|file> [more...] [--out data/index.json] [--no-embed]
// node cli.js ask "вопрос" [--index data/index.json] [--mode auto|llm|extractive] [--json] [--debug]

const rag = require('./src');

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--') && !['json', 'debug', 'no-embed', 'flag'].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  if (cmd === 'ingest') {
    if (!pos.length) throw new Error('usage: node cli.js ingest <dir|file> [...] [--out file] [--no-embed]');
    const r = await rag.ingest(pos, { out: flags.out, embed: flags['no-embed'] ? false : undefined });
    console.log(`indexed ${r.docs} documents, ${r.chunks} chunks -> ${r.out}`);
    console.log(r.embeddings ? `embeddings: ${r.embeddings.model} (dim ${r.embeddings.dim})` : 'embeddings: none (BM25 only)');
    return;
  }
  if (cmd === 'ask') {
    const q = pos.join(' ');
    if (!q) throw new Error('usage: node cli.js ask "вопрос" [--mode extractive|llm] [--json]');
    const a = await rag.ask(q, {
      indexPath: flags.index,
      mode: flags.mode,
      debug: !!flags.debug,
      verifier: flags.flag ? 'flag' : 'drop',
    });
    console.log(flags.json || flags.debug ? JSON.stringify(a, null, 2) : rag.formatAnswer(a));
    return;
  }
  console.log('commands: ingest <dir> [--out file] [--no-embed] | ask "question" [--mode auto|llm|extractive] [--json] [--debug]');
  process.exitCode = cmd ? 1 : 0;
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
