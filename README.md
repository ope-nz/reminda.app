# Reminda

A lightweight Kanban board app that uses **ArcGIS Online** as its backend. Tasks are stored in a hosted Feature Service, so your boards are accessible anywhere you have an ArcGIS Online account — no separate server or database required.

## Features

- **ArcGIS-backed storage** — tasks live in a hosted Feature Service; no custom backend needed
- **Multiple boards** — create as many boards as you like; switch between them from the nav bar
- **Drag and drop** — move cards between columns to update their status
- **Task editing** — edit title, priority, description, and comments via a click-to-open dialog
- **File attachments** — attach files to any task; stored natively in ArcGIS
- **OAuth2 login** — signs in via your ArcGIS Online account (implicit grant flow); session expiry is detected automatically and redirects to the sign-in page
- **Real-time sync** — polls every 30 seconds and on window focus to pick up changes from other users
- **CSV export** — download all tasks on the current board as a CSV file
- **Swimlane copy** — copy all tasks in a column to the clipboard (tab-delimited)
- **Priority icons** — colour-coded priority indicators (Low / Medium / High) on each card
- **Dark mode** — toggle light/dark mode; preference is persisted across sessions

## Requirements

- An [ArcGIS Online](https://www.arcgis.com) account with the ability to create new layers
- An ArcGIS OAuth2 app registration (see Setup below)
- A static web host (GitHub Pages, any web server, or local file server)

## Setup

### 1. Register an OAuth2 app

1. Sign in to [ArcGIS Online](https://www.arcgis.com)
2. Go to **Content** → **New item** → **Application**
3. Under **Settings**, add your app's URL to the **Redirect URIs** list (e.g. `https://yourname.github.io/reminda/redirect.html`)
4. Copy the **Client ID**

### 2. Configure auth.js

Open [assets/js/auth.js](assets/js/auth.js) and update the `appId` constant with your Client ID:

```js
const appId = "YOUR_CLIENT_ID_HERE";
```

### 3. Deploy

Copy all files to your web host. No build step is required — this is plain HTML/CSS/JS.

For **GitHub Pages**: push to a repository and enable Pages on the `main` branch. Your app will be available at `https://yourname.github.io/reminda/`.

## Usage

### Creating a board

1. Open the app and sign in with your ArcGIS Online account
2. Click **New Board** in the nav bar
3. Enter a board name and click **Create Board**
4. The app provisions a Feature Service in your ArcGIS Online content and loads the new board

### Loading an existing board

On the board selection page (`create.html`), select a board from the **Load an existing board** dropdown and click **Load Board**. The list shows all Feature Services tagged `kanban` in your ArcGIS Online account.

### Working with tasks

| Action | How |
|--------|-----|
| Add a task | Click **Add Item** at the bottom of any column |
| Edit a task | Click on any card to open the edit dialog |
| Move a task | Drag a card to a different column |
| Attach a file | Open a card → scroll to Attachments → choose file(s) → Upload |
| Delete an attachment | Open a card → click **Delete** next to the attachment |

### Customising a board

You can set a custom task ID prefix by adding `prefix=XYZ` to the layer's **Copyright Text** field in ArcGIS Online. For example, setting `prefix=ABC` will produce task IDs like `ABC-T1`, `ABC-T2`, etc.

## Project structure

```
reminda/
├── index.html               — Kanban board page
├── create.html              — Board selection page (redirects to index after load)
├── signin.html              — Login page
├── redirect.html            — OAuth2 redirect handler
└── assets/
    ├── css/
    │   ├── caco3.css        — Base CSS framework (CaCO3, Calcite-inspired)
    │   ├── phosphor.css     — Phosphor icon font
    │   ├── jkanban.min.css  — Kanban library styles
    │   └── app.css          — App-specific styles
    ├── js/
    │   ├── app.js           — Main board logic (tasks, drag/drop, attachments)
    │   ├── create.js        — Board creation and portal search
    │   ├── auth.js          — OAuth2 flow and token management
    │   ├── caco3-alerts.js  — Toast notification system
    │   └── jkanban.min.js   — Kanban drag-and-drop library (jKanban)
    ├── fonts/
    │   ├── phosphor.woff2   — Phosphor icon font (regular)
    │   └── phosphor.woff
    └── img/
        └── kanban.png       — Favicon
```

## How it works

Each Reminda board is a **hosted Feature Service** in your ArcGIS Online account containing a single non-spatial table (`Kanban`). The table schema is created automatically when you click **Create Board**:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | String | Human-readable task ID (e.g. `T-42`) |
| `title` | String | Task title (shown on the card) |
| `description` | String | Task description (in edit dialog) |
| `comments` | String | Additional comments (in edit dialog, up to 4000 chars) |
| `status` | Coded domain | Determines which column the card appears in |
| `priority` | Coded domain | None / Low / Medium / High |
| `owner` | String | Task owner |

Board columns are read directly from the `status` field's coded value domain, so the column structure is entirely data-driven.

File attachments use the ArcGIS Feature Service attachment API (`/{objectId}/addAttachment`, `/{objectId}/attachments`) and are stored alongside the feature data.

## Tech stack

- **[ArcGIS REST API](https://developers.arcgis.com/rest/)** — data storage, portal search, OAuth2
- **[jKanban](https://github.com/riktar/jkanban)** — drag-and-drop kanban library
- **[CaCO3](https://github.com/ope-ltd/caco3)** — classless CSS framework, Calcite-inspired
- **[Phosphor Icons](https://phosphoricons.com)** — icon font (local files, no CDN)
- Vanilla JS (ES6+), no build tools or npm required
