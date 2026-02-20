// create.js — Logic for the board creation page (create.html).
// Handles creating a new ArcGIS Feature Service pre-configured for Reminda,
// and populating the nav dropdown with existing boards.
// Depends on auth.js (authObj, basePath, localStorageKey, validateToken, sendToLogin).

// Creates a new Kanban board as a two-step ArcGIS REST API operation:
//   Step 1 — createService: provisions an empty hosted Feature Service.
//   Step 2 — addToDefinition: adds the Kanban table with all required fields.
// On success, redirects to the board page (index.html?layer=...).
async function createKanbanFeatureService(event) {
    event.preventDefault(); // stops submit

    let boardname = document.getElementById("boardname").value;
    if (!boardname.trim()) return;

    // Show busy state while the service is being created
    const btn = document.getElementById("btnCreateBoard");
    const spinner = document.getElementById("createSpinner");
    btn.disabled = true;
    btn.textContent = "Creating...";
    spinner.style.display = "block";

    // Step 1: Create the Service (an empty feature service container)
    const createServiceUrl = `https://arcgis.com/sharing/rest/content/users/${authObj.username}/createService`;

    // Service-level settings — no geometry (table only), editing enabled
    const serviceDefinition = {
        name: boardname,
        hasStaticData: false,
        maxRecordCount: 1000,
        supportedQueryFormats: "JSON",
        capabilities: "Query,Editing,Create,Update,Delete,Uploads",
        units: "esriMeters"
    };

    // tags=kanban makes the service discoverable; typeKeywords=reminda allows filtering to Reminda boards
    let resp = await fetch(createServiceUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `token=${authObj.access_token}&f=json&outputType=featureService&targetType=featureService&tags=kanban&typeKeywords=reminda&createParameters=${encodeURIComponent(JSON.stringify(serviceDefinition))}`
    });

    const serviceResult = await resp.json();
    if (!serviceResult.success) {
        console.error("Failed to create service:", serviceResult);
        btn.disabled = false;
        btn.textContent = "Create Board";
        spinner.style.display = "none";
        return;
    }

    let serviceUrl = serviceResult.serviceurl;

    // The admin REST endpoint is required for addToDefinition (schema changes)
    let serviceUrlAdmin = serviceUrl.replace("/rest/services/", "/rest/admin/services/");

    // Step 2: Add the Kanban table layer
    const addToDefinitionUrl = serviceUrlAdmin + "/addToDefinition";

    // Full table schema: fields for task ID, title, owner, status, priority, and description.
    // Status and Priority use coded value domains so the app can render dropdowns/columns
    // directly from the layer definition without hardcoding values.
    const layerDefinition = {
        layer: [],
        tables: [
            {
                currentVersion: 10.7,
                name: "Kanban",
                type: "Table",
                id: 0,
                displayField: "taskname",
                hasAttachments: true,  // Enables the ArcGIS attachment REST endpoints
                hasStaticData: false,
                capabilities: "Query,Editing,Create,Update,Delete,Uploads,Sync",
                supportedQueryFormats: "JSON, geoJSON, PBF",
                allowGeometryUpdates: false,
                hasM: false,
                hasZ: false,
                editorTrackingInfo: {
                    enableEditorTracking: true,
                    enableOwnershipAccessControl: false,
                    allowOthersToQuery: true,
                    allowOthersToUpdate: true,
                    allowOthersToDelete: true
                },
                globalIdField: "globalid",
                objectIdField: "objectid",
                uniqueIdField: {
                    name: "objectid",
                    isSystemMaintained: true
                },
                fields: [
                    {
                        "name": "objectid",
                        "type": "esriFieldTypeOID",
                        "alias": "OBJECTID",
                        "sqlType": "sqlTypeOther",
                        "nullable": false,
                        "editable": false,
                        "domain": null,
                        "defaultValue": null
                    },
                    {
                        name: "globalid",
                        type: "esriFieldTypeGlobalID",
                        alias: "globalid"
                    },
                    {
                        // Human-readable task ID (e.g. "T-42"), written back after insert
                        "name": "id",
                        "type": "esriFieldTypeString",
                        "alias": "Id",
                        "sqlType": "sqlTypeOther",
                        "length": 50,
                        "nullable": true,
                        "editable": true,
                        "domain": null,
                        "defaultValue": null
                    },
                    {
                        "name": "title",
                        "type": "esriFieldTypeString",
                        "alias": "title",
                        "sqlType": "sqlTypeOther",
                        "length": 256,
                        "nullable": true,
                        "editable": true,
                        "domain": null,
                        "defaultValue": null
                    },
                    {
                        "name": "owner",
                        "type": "esriFieldTypeString",
                        "alias": "Owner",
                        "sqlType": "sqlTypeOther",
                        "length": 256,
                        "nullable": true,
                        "editable": true,
                        "domain": null,
                        "defaultValue": null,
                        "description": "{\"value\":\"\",\"fieldValueType\":\"nameOrTitle\"}"
                    },
                    {
                        // Kanban column — board columns are derived from this domain at runtime
                        "name": "status",
                        "type": "esriFieldTypeString",
                        "alias": "Status",
                        "sqlType": "sqlTypeOther",
                        "length": 128,
                        "nullable": false,
                        "editable": true,
                        "domain": {
                            "type": "codedValue",
                            "name": "Status",
                            "codedValues": [
                                {
                                    "name": "Open",
                                    "code": "Open"
                                },
                                {
                                    "name": "Up Next",
                                    "code": "Up next"
                                },
                                {
                                    "name": "In Progress",
                                    "code": "In Progress"
                                },
                                {
                                    "name": "Ready for Release",
                                    "code": "Ready for Release"
                                },
                                {
                                    "name": "Closed",
                                    "code": "Closed"
                                }
                            ]
                        },
                        "defaultValue": "Open"
                    },
                    {
                        "name": "priority",
                        "type": "esriFieldTypeString",
                        "alias": "Priority",
                        "sqlType": "sqlTypeOther",
                        "length": 15,
                        "nullable": false,
                        "editable": true,
                        "domain": {
                            "type": "codedValue",
                            "name": "Priority",
                            "codedValues": [
                                {
                                    "name": "None",
                                    "code": "None"
                                },
                                {
                                    "name": "Low",
                                    "code": "Low"
                                },
                                {
                                    "name": "Medium",
                                    "code": "Medium"
                                },
                                {
                                    "name": "High",
                                    "code": "High"
                                }
                            ]
                        },
                        "defaultValue": "None"
                    },
                    {
                        "name": "description",
                        "type": "esriFieldTypeString",
                        "alias": "Description",
                        "sqlType": "sqlTypeOther",
                        "length": 512,
                        "nullable": true,
                        "editable": true,
                        "domain": null,
                        "defaultValue": null,
                        "description": "{\"value\":\"\",\"fieldValueType\":\"description\"}"
                    }
                ]
            }
        ]
    };

    resp = await fetch(addToDefinitionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `token=${authObj.access_token}&f=json&addToDefinition=${encodeURIComponent(JSON.stringify(layerDefinition))}`
    });

    const tableResult = await resp.json();
    if (tableResult.success) {
        // Redirect straight to the new board
        window.location.href = basePath + "/index.html?layer=" + serviceUrl + "/0";
    } else {
        console.error("Failed to add table:", tableResult);
        btn.disabled = false;
        btn.textContent = "Create Board";
        spinner.style.display = "none";
    }
}

// Searches the portal for all Feature Services tagged "kanban" and populates
// the nav "Load Board" dropdown with links to each board.
// Called via DOMContentLoaded to ensure the dropdown element exists in the DOM.
async function loadExistingBoards() {
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
            dropdown.innerHTML = "<li><a href='#'>No boards found</a></li>";
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

// Checks localStorage for a valid auth token and redirects to login if missing.
function validateLogin() {
    console.log("validateLogin");
    if (!window.localStorage) sendToLogin();

    if (window.localStorage) {
        let authObjItem = window.localStorage.getItem(localStorageKey);
        if (!authObjItem) sendToLogin();
        authObj = JSON.parse(authObjItem);

        validateToken(authObj);
    }

    console.log("User is authenticated")
}

validateLogin();

// Defer board list loading until the DOM is ready so #boardsDropdown exists
document.addEventListener("DOMContentLoaded", loadExistingBoards);
