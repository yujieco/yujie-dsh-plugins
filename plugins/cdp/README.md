# yujie-dsh-plugin-cdp

Drive Chrome or Edge over the Chrome DevTools Protocol from inside DeepSeek Harness:
open pages, read them as structured snapshots or text, click and type, collect
console errors and uncaught exceptions, and watch the live screen in the right
sidebar.

## How the agent sees the page

Two independent channels, and the cheap one comes first:

- **Structure (default).** `browser_snapshot` walks the live DOM, open shadow
  roots, and same-origin iframes, and returns every interactive element with a
  stable ref (`r1`, `r2`, …), role, accessible name, click coordinates, and
  current value. `browser_read` returns readable text. Addressing an element never
  needs pixels.
- **Pixels (on demand).** `browser_screenshot` returns the viewport, one element,
  the whole page, or numbered vertical slices, with an optional coordinate grid.
  Use it to verify a result, to look at canvas/WebGL/PDF content, or to reason
  about layout.

`browser_navigate` and `browser_click` therefore return text by default; ask for
an image when you actually want to look.

## Tools

| Tool | Purpose |
|---|---|
| `browser_launch` | Start a controlled browser with its own profile, or attach to one that already exposes a DevTools port. |
| `browser_pages` | List, open, select, close pages. |
| `browser_navigate` | Go to a URL and wait for load or network idle. |
| `browser_snapshot` | Interactive elements with refs, roles, names, coordinates, values (shadow DOM and same-origin iframes included). |
| `browser_read` | Readable text of the page or one element, without an image. |
| `browser_screenshot` | Viewport, element, full page, or slices; optional 100 px coordinate grid. |
| `browser_click` | Click by ref, CSS selector, or viewport coordinates. |
| `browser_type` | Focus an element, type text, optionally clear first and press Enter. |
| `browser_console` | Console messages, uncaught exceptions, failed requests, dialogs. |
| `browser_evaluate` | Evaluate JavaScript and return the value. |
| `browser_open_dsh` | Open this Harness GUI in the controlled browser with a valid access token. |
| `browser_close` | Close the controlled browser and drop its connection and collected errors. |

Typical loop: `browser_launch` → `browser_navigate` → `browser_snapshot` →
`browser_click ref=r7` → `browser_console level=error` when something breaks.

## Visible control

The browser is meant to be watched, not hidden:

- Launching with `headless: false` (the default) opens a real Chrome/Edge window and
  brings it to the front. `--enable-automation` is on by default, so the window
  shows the browser's own "controlled by automated test software" banner.
- `browser_click` moves a visible agent cursor to the target first (blue arrow with
  a glow), then dispatches the click, then draws a short ripple and a `click`
  label. `browser_type` does the same before focusing the field.
- `config.showCursor: false` turns the overlay off; `config.automationBanner: false`
  removes the banner; `config.cursorMoveMs` changes the travel time (default 260 ms).

The overlay lives in a fixed, `pointer-events: none` layer, so it never changes what
the page can hit or what a snapshot sees.

## Right-sidebar panel

The host half serves two read-only endpoints for the panel:

- `GET /plugin/cdp/state?session=<id>` — connection, pages, last five errors.
- `GET /plugin/cdp/shot?session=<id>&w=720` — current viewport as PNG.

The client half registers a right-sidebar tab (`cdpBrowser`) plus a session-header
button that opens it. The tab polls once every two seconds while it is mounted and
never launches a browser by itself: it only shows a session that already exists.

Because the Web client's module graph is built when the app starts, a freshly
installed client half appears after one restart of DeepSeek Harness; the tools and
endpoints are live immediately.

## Install

Install the directory as a bundle from the Plugins page, or with `plugin_manager`
`install_bundle` and this directory as the target. The bundle inserts one Host row
named `yujie-dsh-plugin-cdp`.

## Configuration

Every field has a default; set them on the row's `config` mapping in
`cordis.patch.yml`.

| Field | Default | Meaning |
|---|---|---|
| `browser` | `auto` | `auto`, `chrome`, or `edge`. |
| `headless` | `false` | Run without a visible window. |
| `port` | `0` | DevTools port; 0 picks a free port and reads it from the profile. |
| `userDataDir` | empty | Profile directory; empty uses `DSH_HOME/cdp-browser-profiles/<browser>`. |
| `noSandbox` | `false` | Add `--no-sandbox`; only needed when the plugin itself runs inside an outer sandbox. |
| `disableExtensions` | `true` | Start without extensions. |
| `automationBanner` | `true` | Show the browser's "controlled by automated software" banner. |
| `showCursor` | `true` | Draw the visible agent cursor, animate it to each click, ripple on click. |
| `cursorMoveMs` | `260` | Cursor travel time before a click, in milliseconds. |
| `autoScreenshot` | `false` | Return a screenshot after navigate and click. Off: structure first. |
| `autoScreenshotMaxWidth` | `1024` | Downscale automatic screenshots and panel frames to this width. |
| `maxCaptureHeight` | `4000` | Cap a single full-page screenshot height. |
| `sliceHeight` | `2400` | Height of one slice in a sliced full-page capture. |
| `maxSlices` | `6` | Maximum slices returned per call. |
| `commandTimeoutMs` | `20000` | CDP command deadline. |
| `navigationTimeoutMs` | `20000` | Navigation load deadline. |
| `launchTimeoutMs` | `20000` | Browser startup deadline. |
| `clickSettleMs` | `120` | Pause after input before reading the page. |
| `collectNetwork` | `true` | Collect failed requests. |
| `autoAcceptDialogs` | `true` | Answer JavaScript dialogs automatically. |
| `maxEvents` | `500` | Retained console and error entries per session. |
| `maxSnapshotNodes` | `150` | Default element cap for `browser_snapshot`. |
| `maxConsoleLines` | `50` | Default entry cap for `browser_console`. |
| `sharing` | `perSession` | `perSession` gives each agent its own browser; `shared` reuses one. |

## How it works

- **One browser per agent session.** The hub keeps a browser-level CDP websocket,
  attaches each tab with `Target.attachToTarget(flatten: true)`, and sends every
  command with that tab's session id.
- **Refs survive shadow roots and frames.** The snapshot stores the real element
  objects in a page-side map and later resolves refs through it; measurement walks
  out of same-origin frames so the reported coordinates are top-level viewport
  coordinates.
- **Errors are collected, not polled.** `Runtime.exceptionThrown` (unhandled
  promise rejections included), `Runtime.consoleAPICalled`, `Log.entryAdded`, and
  `Network.loadingFailed` feed a bounded ring buffer with incrementing ids, so
  `browser_console` can return only what is new (`sinceId`).
- **Profiles are isolated.** The plugin never opens the profile a human uses, a
  stale `DevToolsActivePort` is ignored unless its port answers, and a profile
  already owned by a live browser is reused instead of duplicated.

## Security notes

- The DevTools port has **no authentication**. It binds `127.0.0.1` only, uses an
  ephemeral port by default, and is closed when the session is disposed — but any
  local process that reaches it can drive the browser. Do not forward it.
- The panel endpoints are loopback-only and unauthenticated like the rest of the
  local web surface: they expose a screenshot and a page list to local processes.
- The plugin's browser profile is separate from the human's browser. It keeps its
  own cookies and logins; clearing it means deleting the profile directory.
- `browser_evaluate` runs arbitrary JavaScript in the page. `noSandbox` weakens the
  browser's own process isolation; leave it off outside sandboxed test hosts.
