import { execSync, type StdioOptions } from 'child_process';
import type { ArgumentsCamelCase, BuilderCallback, CommandModule } from 'yargs';
import { loadState, saveState } from './branch-state/state.js';
import { join } from 'path';

export interface Command<T = any, U = {}> {
  command: string | string[];
  description: string;
  impl: (argv: ArgumentsCamelCase<T>) => void;
  builder?: CommandModule<U, T>['builder'] | BuilderCallback<U, T>;
}

export interface Branch {
  branchName: string;
  parent: Branch | null;
  children: Branch[];
  orphaned: boolean;
}

export type PRStatus = 'OPEN' | 'MERGED' | 'CLOSED' | 'DRAFT' | 'unknown';

/**
 * Type guard to check if an error is an ExecError
 */
interface ExecError extends Error {
  status: number;
}

/**
 * Executes a shell command and returns its output
 * @param command - The shell command to execute
 * @param throwOnError - Whether to throw an error if the command fails
 * @returns The command output as a string
 * @throws If throwOnError is true and the command fails with a non-zero exit code
 */
export function execCommand(command: string, throwOnError: boolean = false): string {
  try {
    const options: { encoding: 'utf8', stdio: StdioOptions } = {
      encoding: 'utf8',
      stdio: throwOnError ? ['inherit', 'inherit', 'pipe'] : 'pipe'
    };
    return execSync(command, options).toString().trim();
  } catch (error) {
    if (throwOnError && isExecError(error)) {
      throw error;
    }
    return '';
  }
}

function isExecError(error: unknown): error is ExecError {
  return error instanceof Error && 'status' in error;
}

/**
 * Retrieves the PR number for a given branch
 * @param branch - The name of the branch
 * @returns The PR number as a string, or empty string if no PR exists
 */
export function getPrNumber(branch: string): number | null {
  const prNum = execCommand(`gh pr list --head "${branch}" --state all --json number --jq '.[0].number'`);
  return prNum === '' ? null : Number(prNum);
}

/**
 * Retrieves the status of a given PR
 *
 * @param prNum The PR number to get the status of
 * @returns The status of the PR
 */
export function getPrStatus(prNum: number): PRStatus {
  return execCommand(`gh pr view ${prNum} --json state --jq '.state'`) as PRStatus;
}

function formatBranchContains(containsOutput: string, branchName: string) {
  return new Set(containsOutput.split('\n')
    .map((branch) => branch.replace('*', '').trim())
    .filter(branch => branch && branch !== branchName));
}

/**
 * Gets the parent branch information for a given branch
 * @param branchName - The name of the branch to find the parent for
 * @returns A Branch object representing the parent branch
 */
export function getParentBranch(branchName: string): Branch {
  const children = formatBranchContains(
    execCommand(`git branch --contains $(git rev-parse ${branchName})`),
    branchName
  );
  const possibleParents = formatBranchContains(
    execCommand(`git branch --contains $(git rev-parse ${branchName}^)`),
    branchName
  );

  children.forEach(child => {
    possibleParents.delete(child);
  });

  possibleParents.forEach(possibleParent => {
    const parentNotInBranch = execCommand(`git branch --no-contains $(git rev-parse ${possibleParent})`);
    if (parentNotInBranch.includes(branchName)) {
      possibleParents.delete(possibleParent);
    }
  });

  let parentBranchName = possibleParents.values().next().value;

  if (!parentBranchName || parentBranchName === 'HEAD') {
    // Check if 'main' branch exists
    const mainExists = execCommand('git rev-parse --verify main 2>/dev/null') !== '';
    parentBranchName = mainExists ? 'main' : 'master';
  }

  const state = loadState();
  const stateParent = state.branches[branchName]?.parent;

  if (
    parentBranchName !== 'main' &&
    parentBranchName !== 'master' &&
    state.branches[branchName]?.orphaned &&
    stateParent &&
    stateParent !== 'main' &&
    stateParent !== 'master'
  ) {
    return {
      branchName: stateParent,
      parent: null,
      children: [],
      orphaned: state.branches[stateParent]?.orphaned
    }
  }

  return {
    branchName: parentBranchName,
    parent: null,
    children: [],
    orphaned: false
  };
}

