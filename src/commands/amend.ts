import type { Argv, CommandModule } from "yargs";
import { execCommand } from '../utils.js';
import inquirer from 'inquirer';

interface AmendOptions {
  filename?: string;
}

/**
 * Amend changes to the previous commit
 *
 * @param {AmendOptions} options - The amend command options
 */
async function amendImpl({
  /**
   * The specific file to amend (optional)
   */
  filename
}: AmendOptions) {
  try {
    if (filename) {
      // Get status and find all matching files
      const status = execCommand('git status --porcelain');
      const files = status.split('\n')
        .map(line => {
          const match = line.match(/^..\s+(.+)$/);
          return match ? {
            status: line.substring(0, 2),
            path: match[1]
          } : null;
        })
        .filter((file): file is { status: string, path: string } => file !== null);

      // Find matches based on left-to-right path matching
      const matchingFiles = files.filter(file => {
        if (filename.endsWith('/')) {
          return file.path.startsWith(filename);
        }
        const inputParts = filename.split('/');
        const fileParts = file.path.split('/');

        return inputParts.every((part, i) => fileParts[i] === part);
      });

      if (matchingFiles.length === 0) {
        console.error(`No changes found for: ${filename}`);
        process.exit(1);
      }

      // If multiple matches and it's a directory query, confirm with user
      if (matchingFiles.length > 1) {
        console.log('Multiple files match:');
        matchingFiles.forEach(file => console.log(`  ${file.path}`));

        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: 'Amend all these files?',
          default: false
        }]);

        if (!confirm) {
          console.log('Aborting amend');
          process.exit(0);
        }
      }

      // Process all matching files
      matchingFiles.forEach(file => {
        if (file.status.startsWith(' D')) {
          execCommand(`git rm "${file.path}"`);
        } else {
          execCommand(`git add "${file.path}"`);
        }
      });

    } else {
      // Add all changes if no specific file
      execCommand('git add -A');
    }

    // Amend the commit without changing the message
    execCommand('git commit --amend --no-edit', true);
    console.log('Successfully amended changes to previous commit');
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error amending commit:', error.message);
    }
    process.exit(1);
  }
}

export const amend = {
  command: 'amend [filename]',
  describe: 'Amend changes to the previous commit',
  builder: (yargs: Argv) =>
    yargs
      .positional('filename', {
        describe: 'Specific file to amend (optional)',
        type: 'string',
        demandOption: false
      } as const),
  handler: async (argv) => {
    await amendImpl(argv as AmendOptions);
  }
} as const satisfies CommandModule<{}, AmendOptions>;