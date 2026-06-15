// app.js — Main application logic for the Reminda Kanban board.
// Depends on auth.js (authObj, basePath, validateToken, sendToLogin)
// and jKanban (board rendering/drag-drop).

let layer = null;        // ArcGIS Feature Service layer URL (e.g. .../FeatureServer/0)
let Kanban;              // jKanban instance
let layer_defn = null;   // Layer field/domain schema from the ArcGIS REST API
let prefix = "T";        // Task ID prefix (e.g. "T-1"); override via layer description: prefix=XYZ
let authObj = null;      // OAuth2 token object, loaded from localStorage by validateLogin()
let initialized = false; // Guards against double-initialization on page load
let addItemBoardId = null; // Tracks which column the add-item dialog was opened from
const knownItems = new Map(); // id → last-seen server attributes; used to detect remote changes during polling

/////////////////////////////
// App Starts Here
/////////////////////////////

// Entry point: reads the ?layer= URL param, fetches layer definition + items,
// builds the jKanban board, and wires up all dialog button handlers.
async function initialize() {
    const params = new URLSearchParams(window.location.search);
    layer = params.get("layer");

    console.log(layer);

    // Redirect to the create page if no layer was specified
    if (!layer) window.location.href = basePath + "/create.html";

    if (!layer_defn) await getLayerDefinition()

    // Display the portal item title (e.g. "Reminda - My Board") in the nav
    let board_name = await getName()
    document.getElementById("name").innerText = board_name
    loadNavBoards(); // Populate the "Load Board" nav dropdown (async, runs in background)

    // Board columns come from the coded domain values on the "status" field
    let board_ids = getBoards()
    console.log(board_ids);

    // Optionally prepend a custom prefix to task IDs (set in layer description as prefix=ABC)
    let extra_prefix = getPrefix();
    if (extra_prefix) prefix = extra_prefix + "-" + prefix;

    // Fetch all non-Closed tasks from the feature service
    let all_items = await getItems()

    console.log(all_items);

    // Seed the change-detection map with the initial server state
    for (const item of all_items) {
        if (item.id) knownItems.set(item.id, { ...item });
    }

    // Build the jKanban boards array — one board per status domain value
    let boards = []
    for (let i = 0; i < board_ids.length; i++) {
        let items = all_items.filter(item => item.status === board_ids[i])

        // Apply a distinct colour class to terminal/closed columns
        let title_class = "title";
        if (["Closed", "Done", "Finished", "Complete"].includes(board_ids[i])) title_class = "closed";

        let board = {
            id: board_ids[i],
            title: board_ids[i],
            class: title_class,
            item: items
        }

        boards.push(board)
    }

    Kanban = new jKanban({
        element: "#myKanban",
        responsivePercentage: true,
        dragBoards: false,
        itemHandleOptions: {
            enabled: false,
        },
        // Open the edit dialog when a card is clicked
        click: function (el) {
            showEditForm(el);
        },
        context: function (el, e) {
            console.log("Trigger on all items right-click!");
        },
        // Persist the new column (status) after a card is dragged
        dragendEl: function (el) {
            handleDragEnd(el);
        },
        // "Add Item" button — opens the add item dialog
        buttonClick: function (el, boardId) {
            addItemBoardId = boardId;
            document.getElementById("inpTitle_AddDialog").value = "";
            document.getElementById("inpDescription_AddDialog").value = "";

            // Populate priority options on first open
            const prioritySelect = document.getElementById("selPriority_AddDialog");
            if (prioritySelect.options.length === 0) {
                const priorityField = layer_defn.fields.find(f => f.name === "priority");
                for (const cv of priorityField.domain.codedValues) {
                    const opt = document.createElement("option");
                    opt.value = cv.code;
                    opt.textContent = cv.name;
                    prioritySelect.appendChild(opt);
                }
            }
            prioritySelect.value = "None";

            document.getElementById("dialogAddItem").showModal();
        },
        itemAddOptions: {
            enabled: true,
            content: 'Add Item',
            class: 'full_width',
            footer: true
        },
        boards: boards
    });

    // Refresh all initially-rendered cards to inject priority icons
    for (const el of document.querySelectorAll('.kanban-item')) {
        updateElementFromJSON(el, elementToJSON(el));
    }

    // Style the jKanban "Add Item" footer buttons as caco3 neutral
    for (const btn of document.querySelectorAll('.kanban-board footer button')) {
        btn.setAttribute('data-kind', 'neutral');
        btn.setAttribute('data-width', 'full');
    }

    // Wire up the Add Item dialog
    const addPrioritySelect = document.getElementById("selPriority_AddDialog");
    document.getElementById("btnCancelAddItem").onclick = () => { document.getElementById("dialogAddItem").close(); };
    document.getElementById("btnSaveAddItem").onclick = async () => {
        const title = document.getElementById("inpTitle_AddDialog").value.trim();
        if (!title || !addItemBoardId) return;
        const attributes = {
            title,
            description: document.getElementById("inpDescription_AddDialog").value,
            priority: addPrioritySelect.value || "None",
            taskname: "",
            status: addItemBoardId
        };
        const result = await addRecord(attributes);
        if (result) {
            Kanban.addElement(addItemBoardId, result);
            const newEl = Kanban.findElement(result.id);
            if (newEl) updateElementFromJSON(newEl, result);
        }
        document.getElementById("dialogAddItem").close();
    };
    document.getElementById("inpTitle_AddDialog").addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("btnSaveAddItem").click();
    });

    // Wire up the Create Board dialog
    document.getElementById("btnOpenCreateBoard").onclick = (e) => { e.preventDefault(); document.getElementById("dialogCreateBoard").showModal(); };
    document.getElementById("btnCancelCreateBoard").onclick = () => { document.getElementById("dialogCreateBoard").close(); };
    document.getElementById("btnCreateBoard").onclick = (e) => { createKanbanFeatureService(e); };

    // Wire up the Load Board dialog
    document.getElementById("btnOpenLoadBoard").onclick = (e) => { e.preventDefault(); document.getElementById("dialogLoadBoard").showModal(); };
    document.getElementById("btnLoadBoard").onclick = () => { const url = document.getElementById("boardsDropdown").value; if (url) window.location.href = url; };
    document.getElementById("btnCancelLoadBoard").onclick = () => { document.getElementById("dialogLoadBoard").close(); };

    // Wire up the edit dialog buttons
    document.getElementById("btnCancel_Dialog").onclick = function () {document.getElementById("dialogEditTitle").close()};
    document.getElementById("btnSave_Dialog").onclick = async function () {await saveEditForm()};

    // Upload button: upload each selected file as an attachment, then refresh the list
    document.getElementById("btnUpload_Dialog").onclick = async function () {
        const fileInput = document.getElementById("fileInput_Dialog");
        const files = fileInput.files;
        if (files.length === 0) return;

        const id = document.getElementById("txtId_Dialog").innerText;
        const el = Kanban.findElement(id);
        const attributes = elementToJSON(el);

        const btn = document.getElementById("btnUpload_Dialog");
        btn.disabled = true;
        btn.textContent = "Uploading...";

        for (const file of files) {
            await addAttachment(attributes.objectid, file);
        }

        btn.disabled = false;
        btn.textContent = "Upload";
        fileInput.value = "";
        await renderAttachments(attributes.objectid);
    };

    addSwimlaneCopyIcons(); // Inject clipboard icons into each column header

    startPolling(30000); // Check for remote changes every 30 seconds

    // Sync immediately when the tab or window regains focus, unless the edit dialog is open.
    // Both events are registered because visibilitychange covers tab switches while
    // window.focus covers switching from another app/window without changing tabs.
    // The debounce prevents a double-poll when both events fire at the same time.
    let lastFocusPoll = 0;
    function pollOnFocus() {
        if (document.getElementById("dialogEditTitle").open) return;
        const now = Date.now();
        if (now - lastFocusPoll < 2000) return; // debounce: ignore if polled within 2s
        lastFocusPoll = now;
        pollForUpdates();
    }
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") pollOnFocus();
    });
    window.addEventListener("focus", pollOnFocus);

    initialized = true;
}

