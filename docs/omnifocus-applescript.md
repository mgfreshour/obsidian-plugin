# OmniFocus AppleScript + Node.js Reference

Collected from hands-on testing against OmniFocus 4 on macOS, called via
`child_process.execFile('osascript', ...)` from Node.js/Electron.

## Execution Model

OmniFocus AppleScript is invoked through `osascript -e '<script>'`. From Node.js:

```typescript
import { execFile } from 'child_process';

execFile('osascript', ['-e', script, ...args], (error, stdout, stderr) => {
  // stdout contains the return value as text
  // stderr contains error messages
});
```

Arguments after the script are accessible in AppleScript via `on run argv`:

```applescript
on run argv
  set myArg to item 1 of argv
  -- use myArg...
end run
```

## Core Queries

### List All Projects

```applescript
tell application "OmniFocus"
  tell default document
    set projectNames to name of every flattened project
  end tell
  set AppleScript's text item delimiters to linefeed
  return projectNames as text
end tell
```

Use `flattened project`, not `project`. The flattened variant includes projects
inside folders.

### List All Tags

```applescript
tell application "OmniFocus"
  tell default document
    set tagNames to name of every flattened tag
  end tell
  set AppleScript's text item delimiters to linefeed
  return tagNames as text
end tell
```

Use `flattened tag` to include nested tags (e.g. "Contexts > @Work").

### Fetch Inbox Tasks

```applescript
tell application "OmniFocus"
  tell default document
    set taskNames to name of every inbox task whose completed is false
  end tell
  set AppleScript's text item delimiters to linefeed
  return taskNames as text
end tell
```

**Critical**: Always filter `whose completed is false`. Without it, `every inbox
task` returns all inbox tasks including completed ones. In testing, 308 of 336
inbox tasks were completed — omitting the filter returned 9x more tasks than
expected.

### Fetch Tasks from a Project

```applescript
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
```

Called with: `execFile('osascript', ['-e', script, projectName])`

### Fetch Tasks by Tag

```applescript
on run argv
  set tagName to item 1 of argv
  tell application "OmniFocus"
    tell default document
      set matchingTasks to every flattened task whose (name of every tag contains tagName) and completed is false
      set output to ""
      repeat with i from 1 to count of matchingTasks
        if i > 1 then set output to output & linefeed
        set output to output & (name of item i of matchingTasks)
      end repeat
    end tell
  end tell
  return output
end run
```

The filter `name of every tag contains tagName` matches tasks that have the tag
anywhere in their tag list (not just as the primary tag).

To match only the primary tag instead:

```applescript
every flattened task whose primary tag is not missing value and name of primary tag is tagName and completed is false
```

### Task Properties: id and note

Tasks have additional properties useful for linking and display:

- **`id`** — Persistent identifier (e.g. `oFUnKQPxvbn`). Use for deep links.
- **`note`** — Task notes; may be `missing value` for tasks without notes.

**OmniFocus URL scheme**: `omnifocus:///task/{id}` opens the task in OmniFocus
(e.g. `omnifocus:///task/oFUnKQPxvbn`).

To fetch name, id, and note together, build output in a loop (see Gotcha 1).
Use a delimiter that won't appear in names/notes — e.g. ASCII Unit Separator
(`character id 31`) between fields. For multi-line notes, replace linefeeds with
literal `\n` before output so each task stays on one line.

**Access requirement**: `id` and `note` must be read **inside** the `tell
application "OmniFocus"` / `tell default document` block. Reading them
outside causes "Access not allowed" (-1723).

### Create Inbox Task

```applescript
on run argv
  set taskName to item 1 of argv
  set taskNote to item 2 of argv
  tell application "OmniFocus"
    tell default document
      make new inbox task with properties {name: taskName, note: taskNote}
    end tell
  end tell
end run
```

Called with: `execFile('osascript', ['-e', script, taskName, taskNote])`

**Note**: Pass `name` and `note` via `argv` to avoid encoding issues with
non-ASCII characters (see Gotcha 3).

### Create Task in a Project

```applescript
on run argv
  set projectName to item 1 of argv
  set taskName to item 2 of argv
  set taskNote to item 3 of argv
  tell application "OmniFocus"
    tell default document
      set proj to first flattened project whose name is projectName
      make new task at end of tasks of proj with properties {name: taskName, note: taskNote}
    end tell
  end tell
end run
```

### Update Task

Get a task by `id` and set properties:

```applescript
on run argv
  set taskId to item 1 of argv
  set taskName to item 2 of argv
  set taskNote to item 3 of argv
  tell application "OmniFocus"
    tell default document
      set theTask to first flattened task whose id is taskId
      set name of theTask to taskName
      set note of theTask to taskNote
    end tell
  end tell
end run
```

**Note**: The `completed` property is read-only (since OmniFocus 2.12). Use
`mark complete` or `mark incomplete` commands instead of `set completed`. Other
settable properties include `due date`, `primary tag`, etc. Use `id` from a fetch
to target a specific task.

### Mark Task Complete

The `completed` property is read-only. Use the `mark complete` command:

```applescript
on run argv
  set taskId to item 1 of argv
  tell application "OmniFocus"
    tell default document
      set theTask to first flattened task whose id is taskId
      mark complete theTask
    end tell
  end tell
end run
```

