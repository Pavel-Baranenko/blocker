# Request Blocker

A Chrome / Chromium Manifest V3 extension for testing web applications by blocking requests or returning mock JSON responses.

## Install

1. In Chrome / Chromium 111 or later, open `chrome://extensions` and enable Developer mode.
2. Select **Load unpacked** and choose this project folder.
3. After changing extension files, reload the extension on this page.
4. Reload the web application page so the request interceptors are installed.

## Rules

- The popup opens with the saved rule list. The top **+** button opens a new rule.
- A rule contains a name, full HTTP/HTTPS URL, request method and active flag.
- Enable **Подменять ответ** to display the JSON textarea. The response must be valid JSON.
- With replacement enabled, a matching page `fetch` or `XMLHttpRequest` receives the entered JSON
	with status `200 OK` and `Content-Type: application/json; charset=utf-8`, without contacting the server.
	HEAD responses have no body. With replacement disabled, the rule blocks requests as before.
- Saving returns to the list. Cancel discards unsaved changes.
- Edit and delete are available in the list; an existing rule can also be deleted in the editor.
- The status indicator in the list toggles a rule immediately: green is active, gray is inactive.
- Rules are stored in `chrome.storage.local` and survive closing the popup and restarting the browser.

Active rules apply only in the active tab of the last focused browser window.
Switching tabs or windows moves the rules to the newly active tab; background tabs are not affected.
URLs match exactly, including query parameters and letter case, after standard URL normalization.
URL fragments are ignored because they are not sent in HTTP requests. Wildcards are not supported.
Supported methods: GET, POST, PUT, DELETE, PATCH, HEAD and OPTIONS.
The filters apply to page requests, not top-level navigation. Requests already sent are not canceled;
repeat the request or reload the page after saving a rule. Browser internal pages are not supported.

Replacement intercepts `fetch` and `XMLHttpRequest` in page JavaScript, including HTTP/HTTPS frames.
It does not replace requests from Web Workers / Service Workers, navigation or resource loading.
Requests satisfied entirely by a worker-side cache cannot be replaced. Synchronous XHR started
before the initial rule configuration arrives uses the original transport. Page scripts can inspect
the mock data and may bypass interception if they overwrite the patched APIs; this is a testing tool,
not a security boundary. Mocked requests do not appear as real network requests in DevTools.

## Verify

Run the dependency-free tests with Node.js:

```sh
node --test tests/background.test.js tests/interceptor.test.js tests/popup.test.js
```

For an end-to-end check, open your application and its DevTools Network panel. Create an active rule
using a request's exact URL and method, then repeat that request: it should fail with
`net::ERR_BLOCKED_BY_CLIENT`. Changing the method, disabling or deleting the rule should allow it.
Also check editing, canceling, reopening the popup, restarting Chrome, and switching tabs.
To check replacement, enable the response toggle and enter `{"success":true}`. Repeat the matching
request in the application: its fetch/XHR result should contain this JSON, with no server request.
