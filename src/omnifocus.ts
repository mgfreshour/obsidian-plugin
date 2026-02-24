/**
 * OmniFocus AppleScript integration.
 *
 * Uses `osascript` to communicate with OmniFocus 4 on macOS.
 * Requires OmniFocus 4 to be installed and running.
 */

import { execFile } from 'child_process';

const APPLESCRIPT = `
tell application "OmniFocus"
  tell default document
    set taskNames to name of every inbox task
  end tell
  set AppleScript's text item delimiters to linefeed
  return taskNames as text
end tell
`;

/**
 * Fetch the names of all inbox tasks from OmniFocus 4.
 *
 * @returns Array of task name strings (empty if the inbox is empty).
 * @throws If `osascript` fails (OmniFocus not installed, not running, etc.).
 */
export function fetchInboxTasks(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', APPLESCRIPT], (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to fetch OmniFocus inbox tasks: ${stderr || error.message}`,
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