Called with: `execFile('osascript', ['-e', script, taskId])`

### List Perspectives

```applescript
tell application "OmniFocus"
  set allPerspectives to every perspective of default document
  set output to ""
  repeat with p in allPerspectives
    try
      set pName to name of p
      if pName is not missing value then
        if output is not "" then set output to output & linefeed
        set output to output & pName
      end if
    end try
  end repeat
  return output
end tell
```

Built-in perspectives return `missing value` for their name — the `try` block
and `missing value` check are required to avoid errors.

### Fetch Tasks from a Perspective

**Not recommended for headless/plugin use.** Perspectives are saved filter views,
not data containers. Querying them requires manipulating the OmniFocus GUI:

```applescript
tell application "OmniFocus"
  tell front document window of default document
    set perspective name to "Next Action"
    delay 1
    set treeList to every leaf of content
    repeat with t in treeList
      set taskName to name of value of t
      -- ...
    end repeat
  end tell
end tell
```

Problems with this approach:
- Requires an open, visible OmniFocus window
- Visibly changes the active perspective (side effect)
- Returns duplicate entries
- `delay 1` is needed for the view to settle — fragile timing dependency
- `every tree of content` fails; must use `every leaf of content`
- `name of value of tree` fails; must navigate through `leaf` → `value` → `name`

## Gotchas

### 1. `text item delimiters` Fails Silently in `on run argv` via Node.js

When a script uses `on run argv` and is called through Node.js `execFile`, the
`text item delimiters` + `as text` pattern returns an empty string:

```applescript
-- THIS RETURNS EMPTY when called via execFile with on-run-argv:
on run argv
  tell application "OmniFocus"
    tell default document
      set taskNames to name of every flattened task of ...
    end tell
    set AppleScript's text item delimiters to linefeed
    return taskNames as text  -- returns ""
  end tell
end run
```

**Workaround**: Use a loop to build the output string:

```applescript
set output to ""
repeat with i from 1 to count of taskList
  if i > 1 then set output to output & linefeed
  set output to output & (name of item i of taskList)
end repeat
return output
```

Note: `text item delimiters` works fine in scripts that do NOT use `on run argv`
(e.g. the inbox query). It also works from the bash shell. The failure is
specific to the combination of `on run argv` + `execFile`.

An alternative that was tested working (but more verbose):

```applescript
-- Move delimiters OUTSIDE the tell application block:
on run argv
  tell application "OmniFocus"
    tell default document
      set taskNames to ...
    end tell
  end tell
  set tid to AppleScript's text item delimiters
  set AppleScript's text item delimiters to linefeed
  set output to taskNames as text
  set AppleScript's text item delimiters to tid
  return output
end run
```

This worked from bash but still returned empty via Node.js `execFile` in our
testing. The loop approach is the only reliable method.

### 2. `every task` vs `every flattened task`

`every task of proj` returns only direct child tasks. Tasks inside task groups
(sub-groups) are invisible. `every flattened task of proj` returns all tasks at
every nesting level.

A project can report 0 tasks with `every task` but 3 with `every flattened task`
if all tasks are inside a task group.

### 3. Emoji and Unicode in Names

Interpolating emoji/unicode directly into AppleScript string literals corrupts
the encoding when the script is passed via `osascript -e`:

```typescript
// BAD — emoji gets corrupted:
const script = `... whose name is "${projectName}" ...`;
execFile('osascript', ['-e', script], ...);

// GOOD — pass as argument:
const script = `on run argv\n  set name to item 1 of argv\n  ...`;
execFile('osascript', ['-e', script, projectName], ...);
```

Always use `on run argv` and pass names as CLI arguments when the name may
contain non-ASCII characters.

### 4. Variable Assignment Inside `tell` Blocks

Setting local variables inside `tell application` blocks can fail because
AppleScript interprets the assignment as a command to the application:

```applescript
-- FAILS: "Can't set c of default document to 3"
tell application "OmniFocus"
  tell default document
    set c to count of every task of proj
  end tell
end tell

-- WORKS: move assignment outside tell
tell application "OmniFocus"
  tell default document
    set taskList to every task of proj
  end tell
end tell
set c to count of taskList
```

### 5. `inbox task` Includes Completed and Assigned Tasks

`every inbox task` returns tasks that:
- Were once in the inbox, even if now assigned to a project
- Are completed
- Are dropped

In testing: 336 inbox tasks total, 308 completed, all 336 had a containing
project. Only 27 were genuinely active inbox items.

Filter patterns:
- `whose completed is false` — incomplete tasks (28 results in testing)
- `whose completed is false and effectively dropped is false` — available tasks
  (27 results — the tightest filter)

## Performance Notes

- `name of every flattened project` — fast (< 1s for 23 projects)
- `name of every flattened tag` — fast (< 1s for 24 tags)
- `name of every inbox task whose completed is false` — fast (< 1s for 28 tasks)
- `every flattened task whose (name of every tag contains X) and completed is false` — moderate (1-2s, scans all tasks)
- Perspective queries via GUI manipulation — slow (requires `delay 1` minimum)
- First call after OmniFocus launch may trigger a permission dialog and timeout
