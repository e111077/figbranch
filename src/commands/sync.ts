import type { CommandModule } from "yargs";
import { loadState } from "../branch-state/state.js";
import { execCommand, findChildren, getParentBranch } from "../utils.js";
import inquirer from 'inquirer';

/**
 * Rebases the current branch onto its parent branch after user confirmation
 */
async function impl(): Promise<void> {
  const currentBranch = execCommand('git rev-parse --abbrev-ref HEAD');
  const parent = getParentBranch(currentBranch);

  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: `attempt rebase on ${parent.branchName}?`,
    default: false
  }]);

  if (confirm) {
    console.log(`Rebasing onto ${parent.branchName}...`);
    try {
      execCommand(`git rebase --onto ${parent.branchName} $(git rev-parse ${currentBranch}^) ${currentBranch}`, true);
    } catch (error) {
      console.error((error as Error).message);
      // Only exit with error if the rebase actually failed
      process.exit(1);
    }
  } else {
    console.log('Rebase cancelled');
    process.exit(0);
  }
}

export const sync = {
  command: 'sync',
  describe: 'Rebase the current branch onto its parent branch',
  handler: impl
} satisfies CommandModule<{}, {}>;