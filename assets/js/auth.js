const appId = "rIUDDozGXkFgERn7";
const portalURL = "https://www.arcgis.com";
const localStorageKey = '__ARCGIS_REST_USER_SESSION__';

const basePath = (window.location.origin + window.location.pathname).replace(/\/?[^/]*\.html$/, "").replace(/\/$/, "");

function checkOAuthResponse(href) {
    const hash = href.split('#')[1] || '';
    const params = new URLSearchParams(hash);
    const respObj = Object.fromEntries(params.entries());

    if (respObj.error) {
        console.error(`OAuth error: ${decodeURIComponent(respObj.error_description || respObj.error)}`);
        sendToLogin();
        return null;
    }

    respObj.validUntil = new Date().getTime() + (Number(respObj.expires_in) * 1000);
    window.localStorage.setItem(localStorageKey, JSON.stringify(respObj));
    startApp();
}

function sendToLogin() {
    window.localStorage.removeItem(localStorageKey);
    window.location.href = basePath + "/signin.html";
}

function startApp() {
    window.location.href = basePath;
}

function startSignIn() {
    const authorizeUrl = `${portalURL}/sharing/rest/oauth2/authorize?client_id=${appId}&response_type=token&redirect_uri=${basePath}/redirect.html`;
    window.open(authorizeUrl, 'authWindow', 'menubar=no,location=no,resizable=no,scrollbars=no,status=no,width=500,height=550');
}

async function validateToken(input) {
    if (!input) { sendToLogin(); return null; }
    try {
        const resp = await fetch(`${portalURL}/sharing/rest/community/users/${input.username}?f=json&token=${input.access_token}`);
        const data = await resp.json();
        if (data.error || !data.username || !data.groups) {
            sendToLogin();
            return null;
        }
        return data.orgId || null;
    } catch (e) {
        console.error("Token validation failed:", e);
        sendToLogin();
        return null;
    }
}

// Searches ArcGIS Online for all Feature Services tagged "kanban".
// Used by both the board page nav dropdown and the create/load page.
async function searchKanbanBoards(token) {
    const resp = await fetch(`${portalURL}/sharing/rest/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `f=json&token=${token}&filter=${encodeURIComponent('tags:kanban AND type:"Feature Service"')}&num=100`
    });
    const data = await resp.json();
    return data.results || [];
}
