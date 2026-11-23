#!/bin/sh
# Starts Greenlit's Android device: an adb server other containers reach, then the emulator, headless, with the
# emulator's own virtual camera. The device's data (accounts, apps) lives in /data and survives restarts.
set -eu

API="${ANDROID_API:-33}"
TAG="${ANDROID_TAG:-google_apis}"
NAME=greenlit
AVD="$ANDROID_AVD_HOME/$NAME.avd"
mkdir -p "$ANDROID_AVD_HOME" "$HOME"

if [ ! -e /dev/kvm ]; then
  echo "greenlit-android: /dev/kvm is missing; give the container the host's KVM device (devices: [/dev/kvm])" >&2
  exit 1
fi

# adb's server on every interface of the container, so Greenlit's app container reaches the device (android:5037);
# the emulators register with it by themselves. Started first: any adb call before it (the health check) would
# start a server of its own that listens on the container's loopback only.
adb -a -P 5037 nodaemon server start >"$HOME/adb.log" 2>&1 &
sleep 1

# The SDK the emulator reads lives in the volume: the image's tools linked in, the system images fetched once.
TOOLS=/opt/android-sdk
mkdir -p "$ANDROID_SDK_ROOT/licenses"
for d in cmdline-tools emulator platform-tools; do ln -sfn "$TOOLS/$d" "$ANDROID_SDK_ROOT/$d"; done
cp -f "$TOOLS/licenses/"* "$ANDROID_SDK_ROOT/licenses/"
sdk() { "$TOOLS/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_SDK_ROOT" "$@"; }
# A system image, from Google's Android SDK repository, made sparse (most of its disk is empty).
fetch_image() {
  dir="$ANDROID_SDK_ROOT/system-images/android-$API/$1/x86_64"
  [ -f "$dir/system.img" ] && return 0
  echo "greenlit-android: fetching the Android $API $1 system image (first start only)"
  sdk "system-images;android-$API;$1;x86_64" >"$HOME/sdkmanager.log" 2>&1 || { cat "$HOME/sdkmanager.log" >&2; return 1; }
  for img in "$dir"/*.img; do fallocate --dig-holes "$img" 2>/dev/null || true; done
}
fetch_image "$TAG"

# The device, made once.
if [ ! -f "$AVD/config.ini" ]; then
  mkdir -p "$AVD"
  cat > "$ANDROID_AVD_HOME/$NAME.ini" <<EOF
avd.ini.encoding=UTF-8
path=$AVD
target=android-$API
EOF
  cat > "$AVD/config.ini" <<EOF
AvdId=$NAME
avd.ini.displayname=Greenlit
abi.type=x86_64
hw.cpu.arch=x86_64
image.sysdir.1=system-images/android-$API/$TAG/x86_64/
tag.id=$TAG
PlayStore.enabled=false
hw.ramSize=${ANDROID_RAM_MB:-4096}
hw.cpu.ncore=${ANDROID_CORES:-4}
disk.dataPartition.size=${ANDROID_DATA_SIZE:-16G}
hw.lcd.width=1080
hw.lcd.height=2400
hw.lcd.density=420
hw.keyboard=yes
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader_indirect
hw.camera.back=${ANDROID_CAMERA:-emulated}
hw.camera.front=${ANDROID_CAMERA:-emulated}
hw.audioInput=no
hw.accelerometer=yes
hw.battery=yes
fastboot.forceColdBoot=yes
EOF
  echo "greenlit-android: device created (Android $API, $TAG)"
fi


booted() { [ "$(adb -s "$1" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; }
wait_boot() {
  i=0
  until booted "$1"; do
    i=$((i + 1)); [ "$i" -gt 450 ] && return 1   # 15 minutes: a first start with a writable system is slow
    sleep 2
  done
}

# The Play Store, which the Google APIs image lacks (it has a stub of that name, LicenseChecker): apps that have to be
# updated before they let you sign in (YouTube refuses versions it no longer supports) are updated through it, and so
# is Google Play services. The Play Store only works next to a Google Play services signed with its own key: every app
# that uses Play services checks that the two match and refuses to run otherwise. The Google APIs image's Google Play
# services and Services Framework (one app user, so one key) are signed with Google's development key, the Play
# Store with Google's release key; so the three come together, from Google's Play image of the same Android version,
# and replace the image's own on the device's system. The device keeps the Google APIs image itself for what the Play
# images do not allow: root (reading an app's token, recording its requests).
# Copied once: the Play image boots on its own for a minute, the three apps' folders (as on its system, with their
# privileged permissions) are copied to /data/apps, and the Play image is deleted again.
CORE="com.google.android.gsf com.google.android.gms com.android.vending"
PLAY="system-images/android-$API/google_apis_playstore/x86_64/"
mkdir -p /data/apps
# Copies an earlier version of this script made (the Play Store's APK alone, and YouTube, which the Google APIs image
# has itself) are replaced.
for dir in /data/apps/*/; do
  [ -d "$dir" ] && [ ! -f "$dir.path" ] && rm -rf "$dir"
done
need=""
for pkg in $CORE; do [ -f "/data/apps/$pkg/.path" ] || need="$need $pkg"; done
if [ -n "$need" ] && fetch_image google_apis_playstore; then
  echo "greenlit-android: copying$need from Google's Play image (first start only)"
  T=/data/play-tmp
  rm -rf "$T" && mkdir -p "$T/play.avd"
  printf 'avd.ini.encoding=UTF-8\npath=%s/play.avd\ntarget=android-%s\n' "$T" "$API" > "$T/play.ini"
  printf 'AvdId=play\nabi.type=x86_64\nhw.cpu.arch=x86_64\nimage.sysdir.1=%s\ntag.id=google_apis_playstore\nPlayStore.enabled=true\nhw.ramSize=3072\nhw.gpu.enabled=yes\nhw.gpu.mode=swiftshader_indirect\n' "$PLAY" > "$T/play.avd/config.ini"
  ANDROID_AVD_HOME="$T" emulator -avd play -ports 5556,5557 -no-window -no-audio -no-boot-anim -no-snapshot \
    -gpu swiftshader_indirect -memory 3072 >"$HOME/play.log" 2>&1 &
  PLAY_PID=$!
  if wait_boot emulator-5556; then
    for pkg in $need; do
      # The app's folder on the Play image's system (not an update it may have installed meanwhile).
      src=$(adb -s emulator-5556 shell dumpsys package "$pkg" 2>/dev/null | tr -d '\r' | sed -n 's/^ *codePath=//p' | grep -v '^/data/' | head -1)
      if [ -z "$src" ]; then echo "greenlit-android: $pkg is not on the Play image" >&2; continue; fi
      out="/data/apps/$pkg"
      rm -rf "$out" && mkdir -p "$out"
      if ! adb -s emulator-5556 pull "$src" "$out/" >/dev/null; then
        echo "greenlit-android: $pkg could not be copied" >&2; rm -rf "$out"; continue
      fi
      # A privileged app's permissions go with it: its own blocks of whichever files of the image grant them.
      if echo "$src" | grep -q "/priv-app/"; then
        { echo '<?xml version="1.0" encoding="utf-8"?>'; echo '<permissions>'
          adb -s emulator-5556 shell "cat /system/etc/permissions/*.xml /product/etc/permissions/*.xml /system_ext/etc/permissions/*.xml 2>/dev/null" \
            | tr -d '\r' | awk -v p="package=\"$pkg\"" 'index($0, "<privapp-permissions") && index($0, p) {on=1} on {print} on && index($0, "</privapp-permissions>") {on=0}'
          echo '</permissions>'; } > "$out/privapp-permissions.xml"
        grep -c "<permission " "$out/privapp-permissions.xml" | sed "s/^/greenlit-android: $pkg privileged permissions: /"
      fi
      apk=$(ls "$out/$(basename "$src")/"*.apk | head -1)
      md5sum "$apk" | cut -d' ' -f1 > "$out/.md5"
      adb -s emulator-5556 shell dumpsys package "$pkg" | sed -n 's/^ *versionName=//p' | tail -1 > "$out/.version"
      # Last: the folder's place on the system, and the mark that the copy is whole.
      echo "$src/$(basename "$apk")" > "$out/.path"
      echo "greenlit-android: copied $pkg $(cat "$out/.version")"
    done
  else
    echo "greenlit-android: the Play image did not start; apps not copied" >&2
  fi
  adb -s emulator-5556 emu kill >/dev/null 2>&1 || kill "$PLAY_PID" 2>/dev/null || true
  wait "$PLAY_PID" 2>/dev/null || true
  rm -rf "$T"
  # The Play image was only for this: removed again.
  rm -rf "${ANDROID_SDK_ROOT:?}/system-images/android-$API/google_apis_playstore"
fi

# Once the device has started: Google's Play apps onto its system (writable: -writable-system below), in place of the
# image's own, when its system does not have them yet (the first start). Its data stays: Android keeps an app's data
# when its system copy changes key, and drops an update of the old key, which the Play Store then replaces.
(
  set +e
  D=emulator-5554
  wait_boot "$D" || exit 0
  for pkg in $CORE; do
    [ -f "/data/apps/$pkg/.path" ] && continue
    echo "greenlit-android: $pkg was not copied from the Play image; the device has no Play Store" >&2
    exit 0
  done
  current() { [ "$(adb -s "$D" shell md5sum "$(cat "/data/apps/$1/.path")" 2>/dev/null | cut -d' ' -f1)" = "$(cat "/data/apps/$1/.md5")" ]; }
  todo=""
  for pkg in $CORE; do current "$pkg" || todo="$todo $pkg"; done
  if [ -n "$todo" ]; then
    echo "greenlit-android: putting Google's Play Store, Play services and Services Framework on the device's system"
    adb -s "$D" root >/dev/null; sleep 3; wait_boot "$D"
    # The first remount only sets up the writable system; it takes effect after a restart.
    if ! adb -s "$D" remount 2>&1 | grep -qi "remount succeeded"; then
      adb -s "$D" reboot; sleep 10; wait_boot "$D"
      adb -s "$D" root >/dev/null; sleep 3; wait_boot "$D"
      if ! adb -s "$D" remount 2>&1 | grep -qi "remount succeeded"; then
        echo "greenlit-android: the device's system could not be made writable; the device has no Play Store" >&2
        exit 0
      fi
    fi
    # All three, even when only one differs: they must share one key.
    for pkg in $CORE; do
      path=$(cat "/data/apps/$pkg/.path"); src=$(dirname "$path"); part="/$(echo "$src" | cut -d/ -f2)"
      # The image's own copy, wherever it is (the Play Store stub is /product/app/LicenseChecker), and what an
      # earlier version of this script installed (the Play Store in /system/priv-app, its permissions file).
      for old in $(adb -s "$D" shell dumpsys package "$pkg" | tr -d '\r' | sed -n 's/^ *codePath=//p' | grep -v '^/data/'); do
        adb -s "$D" shell rm -rf "$old"
      done
      adb -s "$D" shell rm -rf "$src" "/system/etc/permissions/privapp-permissions-$pkg.xml"
      adb -s "$D" push "/data/apps/$pkg/$(basename "$src")" "$(dirname "$src")/" >/dev/null
      perms="$part/etc/permissions/privapp-permissions-greenlit-$pkg.xml"
      [ -f "/data/apps/$pkg/privapp-permissions.xml" ] && adb -s "$D" push "/data/apps/$pkg/privapp-permissions.xml" "$perms" >/dev/null
      adb -s "$D" shell "chown -R root:root $src; find $src -type d -exec chmod 755 {} +; find $src -type f -exec chmod 644 {} +;
        [ -f $perms ] && chmod 644 $perms; restorecon -R $src $part/etc/permissions" 2>/dev/null
    done
    adb -s "$D" reboot; sleep 10; wait_boot "$D"
    for pkg in $CORE; do
      if current "$pkg" && adb -s "$D" shell pm path "$pkg" 2>/dev/null | grep -q package:; then
        echo "greenlit-android: $pkg $(cat "/data/apps/$pkg/.version") installed"
      else
        echo "greenlit-android: $pkg not installed" >&2
      fi
    done
  fi
  # Google Partner Setup, signed with the development key like the image's other Google apps, writes to the Services
  # Framework's settings, which only apps of its key may: it would crash at every start ("Google Partner Setup keeps
  # stopping"). It only sets partner ids, nothing Greenlit uses: off.
  ps=com.google.android.partnersetup
  if adb -s "$D" shell pm list packages -e "$ps" 2>/dev/null | tr -d '\r' | grep -qx "package:$ps"; then
    adb -s "$D" shell pm disable-user --user 0 "$ps" >/dev/null && echo "greenlit-android: $ps turned off"
  fi
) &

# The GPU: an NVIDIA card when the container has one (its container toolkit mounts the driver's EGL in:
# compose.nvidia.yaml), else software. The emulator's host renderer needs an EGL display without X, which NVIDIA's
# EGL gives and Mesa's does not (Intel, AMD: ANDROID_GPU=host tries it anyway). A start on the GPU that never got
# Android booted leaves a mark, and the next start is in software.
# Software is ANGLE (OpenGL ES) on SwiftShader's Vulkan: the emulator's other software renderer, SwiftShader's own
# OpenGL ES (swiftshader_indirect, ANDROID_GPU=swiftshader), crashed the whole emulator (a segfault) on the Play
# Store's app pages, every time.
GPU_MARK="$HOME/.gpu-host-starting"
GPU_FAILED="$HOME/.gpu-host-failed"
[ -f "$GPU_MARK" ] && { echo "greenlit-android: the last start on the GPU did not boot; drawing in software" >&2; touch "$GPU_FAILED"; }
rm -f "$GPU_MARK"
gpu_mode() {
  case "${ANDROID_GPU:-auto}" in
    host) echo host; return ;;
    software) echo swangle_indirect; return ;;
    swiftshader) echo swiftshader_indirect; return ;;
  esac
  [ -f "$GPU_FAILED" ] && { echo swangle_indirect; return; }
  nvidia && { echo host; return; }
  echo swangle_indirect
}
nvidia() { [ -e /dev/nvidia0 ] && ldconfig -p 2>/dev/null | grep -q libEGL_nvidia; }
GPU=$(gpu_mode)
EMU_GPU=$GPU
if [ "$GPU" = host ] && nvidia && [ -f /etc/vulkan/icd.d/nvidia_icd.json ]; then
  # The emulator's own host renderer draws with GLX (an X display it does not have headless). ANGLE draws OpenGL
  # ES on Vulkan instead, needing no display: its SwiftShader mode, on NVIDIA's Vulkan driver rather than
  # SwiftShader's.
  # The emulator points Vulkan at its own SwiftShader driver file in that mode, whatever VK_ICD_FILENAMES says: the
  # file names NVIDIA's driver instead while the card is there (the original is kept and put back without it).
  EMU_GPU=swangle
  export ANGLE_DEFAULT_PLATFORM=vulkan
