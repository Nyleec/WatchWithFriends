# Watch With Friends - LG App Mock

This is a small mock of an LG TV app interface for watching videos with friends. It includes:

- Video player area
- Friends presence list (who's watching)
- Chat box for messaging

How to run locally:

1. Open the folder in a lightweight static server (recommended) or open `index.html` directly in a browser.

Quick start (static site):

```bash
cd /Users/Nyleec/Desktop/WatchWithFriends
python3 -m http.server 8000
# Then open http://localhost:8000 in your browser
```

Quick start (run the WebSocket server for real-time chat/presence):

```bash
cd /Users/Nyleec/Desktop/WatchWithFriends
npm install
npm start
# The WebSocket server listens on port 3000 by default
```

Notes:
- This project now includes a simple Node.js WebSocket server (`server.js`) that manages presence and broadcasts chat and control messages.
- `app.js` will try to connect to `ws://<host>:3000` for real-time features. When running locally, open two browser tabs at `index.html` to test presence and chat.
- `webos.js` contains lightweight hooks to listen for webOS/back keys and can be expanded to call webOS system APIs when packaging as a real LG app.
 - `webos.js` now includes a `MediaService` wrapper that calls `webOS.service.request` when available to perform `play`, `pause`, `seek`, and `setVolume` actions. `app.js` maps common remote keys to playback controls and will try to use the system media service when running on webOS.

Packaging notes for LG webOS:

 - To package as a webOS app you'll need an `appinfo.json` manifest and to follow LG's packaging/signing steps. See LG developer docs for details.
 - When running on a real TV the `webOS.service.request` endpoints (e.g. `luna://com.webos.media`) will be available; `webos.js` safely falls back for desktop testing.

Playback sync and packaging helpers

- Playback sync: the server now aggregates periodic `timeUpdate` messages from clients and broadcasts a `time-correction` (average) every 5s. Clients send their current playback time every 2s and apply corrections smoothly (playbackRate nudge for small drift, seek for large drift).
 - Playback sync: the server now aggregates periodic `timeUpdate` messages from clients and broadcasts a `time-correction` every 5s. The algorithm prefers a host (leader) if one is claimed. If there's no host the server computes a median of reported times (median is less influenced by outliers than average).

	Leader (Host) behavior:
	- Any client can click `Claim Host` to become the authoritative leader; the server sets that client as host and broadcasts `host-changed`.
	- When a host is present the server uses the host's reported time as the authoritative time for corrections.
	- Hosts can `Release Host` to relinquish leadership.

- Packaging: a minimal packaging helper `package-webos.sh` is included. It zips the project into `dist/watchwithfriends.wgt` as a placeholder. For real packaging use the `ares` CLI:

```bash
# install webOS CLI (if needed)
# npm install -g ares-cli
# Package and install to a device (example)
ares-package .
ares-install <package>.wgt -d <device>
```

Place a proper `icon.png` (512x512) at the project root — `icon.svg` is provided as a placeholder and can be converted to PNG via `convert icon.svg icon.png` (ImageMagick).
