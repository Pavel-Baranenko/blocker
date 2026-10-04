# Request Blocker

A Chrome / Chromium Manifest V3 extension for testing web applications by blocking requests.

## Install

1. Open `chrome://extensions` and enable Developer mode.
2. Select **Load unpacked** and choose this project folder.
3. After changing extension files, reload the extension on this page.

## Rules

- The popup opens with the saved rule list. The top **+** button opens a new rule.
- A rule contains a name, full HTTP/HTTPS URL, request method and active flag.
- Saving returns to the list. Cancel discards unsaved changes.
- Edit and delete are available in the list; an existing rule can also be deleted in the editor.
- The status indicator in the list toggles a rule immediately: green is active, gray is inactive.
- Rules are stored in `chrome.storage.local` and survive closing the popup and restarting the browser.

Active rules block matching requests only in the active tab of the last focused browser window.
Switching tabs or windows moves the filters to the newly active tab; background tabs are not blocked.
URLs match exactly, including query parameters and letter case, after standard URL normalization.
URL fragments are ignored because they are not sent in HTTP requests. Wildcards are not supported.
Supported methods: GET, POST, PUT, DELETE, PATCH, HEAD and OPTIONS.
The filters apply to page requests, not top-level navigation. Requests already sent are not canceled;
repeat the request or reload the page after saving a rule. Browser internal pages are not supported.

## Verify

Run the dependency-free background tests with Node.js:

```sh
node --test tests/background.test.js
```

For an end-to-end check, open your application and its DevTools Network panel. Create an active rule
using a request's exact URL and method, then repeat that request: it should fail with
`net::ERR_BLOCKED_BY_CLIENT`. Changing the method, disabling or deleting the rule should allow it.
Also check editing, canceling, reopening the popup, restarting Chrome, and switching tabs.
