/**
 * OmniFocus AppleScript integration.
 *
 * Uses `osascript` to communicate with OmniFocus 4 on macOS.
 * Requires OmniFocus 4 to be installed and running.
 */

import { execFile } from 'child_process';

/** Discriminated union describing where to fetch tasks from. */
export type TaskSource =
  | { kind: 'inbox' }
  | { kind: 'project'; name: string };

/**
 * Parse a code-block body into a {@link TaskSource}.
 *
 * Accepted formats:
 * - empty string or `inbox` → inbox
 * - `project: <name>` → named project
 *
 * @returns A `TaskSource`, or `null` if the input is empty.
 * @throws If the input doesn't match any known format.
 */
export function parseSource(input: string): TaskSource | null {
  const trimmed = input.trim();

  if (trimmed === '') {
    return null;
  }

  if (trimmed.toLowerCase() === 'inbox') {
    return { kind: 'inbox' };
  }

  const projectMatch = trimmed.match(/^project:\s*(.+)$/i);
  if (projectMatch) {
    const name = projectMatch[1].trim();
    if (name.length === 0) {
      throw new Error('Project name cannot be empty. Use: project: My Project');
    }
    return { kind: 'project', name };
  }

  throw new Error(
    `Unknown source: "${trimmed}". Valid formats:\n` +
    '  (empty) or inbox — fetch inbox tasks\n' +
    '  project: <name>  — fetch tasks from a project',
  );
}

/**
 * Fetch all project names from OmniFocus.
 *
 * @returns Array of project name strings.
 * @throws If `osascript` fails.
 */
export function fetchProjectNames(): Promise<string[]> {
  const script = `
tell application "OmniFocus"
  tell default document
    set projectNames to name of every flattened project
  end tell
  set AppleScript's text item delimiters to linefeed
  return projectNames as text
end tell
`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to fetch OmniFocus project names: ${stderr || error.message}`,
          ),
        );
        return;
      }

      const trimmed = stdout.trim();
      if (trimmed.length === 0) {
        resolve([]);
        return;
      }

      resolve(trimmed.split('\n'));
    });
  });
}

/**
 * Resolve a user-provided project query to an exact OmniFocus project name.
 *
 * Matching rules (case-insensitive):
 * 1. Exact match → use it
 * 2. Single substring match → use it
 * 3. Multiple substring matches → throw listing the ambiguous matches
 * 4. No matches → throw listing all available projects
 *
 * @param query The user-provided project name query.
 * @param projects The list of all OmniFocus project names.
 * @returns The resolved project name.
 * @throws If the query is ambiguous or has no matches.
 */
export function resolveProject(query: string, projects: string[]): string {
  const lowerQuery = query.toLowerCase();

  // 1. Exact match (case-insensitive)
  const exact = projects.find((p) => p.toLowerCase() === lowerQuery);
  if (exact) {
    return exact;
  }

  // 2–3. Substring match (case-insensitive)
  const matches = projects.filter((p) =>
    p.toLowerCase().includes(lowerQuery),
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    const list = matches.map((m) => `  - ${m}`).join('\n');
    throw new Error(
      `Ambiguous project "${query}". Multiple projects match:\n${list}`,
    );
  }

  // 4. No matches
  const list = projects.map((p) => `  - ${p}`).join('\n');
  throw new Error(
    `No project matching "${query}". Available projects:\n${list}`,
  );
}

interface ScriptCommand {
  script: string;
  args: string[];
}

/** Build the AppleScript and osascript arguments for a given task source. */
function buildScript(source: TaskSource): ScriptCommand {
  switch (source.kind) {
    case 'inbox':
      return {
        script: `
tell application "OmniFocus"
  tell default document
    set taskNames to name of every inbox task whose completed is false
  end tell
  set AppleScript's text item delimiters to linefeed
  return taskNames as text
end tell
`,
        args: [],
      };
    case 'project':
      return {
        script: `
on run argv
  set projectName to item 1 of argv
  tell application "OmniFocus"
    tell default document
      set proj to first flattened project whose name is projectName
      set taskList to every flattened task of proj
      set output to ""
      repeat with i from 1 to count of taskList
        if i > 1 then set output to output & linefeed
        set output to output & (name of item i of taskList)
      end repeat
    end tell
  end tell
  return output
end run
`,
        args: [source.name],
      };
  }
}

/** Human-readable label for a task source. */
export function sourceLabel(source: TaskSource): string {
  switch (source.kind) {
    case 'inbox':
      return 'inbox';
    case 'project':
      return `project "${source.name}"`;
  }
}

/**
 * Fetch task names from OmniFocus 4 for the given source.
 *
 * @returns Array of task name strings (empty if there are no tasks).
 * @throws If `osascript` fails (OmniFocus not installed, not running, etc.).
 */
export async function fetchTasks(source: TaskSource): Promise<string[]> {
  if (source.kind === 'project') {
    const projects = await fetchProjectNames();
    const resolved = resolveProject(source.name, projects);
    source = { kind: 'project', name: resolved };
  }

  const { script, args } = buildScript(source);
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, ...args], (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to fetch OmniFocus ${sourceLabel(source)} tasks: ${stderr || error.message}`,
          ),
        );
        return;
      }

      const trimmed = stdout.trim();
      if (trimmed.length === 0) {
        resolve([]);
        return;
      }

      resolve(trimmed.split('\n'));
    });
  });
}
