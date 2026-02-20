// app.js — Main application logic for the Reminda Kanban board.
// Depends on auth.js (authObj, basePath, validateToken, sendToLogin)
// and jKanban (board rendering/drag-drop).

let layer = null;        // ArcGIS Feature Service layer URL (e.g. .../FeatureServer/0)
let Kanban;              // jKanban instance
let layer_defn = null;   // Layer field/domain schema from the ArcGIS REST API
let prefix = "T";        // Task ID prefix (e.g. "T-1"); override via layer description: prefix=XYZ
let authObj = null;      // OAuth2 token object, loaded from localStorage by validateLogin()
let initialized = false; // Guards against double-initialization on page load

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
    let board_name = "Reminda - " + await getName()
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
        // "Add Item" button — shows an inline form, saves to ArcGIS on submit
        buttonClick: function (el, boardId) {
            console.log(el);
            console.log(boardId);
            var formItem = document.createElement("form");
            formItem.innerHTML = '<div><textarea rows="5" autofocus></textarea></div><div><button type="submit">Save</button><button type="button" id="btnCancel">Cancel</button></div>';

            Kanban.addForm(boardId, formItem);
            formItem.addEventListener("submit", async function (e) {
                e.preventDefault();
                let text = e.target[0].value;

                let attributes = {
                    title: text,
                    priority: "None",
                    taskname: "",
                    status: boardId
                }

                let result = await addRecord(attributes);

                if (result) attributes = result

                Kanban.addElement(boardId, attributes);
                formItem.parentNode.removeChild(formItem);
            });
            document.getElementById("btnCancel").onclick = function () {
                formItem.parentNode.removeChild(formItem);
            };
        },
        itemAddOptions: {
            enabled: true,
            content: 'Add Item',
            class: 'full_width',
            footer: true
        },
        boards: boards
    });

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
            dropdown.innerHTML = "<li><a href='create.html'>No boards found</a></li>";
            return;
        }
        for (const item of results) {
            const li = document.createElement("li");
            const a = document.createElement("a");
            a.href = basePath + "/index.html?layer=" + item.url + "/0";
            a.textContent = item.title;
            li.appendChild(a);
            dropdown.appendChild(li);
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
}

// Opens the edit dialog and populates it with the clicked task's data.
// Priority options are lazy-loaded from the layer definition on first open.
function showEditForm(el) {
    let id = el.dataset.eid
    let attributes = elementToJSON(Kanban.findElement(id))

    const dialog = document.getElementById("dialogEditTitle");
    document.getElementById("txtId_Dialog").innerText = attributes.id;
    document.getElementById("inpTitle_Dialog").value = attributes.title;
    document.getElementById("inpDescription_Dialog").value = attributes.description || "";

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
    attributes.description = document.getElementById("inpDescription_Dialog").value
    attributes.priority = document.getElementById("selPriority_Dialog").value

    console.log(attributes);

    updateRecord(attributes);         // Persist to ArcGIS
    updateElementFromJSON(el, attributes); // Update the card DOM element

    document.getElementById("dialogEditTitle").close();
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

    obj.title = el.textContent.trim();

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
        if (key === "title") continue; // title is text content, not a data attribute

        let val = obj[key];
        if (val === null) val = "null";
        else if (typeof val !== "string") val = String(val);

        const dataKey = key === "id" ? "eid" : key;
        el.dataset[dataKey] = val;
    }

    // Update text content
    if ("title" in obj) {
        el.textContent = obj.title;
    }
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

    if (data.addResults[0].success) {
        let result = data.addResults[0];

        // Assign the ArcGIS-generated IDs back to the attributes object
        attributes.globalid = result.globalId;
        attributes.id = prefix + result.objectId;  // e.g. "T-42"
        attributes.objectid = result.objectId;

        // Persist the generated id field value back to the record
        await updateRecord(attributes);

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
        setInterval(validateToken(authObj), 60000);
    }
}

validateLogin();
