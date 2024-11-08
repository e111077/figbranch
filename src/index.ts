#!/usr/bin/env node

import yargs from 'yargs';
import { tables } from './commands/tables.js';
import { list } from './commands/list/index.js';
import { next } from './commands/next.js';
import { prev } from './commands/prev.js';
import { sync } from './commands/sync.js';
import { rebase } from './commands/rebase/index.js';
import { pull } from './commands/pull.js';
import { cache } from './commands/cache/index.js';
import { amend } from './commands/amend.js';
import { unamend } from './commands/unamend.js';
import { config as configCommand } from './commands/config/index.js';
import {config} from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import path from 'path'
import { USER_ENV_LOCATION } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: path.join(__dirname, '../.env.defaults') });
config({ path: USER_ENV_LOCATION });

const hideBin = (argv: string[]): string[] => argv.slice(2);

yargs(hideBin(process.argv))
  .command(tables.command, tables.description, {}, tables.impl)
  .command(list)
  .command(next.command, next.description, {}, next.impl)
  .command(prev.command, prev.description, {}, prev.impl)
  .command(amend)
  .command(unamend)
  .command(sync)
  .command(rebase)
  .command(pull.command, pull.description, {}, pull.impl)
  .command(cache)
  .command(configCommand)
  .completion('completion', 'Generate shell completion script')
  .demandCommand(1, 'You need to specify a command')
  .strict()
  .help()
  .alias('h', 'help')
  .version()
  .wrap(72)
  .argv;