fi
for icd in /opt/android-sdk/emulator/lib64/gles_angle/vk_swiftshader_icd.json /opt/android-sdk/emulator/lib64/vulkan/vk_swiftshader_icd.json; do
  [ -f "$icd" ] || continue
  [ -f "$icd.orig" ] || cp "$icd" "$icd.orig"
  if [ "$EMU_GPU" = swangle ] && [ "$GPU" = host ]; then
    cp /etc/vulkan/icd.d/nvidia_icd.json "$icd"
  else
    cp "$icd.orig" "$icd"
  fi
done
if [ "$GPU" = host ]; then
  touch "$GPU_MARK"
  if nvidia; then
    # NVIDIA's EGL first (libglvnd would also find Mesa's).
    [ -f /usr/share/glvnd/egl_vendor.d/10_nvidia.json ] &&
      export __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/10_nvidia.json
  fi
  # Headless: the emulator asks for the default display, which libglvnd then gives without X.
  export EGL_PLATFORM=surfaceless
  # An emulator whose renderer did not start hangs rather than exits: not booted in 4 minutes, it is stopped, and
  # the container's restart finds the mark and draws in software.
  (
    i=0
    until booted emulator-5554; do
      i=$((i + 1))
      if [ "$i" -gt 120 ]; then
        echo "greenlit-android: Android did not start on the GPU; stopping, the next start is in software" >&2
        kill "$$" 2>/dev/null
        exit 0
      fi
      sleep 2
    done
    rm -f "$GPU_MARK"
  ) &
  echo "greenlit-android: drawing on the GPU"
