# 🎬 Cyber Hongdae (사이버 홍대입구)

**[한국어 README](README.md)**

A 3D **online watch-party space** that recreates the 10th-floor lobby of LOTTE CINEMA Hongik Univ. (Hongdae) in Seoul and its **Screen 4 "Kwang-eum Cinema"**.

The host opens a server from their own PC with one click. Friends then **just open a link in their browser**, with no install, and walk in as a character. Everyone watches the same movie in sync, chats, waves light sticks and sits in theater seats.

![Screen 4](docs/images/theater.jpg)

| Lobby | Screen 4 entrance |
|---|---|
| ![Lobby](docs/images/lobby.jpg) | ![Entrance](docs/images/entrance.jpg) |

| Host dashboard – Server | Host dashboard – Playlist |
|---|---|
| ![Dashboard](docs/images/dashboard_home.png) | ![Playlist](docs/images/dashboard_media.png) |

---

## ✨ Features

- **3D cinema** built procedurally with a Blender script.
  - **Screen 4**: big screen, purple-LED subwoofer cubes, stone acoustic walls with up-lights, graffiti mural, 190 stadium seats.
  - **Lobby**: snack bar with menu boards, kiosks, window bar, lobby LED wall, poster light boxes, baby-seat shelf, entrances to Screens 5 and 6, restroom.
- **Synchronized playback**: everyone sees the same frame, and late joiners catch up automatically.
- **Almost any video source**
  - Local files and folders.
  - YouTube videos and playlists, Google Drive files and folders.
  - Live streams: Twitch, CHZZK, SOOP, YouTube Live.
  - Direct mp4/m3u8 links, Dropbox links.
  - Self-hosted web server directory listings.
  - Any of the thousands of sites yt-dlp supports.
- **Subtitles**: SMI (CP949 auto-detected), SRT, VTT, ASS/SSA (position, color, alignment). Embedded MKV subtitles and YouTube captions are attached automatically.
- **Automatic transcoding**: formats browsers can't play (HEVC, 10-bit, AC3, AVI, …) are converted with ffmpeg, using NVENC if available.
- **5 original avatars**, made from scratch in code (clean-room), in the K-ON! members' theme colors. You can switch at entry or in settings.
- **Random nicknames** such as `유이3421` or `리츠1346`, assigned on every join to prevent cliques.
- **King-Blade-style light sticks** in 5 colors, with a wave animation.
- **Emotes**: wave, clap, banzai, bow, dance, fighting, air guitar, air drums, and more.
- **Sit in any seat** for an audience point of view.
- **Host dashboard (GUI)**
  - One-click server.
  - Playlist control.
  - Kick, ban and mute; announcements.
  - Lobby LED video; Screen 4 sign text.

---

## 💾 Installation (Windows)

1. **Install Node.js**: get the **LTS** version from <https://nodejs.org> and keep clicking *Next*.
2. **Download this project**: click **`<> Code` → Download ZIP** and extract it to a simple path such as `D:\cyberhongdae`. Alternatively:

   ```bash
   git clone https://github.com/cailet0422/cyber-hongdae.git
   ```

3. **Double-click `처음 설치.bat`** ("first-time setup"). It does the following:
   - installs the npm packages;
   - prepares Electron;
   - downloads ffmpeg, yt-dlp and cloudflared from their official sources into `tools/bin`;
   - creates a desktop shortcut called **「사이버 홍대입구 관리자」** (the host dashboard).

> If Windows SmartScreen appears, click **More info → Run anyway**.

---

## 🚀 Opening the server

1. Start **「사이버 홍대입구 관리자」** from the desktop.
2. Pick an exposure mode. The default is fine for a first try.
3. Click **🚀 서버 열기** (*Open server*).
4. After about 10 seconds a public URL appears. Click **📋 주소 복사** (*Copy*) and send it to your friends. A QR code is shown for phones.
5. Click **🎮 내 브라우저로 입장** (*Enter in my browser*) to join yourself.

| Mode | Setup | Address | Your IP exposed? |
|---|---|---|---|
| **Internet (Cloudflare Quick Tunnel)** – default | none | changes every time (`*.trycloudflare.com`) | ❌ hidden |
| **Tailscale Funnel** | Tailscale installed and logged in | **fixed** (`https://<pc>.<tailnet>.ts.net`) | ❌ hidden |
| **Auto port-forward (UPnP)** | router with UPnP | `http://<your-ip>:7777` | ⚠️ yes |
| **Same Wi-Fi only** | none | `http://192.168.x.x:7777` | LAN only |

### Tailscale Funnel (hide your IP, fixed address)

1. Install Tailscale from <https://tailscale.com/download> and log in.
2. In <https://login.tailscale.com/admin/dns>, enable **MagicDNS** and **HTTPS Certificates**.
3. Choose **Tailscale Funnel (IP 숨김)** in the dashboard and open the server.
4. If you see "Funnel is disabled on this tailnet", click **🔗 허용 페이지 열기** (*open approval page*), approve once, and retry.

Funnel runs in the foreground, so closing the server removes the Funnel config automatically. Other Tailscale settings are left untouched. The first free Funnel port among 443, 8443 and 10000 is picked automatically. Viewers do **not** need Tailscale.

---

## 🎞 Playing videos

In the **🎬 상영 관리** (*Playlist*) tab:

