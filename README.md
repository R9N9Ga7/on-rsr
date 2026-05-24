# Simple SRS Review

Simple SRS Review is an Obsidian plugin for reviewing notes with a lightweight spaced-repetition workflow.

It looks for notes that contain the `#review` tag, adds due notes to a review queue, and lets you reschedule them with one click.

## What the plugin does

- Finds markdown notes that contain `#review`
- Resolves each review note into a deck
- Creates a queue of notes that are due today or overdue
- Shows that queue in a dedicated review view
- Adds quick actions for `Good` and `Repeat tomorrow`
- Saves scheduling data directly inside each note

## Installation

### Manual installation

1. Open your Obsidian vault folder.
2. Go to `.obsidian/plugins/`.
3. Create a folder named `simple-srs-review`.
4. Copy these files into that folder:
   - `manifest.json`
   - `main.js`
   - `styles.css`
5. Restart Obsidian or reload community plugins.
6. Enable `Simple SRS Review` in `Settings -> Community plugins`.

## How to mark a note for review

Add the `#review` tag anywhere in a note.

Example:

```md
# Newton's Laws

#review

Force equals mass times acceleration.
```

You can also keep `review` in frontmatter tags if you prefer:

```yaml
---
tags:
  - review
---
```

## How to assign a deck

Every review note belongs to a deck.

- If a note has no deck marker, it is placed in the `default` deck
- You can assign a deck with an inline tag like `#deck/math`
- You can assign a deck with frontmatter like `deck: math`
- The plugin also reads `srs.deck` if you already store deck data there

Example with an inline deck tag:

```md
# Newton's Laws

#review
#deck/physics

Force equals mass times acceleration.
```

Example with frontmatter:

```yaml
---
tags:
  - review
deck: physics
---
```

## How to open the review queue

You can open the review queue in three ways:

- Click the `brain` icon in the left sidebar
- Run the `Open review queue` command from the command palette
- Use the queue view again after it has already been opened

The plugin tries to open the queue in a separate window when possible. If Obsidian does not allow that in your setup, it falls back to a normal side pane.

## How reviewing works

Only notes with `#review` are considered.

When the plugin sees a review note:

- If the note has no SRS data yet, it is treated as due today
- If the note has no deck marker, it is treated as part of the `default` deck
- If the note has a `due` date that is today or earlier, it appears in the queue
- If the note is scheduled for a future date, it stays out of the queue until that date

## Review actions

### Good

Use `Good` when you remembered the note well enough.

Effect:

- The interval is increased
- The next due date is moved forward by the new interval
- The note disappears from the queue until that future date

Current interval rule:

- First successful review becomes at least `2` days
- After that, the interval doubles each time

Example:

- interval `1` -> `2`
- interval `2` -> `4`
- interval `4` -> `8`

### Repeat tomorrow

Use `Repeat tomorrow` when you want to see the note again very soon.

Effect:

- The interval is reset to `1`
- The due date becomes tomorrow
- The note will return to the queue on the next day

## Context menu actions

The plugin adds review actions to the note context menu for notes that contain `#review`:

- `SRS: Good`
- `SRS: Repeat tomorrow`

It also adds commands for the currently active note:

- `Mark active note as Good`
- `Mark active note as Repeat`

## Metadata stored in notes

The plugin writes scheduling data into note frontmatter under the `srs` key.

Example:

```yaml
---
srs:
  deck: physics
  interval: 4
  due: 2026-05-21
  lastReviewed: 2026-05-17
  ease: 3
---
```

### Meaning of fields

- `interval`: number of days before the note should appear again
- `due`: next review date in `YYYY-MM-DD` format
- `lastReviewed`: last date when you pressed `Good` or `Repeat tomorrow`
- `ease`: extra value stored by the plugin for future scheduling logic
- `deck`: deck name resolved from `#deck/<name>`, `deck: <name>`, or `default`

You do not need to create this metadata manually. The plugin creates and updates it automatically.

## Example workflow

1. Create a note and add `#review`.
2. Open the review queue from the `brain` sidebar button.
3. Open a note from the queue.
4. If the note was easy, click `Good`.
5. If the note needs another pass soon, click `Repeat tomorrow`.
6. The plugin updates the note frontmatter and recalculates when it should return.

## Troubleshooting

### A note does not appear in the queue

Check the following:

- The note contains `#review` or a frontmatter tag of `review`
- The note is a markdown file
- The note is due today or overdue

If needed, run the `Refresh review queue` command.

### I do not see the sidebar button

Check that:

- The plugin is enabled
- Community plugins are allowed in your vault
- You are looking at the left ribbon area in Obsidian

### I changed frontmatter manually

That is supported, but invalid values may be replaced with defaults:

- missing `interval` becomes `1`
- missing `due` becomes today

## Development

```bash
npm install
npm run build
```
