// Synthetic drafts, each in the mode its thread would be in. `refs` must survive verbatim.
// The rubric is for the person reading review.json.
export const cases = [
  {
    id: "terse-bug-report",
    mode: "code",
    draft: "login broken after the refactor, fix it",
    refs: [],
    rubric:
      "A clearer, compact request to fix the login regression. No invented files, stack or causes.",
  },
  {
    id: "question-stays-a-question",
    mode: "code",
    draft: "why does the build take so long on ci",
    refs: [],
    rubric:
      "Still a request to investigate the slow CI build. The model must not answer the question or start proposing fixes as facts.",
  },
  {
    id: "references-survive",
    mode: "code",
    draft:
      "look at [build log](t3-context://v1/terminal/terminal_1) and ![shot.png](t3-context://v1/image/image_1) then check @README.md with $review please",
    refs: [
      "[build log](t3-context://v1/terminal/terminal_1)",
      "![shot.png](t3-context://v1/image/image_1)",
      "@README.md",
      "$review",
    ],
    rubric:
      "Every reference is verbatim and followed by a space or newline, never punctuation. The task is unchanged.",
  },
  {
    id: "already-clear",
    mode: "code",
    draft:
      "Rename the `fetchUser` helper to `loadUser` in src/api/users.ts and update its callers.",
    refs: [],
    rubric: "Close to the input. No added requirements, files or steps.",
  },
  {
    id: "ask-stays-read-only",
    mode: "ask",
    draft: "why does the build take so long on ci?",
    refs: [],
    rubric:
      "Still a question about the codebase. No instruction to fix, change, implement or run anything, and no answer.",
  },
  {
    id: "plan-asks-for-a-plan",
    mode: "plan",
    draft: "add rate limiting to the api",
    refs: [],
    rubric: "A request for a plan to add rate limiting. Not an instruction to implement it.",
  },
  {
    id: "review-asks-for-a-review",
    mode: "review",
    draft: "check my changes for bugs",
    refs: [],
    rubric: "A request to review the working changes. Not a request to fix or rewrite them.",
  },
] as const;
