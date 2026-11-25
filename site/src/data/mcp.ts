/** How any MCP client connects to Greenlit (Streamable HTTP + a bearer token), as most clients' JSON config takes it. */
export const mcpConfig = `{
  "mcpServers": {
    "greenlit": {
      "type": "http",
      "url": "https://your-greenlit/api/mcp",
      "headers": { "Authorization": "Bearer glt_…" }
    }
  }
}`

/** The same, with string values marked for the code block's colours (the config has no characters to escape). */
export const mcpConfigHtml = mcpConfig.replace(/: ("[^"]*")/g, ': <span class="s">$1</span>')
