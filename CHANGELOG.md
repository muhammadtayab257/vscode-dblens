# Changelog

All notable changes to the **DBLens** extension will be documented in this file.

## [0.2.0] - 2026-03-27

### Added
- **AI-Powered SQL Generation**
  - Dual provider support: GitHub Copilot (free) and OpenAI (unlimited)
  - Type plain English, get SQL instantly with real-time streaming
  - AI explains queries alongside generated SQL
  - Schema-aware: knows your tables, columns, types, and relationships
  - Side-by-side explanation + SQL view
  - OpenAI API key input directly in the UI with security note
  - Auto-switch to OpenAI when Copilot quota is reached
- **SSL Support**
  - SSL toggle in connection form for cloud databases
  - Works with AWS RDS, Azure, Google Cloud SQL, etc.
  - PostgreSQL and MySQL support
- **Interactive ER Diagram** (rebuilt from scratch)
  - Smart BFS-layered layout algorithm (max 5 tables per row)
  - Click table to highlight all its relationships
  - Related table tags for quick navigation between connected tables
  - Clickable/draggable minimap navigation
  - Lines dimmed by default, glow on hover/click
  - Unrelated tables dim when a table is selected
  - Search, zoom, pan, fit all, export PNG/SVG
  - Toggle lines visibility
- **OpenAI Settings**
  - VS Code settings for API key and model selection
  - In-UI API key input (no need to dig through settings)
  - Model picker: gpt-4o-mini, gpt-4o, gpt-3.5-turbo

### Changed
- **Redesigned UI** across all panels (SQL Editor, Table View, Query Results)
  - Cleaner toolbar layout with merged rows
  - Modern rounded corners, better spacing
  - Better result tables with cleaner styling
  - Improved empty/loading/error states
- Bumped minimum VS Code version to 1.90.0 (required for Language Model API)
- Schema fetching uses single `getAllColumns()` query instead of 50+ individual queries
- AI schema caching for faster subsequent queries
- Cache auto-clears on DDL queries (CREATE, ALTER, DROP)

### Fixed
- Connection form now properly saves and restores SSL setting when editing
- SVG data attributes on ERD lines for proper hover/click highlighting

## [0.1.1] - 2026-03-12

### Fixed
- Connection form data loss when switching between database type tabs

## [0.1.0] - 2026-03-12

### Added
- **Connection Manager** with support for PostgreSQL, MySQL, and SQLite
  - Secure password storage using VS Code SecretStorage
  - Connection string parsing (paste `postgresql://...` or `mysql://...`)
  - Test connection before saving
  - Auto-connect on save
- **Sidebar TreeView** showing connections, tables, and columns
  - Expandable hierarchy: Connection > Tables > Columns
  - Primary key indicators on columns
  - Click table to view data
  - Right-click context menus for all actions
- **SQL Editor** with integrated results
  - Monospace editor with line numbers
  - Connection selector dropdown
  - Run with Ctrl+Enter or Run button
  - Results table with click-to-copy cells
  - Query history with one-click recall
  - Export results as CSV
  - SQL autocomplete for table and column names
- **Table Data Viewer**
  - Paginated data grid (50 rows/page)
  - Click column headers to sort
  - Filter/search rows
  - Export to CSV
  - Click any cell to copy its value
  - Keyboard navigation (arrow keys for pages)
- **Theme Support** — works with any VS Code theme (dark, light, high contrast)
