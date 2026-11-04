# yujie-dsh-plugin-cdp

Drive Chrome or Edge over the Chrome DevTools Protocol from inside DeepSeek Harness:
open pages, look at the screen as an image, click and type, and read the console,
uncaught exceptions, failed requests, and dialogs of the page.

## What the model gets

| Tool | Purpose |
|---|---|
| `browser_launch` | Start a controlled browser with its own profile, or attach to one that already exposes a DevTools port. |
| `browser_pages` | List, open, select, close pages. |
| `browser_navigate` | Go to a URL, wait for load or network idle, return a screenshot. |
| `browser_screenshot` | Capture the viewport, the full page, or one element as an image. |
| `browser_snapshot` | List interactive elements with stable refs (`r1`, `r2`, …), roles, names, and click coordinates. |
| `browser_console` | Read collected console messages, uncaught exceptions, failed requests, and dialogs. |
| `browser_click` | Click by ref, CSS selector, or viewport coordinates. |
| `browser_type` | Focus an element, type text, optionally clear first and press Enter. |
| `browser_evaluate` | Evaluate JavaScript and return the value. |
| `browser_open_dsh` | Open this Harness GUI in the controlled browser with a valid access token. |
| `browser_close` | Close the controlled browser and drop its connection and collected errors. |

The typical loop is: `browser_navigate` → look at the returned image (or
`browser_snapshot` for the element list) → `browser_click` with a ref → read
`browser_console` when the page misbehaves.

## Install

Install the directory as a bundle from the Plugins page, or with
`plugin_manager` `install_bundle` and this directory as the target. The bundle
inserts one Host row named `yujie-dsh-plugin-cdp`.

## Configuration

Every field has a default; override them in the row's `config` in
`cordis.patch.yml`.

| Field | Default | Meaning |
|---|---|---|
| `browser` | `auto` | `auto`, `chrome`, or `edge`. |
| `headless` | `false` | Run without a visible window. |
| `port` | `0` | DevTools port; 0 picks a free port and reads it from the profile. |
| `userDataDir` | empty | Profile directory; empty uses `DSH_HOME/cdp-browser-profiles/<browser>`. |
| `noSandbox` | `false` | Add `--no-sandbox`; only needed when the plugin itself runs inside an outer sandbox. |
| `disableExtensions` | `true` | Start without extensions. |
| `autoScreenshot` | `true` | Return a screenshot after navigate and click. |
| `autoScreenshotMaxWidth` | `1024` | Downscale automatic screenshots to this width. |
| `maxCaptureHeight` | `4000` | Cap a full-page screenshot height. |
| `commandTimeoutMs` | `20000` | CDP command deadline. |
| `navigationTimeoutMs` | `20000` | Navigation load deadline. |
| `launchTimeoutMs` | `20000` | Browser startup deadline. |
| `clickSettleMs` | `120` | Pause before the post-click screenshot. |
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
- **The screen comes back as an image.** Screenshots are stored through the
  attachment service and returned as an image block, the same path `read_image`
  uses. When the current model route does not accept image input, the PNG lands in
  `$TMPDIR/dsh-cdp/shots/` and the tool returns the path instead.
- **Errors are collected, not polled.** `Runtime.exceptionThrown` (including
  unhandled promise rejections), `Runtime.consoleAPICalled`, `Log.entryAdded`, and
  `Network.loadingFailed` feed a bounded ring buffer with incrementing ids, so
  `browser_console` can return only what is new (`sinceId`).
- **Profiles are isolated.** The plugin never opens the profile a human uses, and a
  stale `DevToolsActivePort` file from an earlier run is ignored unless its port
  answers.

## Security notes

- The DevTools port has **no authentication**. It binds `127.0.0.1` only, uses an
  ephemeral port by default, and is closed when the session is disposed — but any
  local process that reaches it can drive the browser. Do not forward it.
- The plugin's browser profile is separate from the human's browser. It keeps its
  own cookies and logins; clearing it means deleting the profile directory.
- `browser_evaluate` runs arbitrary JavaScript in the page. `noSandbox` weakens the
  browser's own process isolation; leave it off outside sandboxed test hosts.