// Fetches the human-readable title of this board from the ArcGIS portal item.
// Falls back to the layer's own name if the portal item can't be retrieved.
async function getName() {
    try {
        // Strip the layer index (/0) to get the FeatureServer root URL
        const serviceUrl = layer.replace(/\/\d+$/, "");
        const resp = await fetch(`${serviceUrl}?f=json&token=${authObj.access_token}`);
        const data = await resp.json();
        if (data.serviceItemId) {
            // Use the portal item title (set when the service was created)
            const itemResp = await fetch(`https://www.arcgis.com/sharing/rest/content/items/${data.serviceItemId}?f=json&token=${authObj.access_token}`);
            const item = await itemResp.json();
            if (item.title) return item.title;
        }
    } catch (e) {
        console.error("Failed to get service name:", e);
    }
    return layer_defn.name;
}

// Populates the "Load Board" nav dropdown with all boards tagged "kanban".
async function loadNavBoards() {
    const dropdown = document.getElementById("boardsDropdown");
    if (!dropdown) return;

    const searchUrl = `https://www.arcgis.com/sharing/rest/search`;
    const query = `tags:kanban AND type:"Feature Service"`;

    try {
        const resp = await fetch(searchUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `f=json&token=${authObj.access_token}&filter=${encodeURIComponent(query)}&num=100`
        });
        const data = await resp.json();
        const results = data.results || [];

        dropdown.innerHTML = "";
        if (results.length === 0) {
            dropdown.innerHTML = "<option disabled>No boards found</option>";
            return;
        }
        for (const item of results) {
            const option = document.createElement("option");
            option.value = basePath + "/index.html?layer=" + item.url + "/0";
            option.textContent = item.title;
            if (layer && layer === item.url + "/0") option.selected = true;
            dropdown.appendChild(option);
        }
    } catch (e) {
        console.error("Failed to load boards:", e);
    }
}

