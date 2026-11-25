# brain-dump

Catches a long, messy prompt before Claude reads it, asks you 2 or 3 questions about the gaps, then fills the prompt box with a clear four-part prompt:

- **The job**: what to do
- **Why**: the goal behind it
- **Guardrails**: what to keep, avoid or not touch
- **Done means**: how to tell it is finished

Check the new prompt, edit it if you like, and press Enter to send it.

- Only prompts of about 500 characters or 90 words and up are looked at. A long prompt that is already clear goes straight through.
- Start a prompt with `raw:` to send it as typed, with no questions.
- Close a question to stop. Your prompt goes back in the box as you typed it.
- The check and the rewrite are two small model calls, counted in your session's usage.
