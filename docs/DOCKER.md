# Running Greenlit in Docker

Greenlit runs as **one compose project** (`compose.yaml` at the repository root, project name `greenlit`):

| Service   | What it is                                                                                                                                                                                | Data                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `app`     | API, background workers and the web app (`docker/Dockerfile`): Node, ffmpeg, Chromium (renders, platform sign-ins), adb                                                                   | volume `media` → `/data`                                    |
| `db`      | PostgreSQL 18                                                                                                                                                                             | volume `pgdata`                                             |
| `android` | Greenlit's Android device (`docker/android/Dockerfile`): the Android emulator, headless, with its own virtual camera, for what only a platform's Android app does (YouTube Shorts sounds) | volume `android` → `/data` (the device's accounts and apps) |
| `tunnel`  | the Cloudflare Tunnel (`docker/tunnel/Dockerfile`, Cloudflare's `cloudflared`): connects when `.env` has `CLOUDFLARE_TUNNEL_TOKEN`, idles otherwise                                       | —                                                           |

Nothing else needs setting up on the machine: no Android SDK, no emulator, no webcam, no cloudflared. The services
reach each other on the project's own network and **no port is published on the computer**: Greenlit is reachable
only through the Cloudflare Tunnel.

## First start

```bash
cp .env.example .env    # set GREENLIT_SECRET (openssl rand -hex 32), GREENLIT_PUBLIC_URL, CLOUDFLARE_TUNNEL_TOKEN
docker compose up -d --build
```

Compose reads `.env` from the repository folder by itself. The first build takes a few minutes; database migrations
run whenever the app starts. Then open the public address and create the first admin account with the **setup code**
the app prints in its log until an admin exists (whoever sets Greenlit up becomes its admin, so nobody can claim it
without access to this computer):

```bash
docker compose logs app | grep "setup code"
```

`COMPOSE_PROFILES=android` (the default in `.env.example`) runs the Android device; remove `android` on a machine
without hardware virtualization.

## Everyday use

Every service restarts by itself after a crash and whenever Docker starts. For that to include the computer's own
start, Docker itself has to start at boot (on systemd: `sudo systemctl enable docker`).

|                                    |                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------- |
| update after pulling new code      | `docker compose up -d --build` (rebuilds what changed, restarts only that) |
| what is running, and is it healthy | `docker compose ps`                                                        |
| logs                               | `docker compose logs -f app` (or `tunnel`, `db`, `android`)                |
| stop everything                    | `docker compose down` (the volumes, so all data, stay)                     |

Run them in the repository folder. Rebuilding the Android device needs `ANDROID_SDK_LICENSE` (below); without it,
`docker compose up -d --build app` updates the app alone.

## Development

Production never uses this; it is for working on Greenlit itself. `docker/compose.dev.yaml` (project
`greenlit-devstack`) holds the development database and two ways to run the code against it:

|                           |                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **on the host** (fastest) | `docker compose -f docker/compose.dev.yaml up -d` (Postgres on 127.0.0.1:54329), then `pnpm install && pnpm dev` |
| **fully in Docker**       | `docker compose -f docker/compose.dev.yaml --profile app up`                                                     |

Both serve the web app on http://localhost:4300 (Vite, hot reload) and the API on :4310 (restarts when server code
changes). The `app` service is the `dev` target of `docker/Dockerfile`: the same ffmpeg, Chromium and adb as
production, the repository bind-mounted at `/app`, its own `node_modules` volumes (so the host's are never touched)
and the unprivileged `node` user, so files it writes stay yours. Add `--profile android` for Greenlit's Android device
(adb on 127.0.0.1:15037; on the host run `GREENLIT_ANDROID_ADB=127.0.0.1:15037 pnpm dev`). Both compose files run the
same Android service (`docker/android/compose.yaml`).

## Design files (FigCraft)

The image carries FigCraft 0.18.1 (MIT OR Apache-2.0), unmodified and checked by SHA-256 when it is built
(`apps/server/src/modules/figcraft/install.ts`): its browser build in `/opt/figcraft/web`, which the viewer frames to
show and edit `.figcraft` files, and `figcraft-cli` in `/opt/figcraft/bin`, which renders their thumbnails and exports
frames. Their licences sit beside them. Outside Docker the server fetches the same browser build into
`DATA_DIR/vendor/` on its first start, and uses `figcraft-cli` from `GREENLIT_FIGCRAFT_CLI` or the `PATH` if there is
one (without it, thumbnails come from the small preview inside each file). Fonts added in Settings → Design fonts live
with the data (`DATA_DIR/figcraft/fonts`); the renderer sees only those and FigCraft's built-in ones, never the
computer's.

## Graphics card

Greenlit's own models (depth maps today) run on an NVIDIA graphics card when it has one, and on the processor
otherwise: a picture's depth map drops from about a second to a fraction of one, a video's from about half a second
per frame to about a tenth. ONNX Runtime tries CUDA, then WebGPU (Vulkan), then the processor
(`apps/server/src/lib/gpu.ts`); Settings → Depth maps says which one it uses. `GREENLIT_GPU=off` keeps it on the
processor (`cuda` or `webgpu` forces one).

In Docker it takes two things:

1. **The CUDA build of the image**, which adds ONNX Runtime's CUDA provider and the CUDA 13 libraries it loads
   (about 2.3 GB more; pinned downloads checked by SHA-256, `docker/gpu/install-cuda.ts`):
   ```bash
   docker build -f docker/Dockerfile --build-arg GPU=cuda -t greenlit:latest .
   ```
   (`docker compose up -d --build` does this by itself with the file below.) The CUDA build still runs on the
   processor wherever no card is passed in.
2. **The card passed in**, through NVIDIA's container toolkit (installed as for the Android device, below) and
   `docker/compose.gpu.yaml`: `-f compose.yaml -f docker/compose.gpu.yaml`, or in `.env`
   ```bash
   COMPOSE_FILE=compose.yaml:docker/compose.gpu.yaml
   ```
   (with the Android device on the card too: `compose.yaml:docker/compose.gpu.yaml:docker/android/compose.nvidia.yaml`).

CUDA 13 needs an NVIDIA driver from 580 on. Outside Docker (`pnpm dev`), WebGPU uses the card through its Vulkan
driver with nothing to install.

## Cloudflare Tunnel

1. In Cloudflare (Zero Trust → Networks → Tunnels) create a tunnel of the _Cloudflared_ kind and copy its token
   into `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
2. Add a public hostname to the tunnel (e.g. `greenlit.example.com`) with the service **`http://app:8080`**: `app`
   is the app's name on the compose network, which the tunnel container is on.
3. Set `GREENLIT_PUBLIC_URL` to that address (`https://greenlit.example.com`; a bare host name gets `https://`
   added) and run `docker compose up -d`.

`docker compose ps` shows the tunnel _healthy_ once it has a connection to Cloudflare; `docker compose logs tunnel`
shows the hostnames it serves. The tunnel only goes out to Cloudflare, so nothing on the machine or the router has
to be opened. What Greenlit does for Cloudflare: uploads go in 48 MB pieces (Cloudflare refuses requests over
100 MB), media answers are `private` so Cloudflare never caches them for someone else, the live-update socket
pings every 30 s (Cloudflare closes quiet WebSockets after about 100 s), and sign-in cookies are `Secure` behind
https.

## The Android device

- **Needs** `/dev/kvm` (hardware virtualization) on the host; the service gets it as a device.
- **GPU**: the device draws in software (the emulator's ANGLE renderer on SwiftShader's Vulkan, `swangle_indirect`)
  unless it has an NVIDIA GPU, which makes it much smoother.
  The emulator's own `host` renderer draws with GLX and needs an X display, which the container has none of; so on
  NVIDIA the device draws through the emulator's ANGLE renderer (OpenGL ES on Vulkan) on NVIDIA's Vulkan driver,
  headless (the start script points the emulator's SwiftShader driver file at NVIDIA's). Mesa (Intel, AMD) gives the
  emulator no display without X, so those stay in software. To use an NVIDIA card:
  1. Install NVIDIA's container toolkit on the machine and let Docker use it (Arch / CachyOS shown):

     ```bash
     sudo pacman -S nvidia-container-toolkit
     sudo nvidia-ctk runtime configure --runtime=docker
     sudo systemctl restart docker
     ```

  2. Add `docker/android/compose.nvidia.yaml` to the compose files (`-f compose.yaml -f
     docker/android/compose.nvidia.yaml`, or `COMPOSE_FILE=compose.yaml:docker/android/compose.nvidia.yaml` in
     `.env`); Docker refuses it on a machine without the toolkit.

  `ANDROID_GPU=auto` (default) then picks the card at every start (the driver's EGL is in the container); `host`
  forces the GPU, `software` the software renderer (`swiftshader`: SwiftShader's own OpenGL ES, `swiftshader_indirect`,
  which crashed the whole emulator — exit 139 — on the Play Store's app pages every time). A start on the GPU that
  never got Android booted is stopped after 4 minutes and leaves `/data/home/.gpu-host-failed`: later starts stay
  in software until it is deleted. In software, Vulkan is off in the guest (Instagram's GPU probe crashed the
  emulator's software Vulkan).
- **Camera**: the emulator's own emulated camera (`ANDROID_CAMERA=emulated`, or `virtualscene` for its 3-D room).
  Nothing of the host's (no webcam, no v4l2loopback).
- **Image**: Android 13 with Google APIs (x86_64) — Google sign-in works and, unlike the Play Store images, it can
  be rooted, which recording an app's requests and reading an app's own token need. `ANDROID_RAM_MB` and
  `ANDROID_CORES` size it (4 GB, 4 cores by default).
- **Play Store and Google Play services**: the device has the Play Store, so apps update like on a phone (YouTube
  refuses versions it no longer supports, _Precondition check failed_, and asks for a newer Google Play services
  before it lets you sign in). The Google APIs image has no Play Store, only a stub of that name (`LicenseChecker`),
  and its Google Play services and Services Framework are signed with Google's _development_ key, while the Play
  Store is signed with Google's release key; every app that uses Play services checks that the Play Store and Play
  services share a key and refuses to run when they do not. So on the device's first start the three come
  together from Google's Play image of the same Android version (it boots on its own for a minute, the apps'
  folders and their privileged permissions are copied to `/data/apps`, and the Play image is deleted again), and
  replace the image's own on the device's system. The system is therefore always started writable
  (`-writable-system`; the changes are kept in the device's folder in the volume, the system image itself is not
  touched). The device's data stays through the swap: Android keeps an app's data when its system copy changes key
  and drops an update made with the old key, which the Play Store replaces (it updates itself and Google Play
  services within a minute of the swap). Root works as before. The image's other Google apps keep their
  development-key copies; Google Partner Setup, which writes to the Services Framework's settings and would crash
  at every start without that key, is turned off (it only sets partner ids). A device made before this (with the
  stub) gets the same on its next start: the Play image is fetched again (about 1.7 GB) for it.
- **The device view** asks for raw frames (`screencap` without PNG: about 0.12 s instead of 0.5 s for the device to
  encode a PNG) and makes a 720 px JPEG of each on the server, about 0.16 s a frame in all.
- **Signing in to apps**: Settings → Connected accounts → _Android device_ shows the device's screen in Greenlit
  (taps, swipes, typing), so nothing opens on the machine itself. What you type goes to the device only and is
  never logged. For YouTube Shorts sounds, sign in to the YouTube app with the Google account that manages the
  channels; Greenlit then sends the app's requests itself with the app's token (`docs/CONNECTORS.md`, _The
  platforms' Android apps_) and starts the app now and then so Google renews it.
- **Access**: an adb server on the compose network (`android:5037`, `GREENLIT_ANDROID_ADB` in the app). It is not
  published on the host in production.
- **Building it** downloads Google's SDK command-line tools, the emulator and platform-tools from Google's Android
  SDK repository (`dl.google.com`, about 700 MB). The system images are fetched on the device's **first start**,
  into its volume (about 3 GB of downloads, kept as sparse files), so that start takes several minutes; later
  starts take about a minute. Those packages are under Google's **Android SDK
  License**; the build does not accept it for you. Accept it once on the building machine
  (`sdkmanager --licenses`) and pass the accepted hash:

  ```bash
  ANDROID_SDK_LICENSE=$(cat ~/Android/Sdk/licenses/android-sdk-license)   # or set it in .env
  ```

- **Recording an app's requests** (how Greenlit learns what an app sends): the image carries mitmproxy. Run it in
  the container on 127.0.0.1:8080 (the device reaches it as 10.0.2.2:8080), trust its certificate for one boot (a
  tmpfs over `/system/etc/security/cacerts` with it added, as root), set the device's proxy (`settings put global
  http_proxy 10.0.2.2:8080`) and block QUIC (`iptables -I OUTPUT -p udp --dport 443 -j DROP`); undo all of it
  afterwards: `settings delete global http_proxy` and also `global_http_proxy_host` and `global_http_proxy_port`,
  which setting it writes too, then restart Android (`adb reboot`); a proxy left behind survives restarts and keeps
  the apps offline. Keep the raw flows inside the
  container only: they hold the sign-ins' tokens. Apps that pin their certificates refuse the recorder: Instagram
  was recorded with Frida attached to the running app (never spawned through the zygote) turning its own
  certificate check off in memory for that run only, nothing written to the app; the emulator's earlier crashes
  under Frida came from Instagram's Vulkan probe, which `-feature -Vulkan` (software) and the GPU mode avoid.
- **A crashed emulator** leaves its locks behind; the entrypoint clears them before starting.

## Backups

```bash
docker compose exec db pg_dump -U greenlit greenlit | gzip > greenlit.sql.gz
docker run --rm -v greenlit_media:/data -v "$PWD":/out alpine tar czf /out/greenlit-media.tgz -C /data .
```