// Reads an optional "prefix=XYZ" key from the layer's description field.
// This lets each board have a custom task ID prefix (e.g. "ABC-T-1").
function getPrefix() {
    var config = parseKeyValueString(layer_defn.copyrightText)
    return config.prefix
}

// Parses a simple "key=value, key2=value2" string into an object.
function parseKeyValueString(str) {
    const obj = {};
    const regex = /([^=,\s]+)\s*=\s*([^,]+)/g;
    let match;
    while ((match = regex.exec(str)) !== null) {
        obj[match[1]] = match[2];
    }
    return obj;
}

// Fetches the layer's field definitions and domain values from the ArcGIS REST API.
// Result is stored in layer_defn and used throughout the app.
async function getLayerDefinition() {
    const response = await fetch(`${layer}?f=json&token=${authObj.access_token}`)
    const data = await response.json();
    if (data.currentVersion) layer_defn = data;
}

// Extracts the list of board column names from the "status" field's coded domain.
function getBoards() {
    let status_field = layer_defn.fields.find(field => field.name === "status")
    let codedValues = status_field.domain.codedValues
    let boards = codedValues.map(codedValue => codedValue.name)
    return boards
}

// Fetches all non-Closed tasks from the feature service, ordered by task ID.
async function getItems() {
    const response = await fetch(`${layer}/query?token=${authObj.access_token}&outFields=*&where=status<>'Closed'&f=json&orderByFields=id`)
    const data = await response.json()
    let items = data.features.map(feature => feature.attributes)
    return items
}

// Called by jKanban after a card is dropped into a new column.
// Updates the task's status in the feature service to match the new column.
async function handleDragEnd(el) {
    let attributes = elementToJSON(el)
    let board_id = Kanban.getParentBoardID(attributes.id)
    attributes.status = board_id
    updateRecord(attributes);
    // Keep knownItems in sync so the next poll doesn't mistake this local change for a remote one
    if (knownItems.has(attributes.id)) {
        knownItems.set(attributes.id, { ...knownItems.get(attributes.id), status: board_id });
    }
}

