
const appId = "rIUDDozGXkFgERn7";
const portalURL = "https://www.arcgis.com";
const localStorageKey = '__ARCGIS_REST_USER_SESSION__';

const basePath = (window.location.origin + window.location.pathname).replace(/\/?[^/]*\.html$/, "").replace(/\/$/, "");

// redirect.html simply calls this fn, with the url
// from there, we parse out the hash into a set of key/values
// and stuff that into an object that our app then stores
function checkOAuthResponse(href) {
    console.log("checkOAuthResponse");

    // parse the href
    let hash = href.split('#')[1];
    let parts = hash.split('&');
    let respObj = parts.reduce((acc, part) => {
        let k = part.split('=')[0];
        let v = part.split('=')[1];
        acc[k] = v;
        return acc;
    }, {})

    if (respObj.hasOwnProperty("error")) {
        console.error(`Error: ${decodeURI(respObj.error_description)}`);
        sendToLogin();
        return null;
    }

    // the response has an expires_in value that is seconds-from-now...
    // lets turn that into a real date, so we can check if the token is valid later w/o doing an xhr
    respObj.validUntil = new Date().getTime() + (respObj.expires_in * 1000);

    // assume the user is authenticated, if we got this far
    // token will be validated later anyway

    window.localStorage.setItem(localStorageKey, JSON.stringify(respObj));
    startApp();
}

function sendToLogin() {
    console.log("sendToLogin");
    window.localStorage.removeItem(localStorageKey);
    window.location.href = basePath + "/signin.html";
}

function startApp() {
    console.log("startApp");
    window.location.href = basePath;
}

function startSignIn() {
    console.log("startSignIn");
    let authorizeUrl = `${portalURL}/sharing/rest/oauth2/authorize?client_id=${appId}&response_type=token&redirect_uri=${basePath}/redirect.html`;
    window.open(authorizeUrl, 'authWindow', 'menubar=no,location=no,resizable=no,scrollbars=no,status=no,width=500,height=550');
}

function validateToken(input) {
    console.log("validateToken");
    if (!input) sendToLogin();
	
    var xhr = new XMLHttpRequest();
    xhr.open('GET', `${portalURL}/sharing/rest/community/users/${input.username}?f=json&token=${input.access_token}`, false); // false = synchronous
    xhr.send(null);

    if (xhr.status === 200) {
        let response = xhr.responseText;
        if (response.includes("error") || response.includes("Invalid Token")) {
            sendToLogin();
        }
    	
        if (!response.includes(input.username) || !response.includes("groups")){
            sendToLogin();
        }

        console.log( JSON.parse(response))

        if (response.includes("orgId")) return JSON.parse(response).orgId;
    } else {
        sendToLogin();
    }   

    return null
}