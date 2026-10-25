import { Context } from 'file:///Users/jotsai/projects/pokemon-choose-you/dsh-plugin/node_modules/@deepseek-ai/cordis/lib/index.js';
const dshSsh = (await import('file:///Users/jotsai/projects/pokemon-choose-you/dsh-plugin/node_modules/@deepseek-ai/dsh-ssh/lib/index.js')).default;
const dshSub = (await import('file:///Users/jotsai/projects/pokemon-choose-you/dsh-plugin/node_modules/@deepseek-ai/dsh-subprocess-ssh/lib/index.js')).default;
const app = new Context();
const sshLabel = Symbol('pky-dep-min-ssh');
const subLabel = Symbol('pky-dep-min-sub');
const sshScope = app.isolate('ssh', sshLabel);
const subScope = sshScope.isolate('subprocess', subLabel);
console.log('loading dsh-ssh (awaiting fiber)...');
try {
  const fiber = sshScope.plugin(dshSsh, { host: 'pky-spike-a', node: '/Users/jotsai/.nvm/versions/node/v24.21.0/bin/node', helper: '/Users/jotsai/.dsh-helper/spike-runtime/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js', helperHash: '9d7c7403056a622a1def80f4b94864c9f456a5e7915760826622e793bcc5e896', workspace: '/tmp/pky-spike-ws-a' });
  await fiber;
  console.log('dsh-ssh fiber settled');
} catch (e) {
  console.log('dsh-ssh fiber ERROR:', String(e?.stack ?? e).slice(0, 600));
}
try {
  const f2 = subScope.plugin(dshSub, {});
  await f2;
  console.log('subprocess-ssh fiber settled');
} catch (e) {
  console.log('subprocess-ssh fiber ERROR:', String(e?.stack ?? e).slice(0, 600));
}
for (const name of ['ssh', 'subprocess']) {
  try { const v = subScope.get(name); console.log(name, '=>', typeof v, v?.constructor?.name); }
  catch (e) { console.log(name, 'ERR', String(e).slice(0, 200)); }
}
await new Promise(r => setTimeout(r, 3000));
for (const name of ['ssh', 'subprocess']) {
  try { const v = subScope.get(name); console.log('after-wait', name, '=>', typeof v, v?.constructor?.name); }
  catch (e) { console.log('after-wait', name, 'ERR', String(e).slice(0, 200)); }
}
process.exit(0);