- **Add files or folders** with the buttons, or drag and drop. Subtitles with the same base name (`movie.mp4` + `movie.smi`) are attached automatically.
- **Paste links** (one per line) and click **🔗 링크 추가** (*Add link*).
  - *Download first* (default) is the most stable and gives the best quality.
  - *Stream directly* starts instantly. Live streams always use this mode.
- **Playback controls**: play/pause, previous/next, stop, seek bar (moves everyone), and loop mode (all / one / none). Reorder with ↑↓. Double-click a title to rename it. Pick or add a subtitle per item.

## 📺 Signs

- **Screen 4 entrance sign**: hall name, floor, title (auto = currently playing), messages in Korean and English, text color, clock, background image. A live preview is shown.
- **Lobby LED wall**: loops a video, image or link. With nothing selected it shows a poster slideshow and now-playing info.

## 👮 Moderation

- **Users tab**: nickname, avatar, IP, seat and join time, with **Mute chat**, **Kick** and **Ban** (by IP and device). Bans can be lifted from the ban list.
- **Chat tab**: live chat, 📢 announcements, slow mode, disable or clear chat.
- **Settings tab**: server name, max users, max video quality, nickname name pool, light-stick colors.

## 🎮 Viewer controls

| Key | Action |
|---|---|
| WASD / arrows | move (Shift run, Space jump) |
| Mouse drag / wheel | rotate camera / zoom |
| E | sit in the nearest seat / stand up |
| F / C / X | light stick on-off / color / wave |
| G | emotes |
| V | first / third person |
| Enter | chat |
| Esc | settings (avatar, volume, subtitle size, graphics quality, …) |

On phones, use the on-screen joystick and the **E** button. If there is no sound, click the red banner. Browser autoplay policies require one click.

---

## 🧸 Optional: using an MMD model pack

The default avatars are **original, clean-room avatars generated in code**, so they are license-free.

If you own a K-ON! MMD (PMD) model pack that you downloaded yourself, you can use it instead:

1. Put the pack folder (`Yui Hirasawa`, `Mio Akiyama`, … and optionally `character poses`) inside a `kakomiki k-on models` folder at the repository root.
2. Run the conversion:

   ```bash
   cd app
   node scripts/prepare-assets.js
   ```

3. Reopen the server. PMD models are used, and if pose files are present, per-character pose emotes with instruments appear.

These models' terms forbid redistribution, so they are **not** included here and are ignored by `.gitignore`.

---

## ❓ Troubleshooting

- **Lag when many people join**: every viewer streams the video from the host PC. 1080p needs about 5 Mbps per viewer, so 30 viewers need about 150 Mbps of upload. Set the max quality to 720p in Settings.
- **"Port already in use"**: change the port, for example to 7778.
- **YouTube fails**: update yt-dlp from `tools\bin`:

  ```bash
  yt-dlp.exe -U
  ```

- **Dashboard won't start**: in `app`, run:

  ```bash
  node scripts/fix-electron.js
  ```

- **Headless server**: run `서버만 실행 (GUI 없이).bat`. A local-only web dashboard is available at `http://localhost:7777/admin?token=local-admin`.

## 🛠 For developers

```bash
cd app
npm start                                   # dashboard
node server/standalone.js --port 7777 --expose tunnel|tailscale|upnp|lan --admin-token SECRET
node scripts/bots.js 80 ws://localhost:7777/ws 60   # load test (80 bots ≈ 130 fps on the client)
```

| Part | What it does |
|---|---|
| `app/server/index.js` | HTTP and WebSocket server, video proxy with HLS rewriting |
| `app/server/media.js` | yt-dlp and ffmpeg pipeline |
| `app/server/playback.js` | server-clock synchronized playback |
| `app/server/subtitles.js` | subtitle parsers |
| `app/server/tunnel.js` | Cloudflare, Tailscale Funnel and UPnP exposure |
| `app/client/` | Three.js r168 client, no bundler |
| `app/client/js/procedural-avatar.js` | original avatar generator, using MMD bone names |
| `app/blender/build_cinema.py` | map generator (Blender 4.2) |

Rebuild the map:

```bash
cd app/blender
python make_textures.py
python compose_ai.py
blender -b -P build_cinema.py -- --render
```

## 📜 License & notices

- **Code and original assets** (original avatars, map build scripts, generated textures) are released under the [MIT License](LICENSE).
- This is a **non-commercial fan project** and is **not affiliated** with LOTTE Cinema / LOTTE Cultureworks or with the creators and producers of *K-ON!*. "LOTTE CINEMA", "Sweet#", "광음시네마" and *K-ON!* are names and trademarks of their respective owners.
- The movie posters in `poster/` are copyrighted by their respective owners and are used on the poster light boxes in the map.
- Photo and illustration textures (sign backgrounds, graffiti, night city, menu photos, carpet and stone tiles, fictional posters) were generated with OpenAI Codex (gpt-6.1-sol).
- MMD models (kakomiki) and their pose files are **not included** because their terms forbid redistribution.
- **Libraries**: three.js (MIT), three-mesh-bvh (MIT), hls.js (Apache-2.0), Express (MIT), ws (MIT), Electron (MIT), iconv-lite (MIT), qrcode (MIT), nat-api (MIT).
- **Tools downloaded at setup time**: ffmpeg (LGPL/GPL), yt-dlp (Unlicense), cloudflared (Apache-2.0), Tailscale.
