const {resolve} = require('path');

const cmd = require('commander');
const convert = require('../convert');
const archives = require('../archives');
const pkg = require('../package.json');

cmd.version(pkg.version).
    option('--use-config', 'Use Config.').
    option('--custom-highlight', 'Enable custom highlight.').
    option('-s,  --source [path]', 'Source dir.').
    option('-d,  --dist [path]', 'dist dir.').
    usage(`--use-config true`).
    parse(process.argv);

if (!cmd.args.length || cmd.args.length > 4 || !(cmd.source || cmd.useConfig)) {
  cmd.help();
  process.exit(1);
}

if (cmd.useConfig) {

  const baseDir = resolve(__dirname, '..');
  const config = require('../config.json');

  config.jobs.forEach((job) => {
    if (job.source && job.dist) {
      const source = resolve(baseDir, job.source);
      const dist = resolve(baseDir, job.dist);
      const hl = Boolean(job.hl);

      convert(source, dist, hl);
      archives(source, dist);
    }
  });

} else {

  convert(cmd.source, cmd.dist, cmd.customHighlight);
  archives(cmd.source, cmd.dist);

}
