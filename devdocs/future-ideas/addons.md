3 Quick Big Additions

  1. Visual Selection Inbox

  User clicks something in their running app, types “fix this spacing” or “remove this,” and Mako stores DOM context, selector, text, bounding box, page URL, and optional source
  hint. Codex or Claude Code pulls it through MCP.

  This is huge because it turns vague UI requests into precise agent context. It makes Mako feel tangible immediately.

  2. Agent Session Memory + Recall

  Mako should remember what agents already investigated, what tools were useful, what failed, what files were touched, what findings were acknowledged, and what conclusions
  changed later.

  Then agents can ask:

  What did we already learn about auth?
  What did the last agent try?
  What changed since the last answer?
  What findings are still unresolved?

  This makes Mako feel like continuity across coding sessions, not just a tool server.

  3. One-Call Task Preflight

  Before an agent edits code, Mako should generate a compact task packet:

  likely files
  relevant routes/components/schema
  recommended verification
  open assumptions

  This could become the default first move for Codex/Claude Code. Instead of “search around,” the agent starts from a grounded implementation brief.

  3 Superpower Innovations

  1. The Agent Flight Recorder

  The innovation is not logging. The innovation is making sessions replayable and comparable:

  Did this agent repeat old failed work?
  Did the answer contradict a previous trusted answer?
  Which tool call actually moved the task forward?

  Mako should not just answer “where is X?” It should tell the agent:

  Changing this probably affects these routes, tests, schema objects, auth paths, and UI states.
  Here is the minimum verification plan.
  Here is what evidence is exact vs heuristic.
  Here is what Mako is uncertain about.

  This is where Mako becomes better than plain repo search. It helps agents avoid the most expensive mistake: confident edits with weak context.

  3. Adaptive Agent Context Routing

  Once enough telemetry exists, Mako should learn which context packets actually help which agent/task shape.

  Examples:

  For UI polish tasks, attach visual selection + component neighborhood + screenshot hint.
  For DB tasks, attach table neighborhood + RLS path + migration history.
  For bug fixes, attach prior failures + changed answer history + verification bundle.

  This is the ML path that actually matters: not “train a coder,” but learn what context makes existing coders better.