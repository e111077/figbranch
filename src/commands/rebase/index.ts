import type { Argv, CommandModule } from "yargs";
import { loadState, saveState } from "../../branch-state/state.js";
import { type Command, execCommand, findChildren, getParentBranch } from "../../utils.js";
import inquirer from 'inquirer';

/**
 * Rebase command module for figbranch.
 * Handles rebasing the current branch onto a target branch after user confirmation.
 * Updates state to mark child branches as orphaned since they'll need to be rebased too.
 *
 * Usage: fb rebase <branch>
 * Example: fb rebase main
 */
export const rebase = {
  command: 'rebase <branch>',
  describe: 'Rebase the current branch-commit onto the given branch',
  builder: (yargs: Argv) =>
    yargs.positional('branch', {
      describe: 'The branch to rebase onto',
      type: 'string',
      demandOption: true
    }),
  handler: async (options) => {
    // Get current branch name
    const currentBranch = execCommand('git rev-parse --abbrev-ref HEAD');

    // Prompt for confirmation before rebasing
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Attempt rebase this single branch-commit onto ${options.branch}?`,
      default: false
    }]);

    // Exit if user cancels
    if (!confirm) {
      console.log('Rebase cancelled');
      process.exit(0);
    }

    console.log(`Rebasing onto ${options.branch}...`);
    try {
      // Find all child branches that will be affected by this rebase
      const children = findChildren(currentBranch);

      // Perform the actual rebase
      execCommand(`git rebase ${options.branch}`, true);

      // Mark all child branches as orphaned since they need to be rebased too
      const state = loadState();
      children.forEach(child => {
        const childState = state.branches[child.branchName];
        childState.orphaned = true;
      });
      const parent = state.branches[currentBranch]?.parent;
      if (parent) {
        state.branches[parent].children = state.branches[parent].children
            .filter(c => c !== currentBranch);
      }
      const target = state.branches[options.branch];
      if (target) {
        target.children.push(currentBranch);
      }
      saveState(state);
    } catch (error) {
      // Exit with error if rebase failed
      process.exit(1);
    }
  }
} satisfies CommandModule<{}, { branch: string }>;