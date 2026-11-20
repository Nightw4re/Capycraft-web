# Capycraft Web repository guidance

[README.md](README.md) describes the site's purpose, current state, and entry points. Earlier designs and prototypes are in Git history.

## Repository language

- Use English for repository content, including documentation, developer-facing notes, and code comments. Write localized text in its target language.

## Working in chats

- Work on project requests in the chat where the user made them. Open another chat for the same task only when the user explicitly asks for one.

## Repository changes

- Before editing, check the current branch, run `git status --short --branch`, and inspect the diff for the affected files. Preserve other people's work in progress.
- Before committing, run `git diff --check` and review the staged changes. Stage the files that belong to the task explicitly. Report the checks performed and any relevant limitations.

## Verification

- Open the site using the local development server described in the README. Check the desktop and narrow mobile layouts in the browser.
- For images, record the source and purpose. Verify that relative paths resolve, transparency is suitable, and crops look right in the scene.
- For documentation, verify local links and check that the text matches the current implementation. Label planned features as planned.