else
  echo "greenlit-android: drawing in software"
fi
# In software, no Vulkan in the guest: apps that probe it (Instagram's bloks_gpu_query at every start) crashed the
# emulator's software Vulkan, and the whole device with it; they fall back to OpenGL ES.
VULKAN=""
[ "$GPU" = host ] || VULKAN="-feature -Vulkan"
# The system is writable, always: Google's Play apps live on it (the changes are kept in the device's folder, the
# system image itself stays untouched; started without it, the device would be back on the image's own apps).
# shellcheck disable=SC2086
set -- -avd "$NAME" -no-window -no-audio -no-boot-anim -no-snapshot -writable-system \
  -gpu "$EMU_GPU" $VULKAN \
  -camera-back "${ANDROID_CAMERA:-emulated}" -camera-front "${ANDROID_CAMERA:-emulated}" \
  -memory "${ANDROID_RAM_MB:-4096}" -cores "${ANDROID_CORES:-4}"
# A proxy, for recording an app's requests.
[ -n "${ANDROID_HTTP_PROXY:-}" ] && set -- "$@" -http-proxy "$ANDROID_HTTP_PROXY"
# Extra emulator flags (ANDROID_EMULATOR_FLAGS), for trying a setup without changing this script.
# shellcheck disable=SC2086
[ -n "${ANDROID_EMULATOR_FLAGS:-}" ] && set -- "$@" $ANDROID_EMULATOR_FLAGS

# One emulator per container: locks left by one that crashed would stop this one from starting ("Running multiple
# emulators with the same AVD").
rm -f "$AVD"/*.lock

echo "greenlit-android: starting the emulator"
exec emulator "$@"