// Opens the edit dialog with the latest field values fetched fresh from the server.
// Using knownItems as the source of objectid (jKanban doesn't set data-objectid on
// initial load, so elementToJSON would return undefined for cards not yet locally saved).
async function showEditForm(el) {
    let id = el.dataset.eid;

    // Start from knownItems (has full attributes including objectid from initial load)
    // and fall back to DOM data-* for anything added locally this session.
    const knownItem = knownItems.get(id);
    let attributes = knownItem ? { ...knownItem, id } : elementToJSON(Kanban.findElement(id));

    // Fetch the freshest values from the server before opening the dialog.
    // This ensures description/priority are current even if the card was never locally edited.
    const objectid = attributes.objectid;
    if (objectid) {
        try {
            const response = await fetch(`${layer}/query?token=${authObj.access_token}&outFields=*&where=objectid=${objectid}&f=json`);
            const data = await response.json();
            if (data.features?.length > 0) {
                const fresh = data.features[0].attributes;
                attributes = { ...attributes, ...fresh, id };
                // Keep the card DOM and knownItems in sync with the just-fetched data
                const cardEl = Kanban.findElement(id);
                if (cardEl) updateElementFromJSON(cardEl, attributes);
                knownItems.set(id, { ...attributes });
            }
        } catch (e) {
            console.error("Failed to fetch latest task data:", e);
            // Fall through — dialog will still open with the best available data
        }
    }

    const dialog = document.getElementById("dialogEditTitle");
    document.getElementById("txtId_Dialog").innerText = attributes.id;
    document.getElementById("inpTitle_Dialog").value = attributes.title;
    document.getElementById("inpDescription_Dialog").value = attributes.description || "";
    const commentsEl = document.getElementById("inpComments_Dialog");
    if (commentsEl) commentsEl.value = attributes.comments || "";

    // Populate the priority dropdown from the coded domain (only on first open)
    const prioritySelect = document.getElementById("selPriority_Dialog");
    if (prioritySelect.options.length === 0) {
        const priorityField = layer_defn.fields.find(f => f.name === "priority");
        for (const cv of priorityField.domain.codedValues) {
            const opt = document.createElement("option");
            opt.value = cv.code;
            opt.textContent = cv.name;
            prioritySelect.appendChild(opt);
        }
    }
    prioritySelect.value = attributes.priority || "None";

    document.getElementById("fileInput_Dialog").value = "";
    dialog.showModal();

    // Load existing attachments for this task
    renderAttachments(attributes.objectid);
}

