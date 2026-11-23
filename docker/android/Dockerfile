# Greenlit's Android device: the Android emulator, headless, with its own virtual camera, for what only a platform's
# Android app does (YouTube Shorts sounds). Runs as the `android` service of compose.yaml.
#
#   Needs /dev/kvm on the host (hardware virtualization).
#   The Android SDK packages are under Google's Android SDK License. The build does not accept it: it uses the
#   acceptance already made on the building machine, passed as ANDROID_SDK_LICENSE (the hash sdkmanager --licenses
#   wrote to ~/Android/Sdk/licenses/android-sdk-license — see docs/DOCKER.md).

# ── the SDK packages, from Google's Android SDK repository ─────────────────────
FROM debian:trixie-slim AS sdk
RUN apt-get update && apt-get install -y --no-install-recommends \
      openjdk-21-jre-headless unzip curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ARG CMDLINE_TOOLS=commandlinetools-linux-16111833_latest.zip
RUN curl -fsSL "https://dl.google.com/android/repository/${CMDLINE_TOOLS}" -o /tmp/tools.zip \
    && mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools" \
    && unzip -q /tmp/tools.zip -d "$ANDROID_SDK_ROOT/cmdline-tools" \
    && mv "$ANDROID_SDK_ROOT/cmdline-tools/cmdline-tools" "$ANDROID_SDK_ROOT/cmdline-tools/latest" \
    && rm /tmp/tools.zip
ARG ANDROID_SDK_LICENSE
RUN if [ -z "$ANDROID_SDK_LICENSE" ]; then \
      echo "Set ANDROID_SDK_LICENSE to the Android SDK License hash you accepted (sdkmanager --licenses)"; exit 1; fi \
    && mkdir -p "$ANDROID_SDK_ROOT/licenses" \
    && printf '\n%s' "$ANDROID_SDK_LICENSE" > "$ANDROID_SDK_ROOT/licenses/android-sdk-license"
RUN "$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_SDK_ROOT" "emulator" "platform-tools"

# ── the device ──────────────────────────────────────────────────────────────
FROM debian:trixie-slim
# What the emulator needs headless (software GL, no audio device), adb's server, and Java for Google's sdkmanager
# (the system images are fetched on the first start, into the device's volume).
RUN apt-get update && apt-get install -y --no-install-recommends \
      openjdk-21-jre-headless unzip util-linux \
      libgl1 libegl1 libgbm1 libdrm2 libpulse0 libasound2t64 libnss3 libnspr4 libdbus-1-3 libbsd0 \
      libfontconfig1 libfreetype6 libx11-6 libx11-xcb1 libxcb1 libxext6 libxcomposite1 libxcursor1 libxdamage1 \
      libxfixes3 libxi6 libxrandr2 libxrender1 libxtst6 libxkbfile1 libxkbcommon0 libxkbcommon-x11-0 \
      libxcb-cursor0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 libxcb-randr0 libxcb-render-util0 \
      libxcb-shape0 libxcb-xfixes0 libxcb-xinerama0 libxcb-xkb1 libtinfo6 libunwind8 \
      tini ca-certificates curl procps \
    && rm -rf /var/lib/apt/lists/*
# Mesa's drivers, for rendering on the machine's GPU when the container is given one (/dev/dri: Intel, AMD); the
# emulator falls back to its software renderer without (entrypoint.sh, ANDROID_GPU).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libegl-mesa0 libgl1-mesa-dri libglx-mesa0 libgles2 libvulkan1 mesa-vulkan-drivers \
    && rm -rf /var/lib/apt/lists/*
# mitmproxy (its own release binaries, mitmproxy.org) for recording an app's requests once: how Greenlit learns them.
ARG MITMPROXY_VERSION=12.3.1
RUN curl -fsSL "https://downloads.mitmproxy.org/${MITMPROXY_VERSION}/mitmproxy-${MITMPROXY_VERSION}-linux-x86_64.tar.gz" \
      | tar -xz -C /usr/local/bin mitmdump \
    && mitmdump --version | head -1
# The SDK the emulator reads is in the volume (/data/sdk): the system images are fetched there on the first start;
# the tools from the image are linked into it.
ENV ANDROID_SDK_ROOT=/data/sdk \
    ANDROID_HOME=/data/sdk \
    ANDROID_AVD_HOME=/data/avd \
    HOME=/data/home \
    PATH=/opt/android-sdk/platform-tools:/opt/android-sdk/emulator:$PATH
COPY --from=sdk /opt/android-sdk/cmdline-tools /opt/android-sdk/cmdline-tools
COPY --from=sdk /opt/android-sdk/emulator /opt/android-sdk/emulator
COPY --from=sdk /opt/android-sdk/platform-tools /opt/android-sdk/platform-tools
COPY --from=sdk /opt/android-sdk/licenses /opt/android-sdk/licenses
# A system library the emulator needs and the image lacks fails the build here, not at first start (its own
# libraries are found through the path its launcher sets).
RUN E=/opt/android-sdk/emulator; \
    missing=$(LD_LIBRARY_PATH="$E/lib64:$E/lib64/qt/lib:$E/lib64/gles_swiftshader:$E/lib64/vulkan" \
      ldd "$E/qemu/linux-x86_64/qemu-system-x86_64" "$E/emulator" 2>/dev/null | grep "not found" | sort -u || true); \
    if [ -n "$missing" ]; then echo "$missing"; exit 1; fi
COPY docker/android/entrypoint.sh /usr/local/bin/greenlit-android
RUN chmod +x /usr/local/bin/greenlit-android
VOLUME /data
# adb's server, for Greenlit's app container (on the compose network only).
EXPOSE 5037
HEALTHCHECK --interval=20s --timeout=10s --start-period=240s --retries=6 \
  CMD [ "$(adb -P 5037 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/greenlit-android"]
