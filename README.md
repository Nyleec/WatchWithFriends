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

Loading videos from S3 / CDN

- The server exposes a simple endpoint `/video-url?key=<object-key>` that will return either a CDN URL (if `CDN_BASE_URL` is set) or a presigned S3 URL (if `S3_BUCKET` is configured).
- Environment variables (see `.env.example`):
	- `CDN_BASE_URL` (optional): base URL of your CDN distribution (CloudFront). If set, server returns `CDN_BASE_URL/<key>` directly.
	- `S3_BUCKET` and AWS credentials (optional): if CDN is not provided, the server will generate a presigned S3 URL.

Usage in the UI:
1. Enter the S3 object key or path (e.g. `videos/movie.mp4`) in the `Load From S3/CDN` input and click the button.
2. Client requests `/video-url?key=...` and sets the returned URL as the video's `src`.

Security note: For production don't expose S3 presign endpoints without auth — generate presigned URLs from a trusted backend and include short expiry times.

Authentication and uploads

- Endpoints added:
	- `POST /register` {name,email,password} — creates a user and returns a JWT token.
	- `POST /login` {email,password} — returns a JWT token.
	- `POST /presign-upload` {key,contentType} — returns a presigned PUT URL for direct browser upload (requires Authorization: Bearer <token>).

- Client UI: a login/register modal is shown on first load. The JWT is stored in `localStorage` and sent when requesting upload presigned URLs.

Upload flow example (client-side):
1. User authenticates and obtains a JWT.
2. Client requests `POST /presign-upload` with `{key: 'videos/new.mp4'}` and Authorization header.
3. Server returns a presigned PUT URL. Client performs an HTTP PUT of the file directly to S3.
4. After upload, the client can call `/video-url?key=videos/new.mp4` to get the playable URL.

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