// Reads values from the edit dialog, saves to ArcGIS, and updates the card in the UI.
async function saveEditForm(){
    let id = document.getElementById("txtId_Dialog").innerText
    let el = Kanban.findElement(id)

    let attributes = elementToJSON(el)
    attributes.title = document.getElementById("inpTitle_Dialog").value
    attributes.priority = document.getElementById("selPriority_Dialog").value
    attributes.description = document.getElementById("inpDescription_Dialog").value
    attributes.comments = document.getElementById("inpComments_Dialog")?.value ?? ""

    updateRecord(attributes);         // Persist to ArcGIS
    updateElementFromJSON(el, attributes); // Update the card DOM element

    // Keep knownItems in sync so the next poll doesn't treat this as a remote change
    knownItems.set(id, { ...knownItems.get(id), ...attributes });

    document.getElementById("dialogEditTitle").close();
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function priorityIconHtml(priority) {
    if (!priority || priority === 'None') return '';
    return `<i class="ph-duotone ph-circle card-priority card-priority-${priority.toLowerCase()}" aria-hidden="true"></i>`;
}

// Reads all data-* attributes from a kanban card element into a plain object.
// Converts "null" strings to null and numeric strings to numbers.
function elementToJSON(el) {
    if (!el) return null;

    const obj = { ...el.dataset };

    // Convert "null" → null, and numeric strings → numbers
    for (const key in obj) {
        const val = obj[key];
        if (val === "null") obj[key] = null;
        else if (!isNaN(val) && val.trim() !== "") obj[key] = Number(val);
    }

    // jKanban uses data-eid for the task ID; normalise it to "id"
    if ("eid" in obj) {
        obj.id = obj.eid;
        delete obj.eid;
    }

    const titleEl = el.querySelector('.card-title');
    obj.title = (titleEl ? titleEl.textContent : el.textContent).trim();

    return obj;
}

// Writes an attributes object back to a kanban card element as data-* attributes.
function updateElementFromJSON(el, obj) {
    if (!el || !obj) return;

    // Clear all existing data-* attributes first
    for (const attr of [...el.attributes]) {
        if (attr.name.startsWith("data-")) {
            el.removeAttribute(attr.name);
        }
    }

    // Apply new data-* attributes
    for (const key of Object.keys(obj)) {
        if (key === "title") continue;

        let val = obj[key];
        if (val === null) val = "null";
        else if (typeof val !== "string") val = String(val);

        const dataKey = key === "id" ? "eid" : key;
        el.dataset[dataKey] = val;
    }

    // Render card: task ID + priority icon + title
    const id       = el.dataset.eid || '';
    const title    = "title" in obj ? obj.title : '';
    const priority = el.dataset.priority || '';
    el.innerHTML = `<span class="card-header"><span class="card-id">${escapeHtml(id)}</span>${priorityIconHtml(priority)}</span><span class="card-title">${escapeHtml(title)}</span>`;
}

// Adds a new feature (task) to the ArcGIS feature service.
// After insert, writes the generated objectId back as the task's "id" field,
// then calls updateRecord() so that generated ID is persisted.
async function addRecord(attributes) {
    const response = await fetch(`${layer}/addFeatures`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `f=json&token=${authObj.access_token}&features=[{"attributes":${JSON.stringify(attributes)}}]`
    })

    const data = await response.json()

    if (isAuthError(data)) return null;
    if (!data.addResults) { console.error("addRecord failed:", data.error); return null; }

    if (data.addResults[0].success) {
        let result = data.addResults[0];

        // Assign the ArcGIS-generated IDs back to the attributes object
        attributes.globalid = result.globalId;
        attributes.id = prefix + result.objectId;  // e.g. "T-42"
        attributes.objectid = result.objectId;

        // Persist the generated id field value back to the record
        await updateRecord(attributes);

        // Register in knownItems so the polling loop tracks it from creation
        knownItems.set(attributes.id, { ...attributes });

        return attributes;
    }

    return null
}

// Returns the list of attachments for a given feature (task).
async function getAttachments(objectId) {
    const response = await fetch(`${layer}/${objectId}/attachments?f=json&token=${authObj.access_token}`);
    const data = await response.json();
    return data.attachmentInfos || [];
}

// Uploads a single file as an attachment to a feature using multipart form POST.
async function addAttachment(objectId, file) {
    const formData = new FormData();
    formData.append("f", "json");
    formData.append("token", authObj.access_token);
    formData.append("attachment", file);

    const response = await fetch(`${layer}/${objectId}/addAttachment`, {
        method: "POST",
        body: formData
    });
    const data = await response.json();
    return data.addAttachmentResult;
}

// Deletes a single attachment by ID from a feature.
async function deleteAttachment(objectId, attachmentId) {
    const response = await fetch(`${layer}/${objectId}/deleteAttachments`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `f=json&token=${authObj.access_token}&attachmentIds=${attachmentId}`
    });
    const data = await response.json();
    return data.deleteAttachmentResults;
}

