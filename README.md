# DBLens — Database Explorer for VS Code

Browse tables, run queries, generate SQL with AI, and visualize your schema — all directly inside Visual Studio Code. Supports **PostgreSQL**, **MySQL**, and **SQLite**.

## What's New in v0.2.0

- **AI-Powered SQL Generation** — Describe what you want in plain English, get SQL instantly
- **Dual AI Providers** — Free GitHub Copilot (50 msgs/month) + OpenAI API key (unlimited, ~$0.01/query)
- **Interactive ER Diagram** — Visualize your entire database schema with relationships
- **SSL Support** — Connect to cloud databases (AWS RDS, Azure, etc.)
- **Redesigned UI** — Cleaner, modern interface across all panels

## Features

### AI SQL Generation

![AI SQL Generation](media/ai-sql.gif)

- Type plain English like "show top 10 customers by revenue" and get SQL
- **Copilot tab** (free) — Uses VS Code's built-in GitHub Copilot
- **OpenAI tab** (unlimited) — Bring your own API key for unlimited queries
- Real-time streaming — watch SQL appear character by character
- AI explains what the query does alongside the generated SQL
- Schema-aware — AI knows your tables, columns, and types

### Interactive ER Diagram

![ER Diagram](media/erd.gif)

- Visualize all tables and their relationships
- Click a table to highlight its connections
- Drag tables to rearrange the layout
- Pan, zoom, and navigate with the minimap
- Search for tables by name
- Export as PNG or SVG
- Related table tags for quick navigation between connected tables

### Sidebar Connection Explorer
- Add, edit, and remove database connections from the activity bar
- Browse tables and columns in a tree view
- Green indicator for active connections
- Right-click context menus for quick actions

### Connection Form

![Connection Form](media/connection-form.gif)

- Visual form to configure connections
- Quick Connect — paste a `postgresql://` or `mysql://` URI and fields auto-fill
- **SSL toggle** — Enable for cloud databases (AWS RDS, Azure, etc.)
- Test Connection button to verify before saving
- Browse button for SQLite file selection
- Auto-connects after saving
- Passwords stored securely in OS keychain

### Table Data Viewer

![Table Viewer](media/table-view.gif)

- Paginated table grid with sorting by any column
- Filter rows with a WHERE clause
- Click any cell to copy its value
- Color-coded data types (numbers, booleans, nulls)
- Export table data to CSV

### SQL Editor
- Full SQL editor with line numbers
- Connection dropdown to switch databases
- Run queries with the green **Run Query** button or `Ctrl+Enter`
- Resizable split pane — editor on top, results below
- SQL autocomplete for table names, column names, and keywords
- Query history tab to re-run previous queries
- Export query results to CSV

### Quick Query Runner
- Run SQL from any `.sql` file — select text or run the whole file
- `Ctrl+Enter` keyboard shortcut in SQL files
- Results appear in a dedicated panel

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Click the **DBLens** icon in the activity bar (database icon)
3. Click the **+** button to add a connection
4. Fill in your database details or paste a connection string
5. Enable **SSL** if connecting to a cloud database
6. Click **Save & Connect**

### Using AI SQL Generation

1. Open the **SQL Editor** (click "Open Query Editor" in Quick Actions)
2. Select a connection from the dropdown
3. Type your question in the AI bar (e.g., "show all orders from last week")
4. Click **Generate Response**
5. Review the generated SQL, then click **Run Query**

**Free option:** Works automatically if you have GitHub Copilot installed (50 msgs/month free).

**Unlimited option:** Click the **OpenAI** tab, paste your API key, and get unlimited AI queries for ~$0.01 each. Your key is stored locally — never sent to our servers. [Verify our source code on GitHub](https://github.com/muhammadtayab257/vscode-dblens).

### Viewing ER Diagrams

1. Right-click a connected database in the sidebar
2. Select **Show ER Diagram**
3. Click any table to see its relationships
4. Click the related table tags to jump between connected tables

## Supported Databases

| Database   | Versions | Connection | SSL |
|------------|----------|------------|-----|
| PostgreSQL | 10+      | Host/port or connection string | Yes |
| MySQL      | 5.7+     | Host/port or connection string | Yes |
| SQLite     | 3.x      | File path | N/A |

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `DBLens: Add Connection` | Open connection form |
| `DBLens: Open Query Editor` | Open the SQL editor with AI |
| `DBLens: Show ER Diagram` | Visualize database schema |
| `DBLens: Run Query` | Execute SQL from current editor |
| `DBLens: Export as CSV` | Export a table to CSV |
| `DBLens: Refresh` | Refresh the connection tree |

## Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `dblens.openaiApiKey` | OpenAI API key for AI SQL generation | (empty) |
| `dblens.openaiModel` | OpenAI model (gpt-4o-mini, gpt-4o, gpt-3.5-turbo) | gpt-4o-mini |

## Keyboard Shortcuts

| Shortcut | Context | Action |
|----------|---------|--------|
| `Ctrl+Enter` | SQL Editor / SQL file | Run query |

## Requirements

- VS Code 1.90.0 or later
- Network access to your database server (PostgreSQL/MySQL)
- SQLite database file on disk
- **For AI (optional):** GitHub Copilot extension OR an OpenAI API key

## Privacy & Security

- Passwords are stored in VS Code's built-in **SecretStorage** (OS keychain)
- OpenAI API keys are stored in VS Code settings (local machine only)
- Connection details are stored in VS Code global state
- **No telemetry, no external servers** — all queries run directly against your database
- AI queries go directly from your machine to Copilot/OpenAI — we never see your data
- Fully open source — [verify the code yourself](https://github.com/muhammadtayab257/vscode-dblens)

## Known Issues

- SQLite uses an in-memory engine (sql.js) — very large databases may be slow to load
- ERD with 100+ tables may lag on initial load — subsequent interactions are smooth
- GitHub Copilot free tier is limited to 50 AI messages/month

## License

[MIT](LICENSE)
