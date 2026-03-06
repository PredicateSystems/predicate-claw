# Demo Workspace

This is a sandboxed workspace for the SecureClaw integration demo.

## Structure

- `src/` - Source files (safe to read)
- `output/` - Generated output files (safe to write)
- `temp/` - Temporary files (safe to write)

## Policy Rules

The agent can:
- Read files in `src/`
- Write files to `output/` and `temp/`
- Run safe shell commands (ls, cat, grep, echo)
- Make HTTPS requests to approved domains

The agent cannot:
- Read `.env` files or credentials
- Access SSH keys or system files
- Run dangerous commands (rm -rf, sudo, curl|bash)
- Make insecure HTTP requests