// Converts a byte count to a human-readable string (B / KB / MB).
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// Fetches and renders the attachment list for a task inside the edit dialog.
// Each row shows the filename (download link), file size, and a delete button.
async function renderAttachments(objectId) {
    const container = document.getElementById("attachmentsList_Dialog");
    container.innerHTML = "<em>Loading...</em>";

    const attachments = await getAttachments(objectId);

    if (attachments.length === 0) {
        container.innerHTML = "<em>No attachments</em>";
        return;
    }

    container.innerHTML = "";
    for (const att of attachments) {
        const row = document.createElement("div");
        row.className = "attachment-row";

        // Filename link — opens/downloads the attachment via the ArcGIS REST API
        const link = document.createElement("a");
        link.href = `${layer}/${objectId}/attachments/${att.id}?token=${authObj.access_token}`;
        link.target = "_blank";
        link.textContent = att.name;
        link.className = "attachment-name";

        const size = document.createElement("span");
        size.className = "attachment-size";
        size.textContent = formatFileSize(att.size);

        const btnDelete = document.createElement("button");
        btnDelete.textContent = "Delete";
        btnDelete.className = "attachment-delete";
        btnDelete.onclick = async function () {
            btnDelete.disabled = true;
            btnDelete.textContent = "...";
            await deleteAttachment(objectId, att.id);
            await renderAttachments(objectId); // Re-render after deletion
        };

        row.appendChild(link);
        row.appendChild(size);
        row.appendChild(btnDelete);
        container.appendChild(row);
    }
}

// Saves changes to an existing feature (task) in the ArcGIS feature service.
async function updateRecord(attributes) {
    const response = await fetch(`${layer}/updateFeatures`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `f=json&token=${authObj.access_token}&features=[{"attributes":${JSON.stringify(attributes)}}]`
    })

    const data = await response.json()

    console.log(data);
}

// Returns true and redirects to login if the ArcGIS response carries an auth error (498/499).
function isAuthError(data) {
    if (data?.error?.code === 498 || data?.error?.code === 499) {
        console.warn("Auth token expired or invalid — redirecting to login");
        sendToLogin();
        return true;
    }
    return false;
}

// Queries the feature service for the current state of all non-Closed tasks and
// reconciles any differences against the board without a full page reload.
//
// Change detection rules (using knownItems as the baseline):
//   - Item missing from server response → deleted or closed; remove from board
//   - Item present but not yet tracked  → added remotely; insert into correct column
//   - status changed                    → move card to the new column
//   - title / priority / description changed → update the card in place
async function pollForUpdates() {
    let serverItems;
    try {
        // Fetch ALL items including Closed so we can detect status changes to/from Closed
        // without mistaking them for deletions. Truly deleted items are the only ones
        // that will be absent from a where=1=1 result.
        const response = await fetch(`${layer}/query?token=${authObj.access_token}&outFields=*&where=1=1&f=json&orderByFields=id`);
        const data = await response.json();
        if (isAuthError(data)) return;
        if (data.error) { console.error("Poll API error:", data.error); return; }
        serverItems = data.features.map(f => f.attributes);
    } catch (e) {
        console.error("Poll failed:", e);
        return;
    }

    // Build a fast lookup of what the server currently has
    const serverById = new Map();
    for (const item of serverItems) {
        if (item.id) serverById.set(item.id, item);
    }

    // Pass 1: update or remove items we already know about
    for (const [id, known] of knownItems) {
        const serverItem = serverById.get(id);

        if (!serverItem) {
            // Item is completely gone from the server — it was deleted
            Kanban.removeElement(id);
            knownItems.delete(id);
            continue;
        }

        if (serverItem.status !== known.status) {
            // Card moved to a different column on the backend (including to/from Closed) — reinsert it
            Kanban.removeElement(id);
            Kanban.addElement(serverItem.status, serverItem);
            const newEl = Kanban.findElement(id);
            if (newEl) updateElementFromJSON(newEl, serverItem);
            knownItems.set(id, { ...serverItem });

        } else if (
            serverItem.title       !== known.title       ||
            serverItem.priority    !== known.priority    ||
            serverItem.description !== known.description
        ) {
            // Field(s) changed — update the card DOM in place
            const el = Kanban.findElement(id);
            if (el) updateElementFromJSON(el, serverItem);
            knownItems.set(id, { ...serverItem });
        }
    }

    // Pass 2: add items that appeared on the server since page load.
    // Skip terminal-status items that weren't already tracked — these are historical
    // records closed before the board was opened and don't need to surface now.
    const terminalStatuses = new Set(["Closed", "Done", "Finished", "Complete"]);
    for (const [id, serverItem] of serverById) {
        if (!knownItems.has(id) && !terminalStatuses.has(serverItem.status)) {
            Kanban.addElement(serverItem.status, serverItem);
            const newEl = Kanban.findElement(id);
            if (newEl) updateElementFromJSON(newEl, serverItem);
            knownItems.set(id, { ...serverItem });
        }
    }
}