/**
 * Finds all child branches of a given parent branch
 * @param parentBranchName - The name of the parent branch
 * @returns An array of Branch objects representing the child branches
 */
export function findChildren(parentBranchName: string): Branch[] {
  const state = loadState();
  const stateChildren = state.branches[parentBranchName]?.children || [];
  stateChildren.forEach(child => {
    state.branches[child].orphaned = true;
  });
  const parentCommit = execCommand(`git rev-parse ${parentBranchName}`);
  const currentChildren = formatBranchContains(
    execCommand(`git branch --contains ${parentCommit}`),
    parentBranchName
  );

  currentChildren.forEach(child => {
    const acutalParent = getParentBranch(child).branchName;
    if (acutalParent !== parentBranchName) {
      currentChildren.delete(child);
      return;
    }

    if (state.branches[child]) {
      state.branches[child].orphaned = false;
      return;
    }

    state.branches[child] = {
      parent: parentBranchName,
      children: [],
      orphaned: false,
      lastKnownParentCommit: parentCommit
    };
  });

  const allChildren = Array.from(new Set([...stateChildren, ...currentChildren]));

  // Update parent's children in state
  state.branches[parentBranchName] = {
    ...state.branches[parentBranchName] || {},
    children: allChildren
  };

  saveState(state);
  const parent: Branch = {
    branchName: parentBranchName,
    parent: null,
    children: [],
    orphaned: state.branches[parentBranchName]?.orphaned || false
  }

  return allChildren.map(childBranch => {
    const prNumber = getPrNumber(childBranch);
    const child = {
      branchName: childBranch,
      prNumber,
      prStatus: prNumber === null ? 'unknown' : getPrStatus(prNumber),
      parent: parent,
      children: [],
      orphaned: state.branches[childBranch]?.orphaned || false,
    };

    parent.children.push(child);

    return child;
  });
}

/**
 * Gets the domain of the GitHub repository
 *
 * @returns The domain of the GitHub repository
 */
function getGithubUrl(): string {
  const remoteUrl = execCommand('git remote get-url origin')
    // remove .git from the end of the URL
    .replace(/.git$/, '');
  if (remoteUrl.startsWith('https://')) {
    // For HTTPS remotes: https://github.com/org/repo
    return remoteUrl;
  } else {
    // For SSH remotes: git@github.com:org/repo
    const [domain, orgAndRepo] = remoteUrl.split('@')[1].split(':');

    return `https://${domain}/${orgAndRepo}`;
  }
}

/**
 * Creates a markdown link to a PR
 * @param branch - The name of the branch
 * @param prNum - The PR number
 * @returns A markdown formatted link to the PR
 */
export function createPrLink(branch: string, prNum: number): string {
  return prNum ? `[#${prNum}](${getGithubUrl()}/pull/${prNum})` : branch;
}

const GIT_ROOT = execCommand('git rev-parse --git-dir');

/**
 * The path to the user's .git/env file
 */
export const USER_ENV_LOCATION = join(GIT_ROOT, 'figbranch-user-env');

/**
 * Determines the state of a branch and returns a string representing its state
 * as formatted annotations
 *
 * @param branch The branch from which to get annotations
 * @returns A string containing annotations for the branch
 */
export function getBranchListAnnotations(branch: Branch) {
  const prNumber = getPrNumber(branch.branchName);
  const prStatus = prNumber === null ? 'unknown' : getPrStatus(prNumber);
  const prStatusString = prStatus !== 'unknown' ? `${prStatus}` : '';
  const orphanedString = branch.orphaned ? 'orphaned?' : '';
  const joinedAnnotations = [prStatusString, orphanedString].filter(Boolean).join(' ').trim();
  return {
    prNumber,
    annotations: joinedAnnotations ? ` (${joinedAnnotations})` : '',
  }
};