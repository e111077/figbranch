import { loadState, saveState } from "../branch-state/state.js";
import { execCommand, findChildren, type Command } from "../utils.js";

export const pull: Command = {
  command: 'pull',
  description: 'Pull updates and track orphaned branches',
  impl: async () => {
    const currentBranch = execCommand('git rev-parse --abbrev-ref HEAD');
    const state = loadState();

    // Store current state
    const currentCommit = execCommand(`git rev-parse ${currentBranch}`);

    // Upsert current branch state
    state.branches[currentBranch] = {
      ...state.branches[currentBranch] || {},
      parent: state.branches[currentBranch]?.parent || null,
      children: state.branches[currentBranch]?.children || []
    };

    // Find direct children before pull
    const directChildren = findChildren(currentBranch);
    state.branches[currentBranch].children = directChildren.map(c => c.branchName);

    // Store parent commit before pull
    state.branches[currentBranch].lastKnownParentCommit = currentCommit;

    // Perform pull
    console.log(`Pulling updates for ${currentBranch}...`);

    try {
      execCommand('git pull', true);
      state.branches[currentBranch].children.forEach(child => {
        state.branches[child].orphaned = true;
      });

      saveState(state);
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
  }
};