// Starts the background polling loop. Skips a tick if the previous poll is still running.
function startPolling(intervalMs = 30000) {
    let running = false;
    setInterval(async () => {
        if (running) return; // skip if previous poll hasn't finished
        running = true;
        try {
            await pollForUpdates();
        } catch (e) {
            console.error("Poll error:", e);
        } finally {
            running = false;
        }
    }, intervalMs);
}

// Fetches all tasks (including Closed) and downloads them as a CSV file.
async function exportAllTasksCSV() {
    const response = await fetch(`${layer}/query?token=${authObj.access_token}&outFields=id,title,status&where=1=1&f=json&orderByFields=id`);
    const data = await response.json();
    const items = data.features.map(f => f.attributes);

    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['id', 'title', 'status'].join(',')];
    for (const item of items) {
        rows.push([escape(item.id), escape(item.title), escape(item.status)].join(','));
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tasks.csv';
    a.click();
    URL.revokeObjectURL(url);
    caco3Alerts.show('Exported', `${items.length} tasks downloaded as tasks.csv`, { kind: 'success' });
}

// Adds a small clipboard icon button to each swimlane header after jKanban renders.
function addSwimlaneCopyIcons() {
    const boards = document.querySelectorAll('.kanban-board');
    for (const board of boards) {
        const boardId = board.dataset.id;
        const titleEl = board.querySelector('.kanban-title-board');
        if (!titleEl) continue;

        const btn = document.createElement('button');
        btn.className = 'swimlane-copy-btn';
        btn.title = 'Copy tasks to clipboard';
        btn.innerHTML = '<i class="ph ph-copy" aria-hidden="true"></i>';
        btn.onclick = (e) => {
            e.stopPropagation();
            copySwimlaneTasks(boardId, btn);
        };
        titleEl.appendChild(btn);
    }
}

// Copies the tasks in a given swimlane to the clipboard as tab-delimited text.
function copySwimlaneTasks(boardId, btn) {
    const board = document.querySelector(`.kanban-board[data-id="${CSS.escape(boardId)}"]`);
    if (!board) return;

    const items = board.querySelectorAll('.kanban-item');
    const rows = [['id', 'title', 'status'].join('\t')];
    for (const item of items) {
        const id = item.dataset.eid ?? '';
        const title = (item.querySelector('.card-title')?.textContent ?? item.textContent).trim();
        rows.push([id, title, boardId].join('\t'));
    }

    navigator.clipboard.writeText(rows.join('\n')).then(() => {
        caco3Alerts.show(`${boardId} copied`, `${rows.length - 1} tasks copied to clipboard`, { kind: 'success' });
    });
}

// Checks localStorage for a valid auth token and redirects to login if missing.
// On first run, kicks off initialize() and starts a periodic token refresh check.
function validateLogin() {
    console.log("validateLogin");
    if (!window.localStorage) sendToLogin();

    if (window.localStorage) {
        let authObjItem = window.localStorage.getItem(localStorageKey);
        if (!authObjItem) sendToLogin();
        authObj = JSON.parse(authObjItem);
    }

    console.log("User is authenticated")

    if (!initialized){
        initialize();
        setInterval(() => validateToken(authObj), 60000);
    }
}

validateLogin();
