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
