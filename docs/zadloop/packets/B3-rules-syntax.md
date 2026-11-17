# B3 Rule Engine Syntax

The B3 rule engine supports a subset of the Claude-Code rule syntax:

- `Tool`: Matches exactly the tool name.
- `Tool(pattern)`: Matches tool name against a pattern with `*` as a wildcard.

Examples:
- `git`: Matches only the `git` tool.
- `git-*`: Matches `git-commit`, `git-status`, etc.
- `*`: Matches all tools.

Rules are configured in deny/ask/allow lists.
