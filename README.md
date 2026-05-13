# CTS Verifier Pro

CTS Verifier Pro adalah aplikasi desktop berbasis Tauri untuk otomasi CTS Verifier Android dengan dukungan multi-device, precondition setup, instrumentation run, pull result, dan resource APK eksternal.

## Fitur

- Menjalankan flow CTS Verifier ke banyak device sekaligus.
- Resource APK dipisah dari installer agar update resource tidak perlu rebuild app.
- Paket rilis otomatis untuk Linux `deb/rpm` dan Windows `exe`.
- GitHub Release otomatis saat push tag `v*`.
- GitHub Pages untuk halaman download dan panduan instalasi singkat.

## Struktur Resource

Installer tidak membundel APK resource. Resource harus dipasang terpisah dalam folder `resources/` atau diarahkan lewat environment variable `CTS_VERIFIER_RESOURCE_DIR`.

```text
resources/
  ApkTest/
    AutoCtsVerifier-debug.apk
    AutoCtsVerifier-debug-androidTest.apk
  Normal/
    13/
    14/
    15/
    16/
```

Urutan pencarian resource:

- `CTS_VERIFIER_RESOURCE_DIR`
- folder `resources/` di samping binary
- fallback development path di workspace

## Menjalankan dari Source

```bash
npm install
npm run tauri dev
```

Contoh override resource:

```bash
export CTS_VERIFIER_RESOURCE_DIR=/path/to/resources
npm run tauri dev
```

## Build Lokal

### Linux

Menghasilkan installer `deb`, `rpm`, folder `releases/resources`, dan `releases/cts-verifier-resources.zip`.

```bash
npm run build:linux
```

### Windows

Menghasilkan installer `exe` NSIS, folder `releases/resources`, dan `releases/cts-verifier-resources.zip`.

```bash
npm run build:windows
```

### Auto

Memilih platform berdasarkan host saat ini.

```bash
npm run build:auto
```

## Instalasi dari Release

Unduh asset dari:

- Release GitHub: `https://github.com/endrisusanto/cts-verifier-pro/releases/latest`
- GitHub Pages: `https://endrisusanto.github.io/cts-verifier-pro/`

### Linux Debian/Ubuntu

```bash
sudo dpkg -i ./cts-verifier-pro_*.deb
```

### Linux Fedora/RHEL

```bash
sudo dnf install ./cts-verifier-pro-*.rpm
```

### Windows

- Jalankan file installer `*.exe`.

### Pasang Resource Terpisah

1. Unduh `cts-verifier-resources.zip`.
2. Ekstrak menjadi folder `resources/`.
3. Letakkan folder `resources/` di samping binary/aplikasi, atau set:

```bash
export CTS_VERIFIER_RESOURCE_DIR=/path/to/resources
```

## Release dengan Git Tag

Workflow release ada di `.github/workflows/release.yml`. Saat tag `v*` di-push, workflow akan:

- build `deb`
- build `rpm`
- build `exe`
- membuat `cts-verifier-resources.zip`
- membuat draft GitHub Release

Langkah rilis:

```bash
git checkout main
git pull
git tag -a v1.4.0 -m "Release v1.4.0"
git push origin v1.4.0
```

Setelah workflow selesai:

1. Buka tab Actions.
2. Pastikan job `Release` sukses.
3. Buka halaman draft release.
4. Verifikasi asset installer dan `cts-verifier-resources.zip`.
5. Publish release.

## GitHub Pages

Halaman statis ada di `docs/index.html`, dan deploy workflow ada di `.github/workflows/pages.yml`.

Aktifkan sekali di repository settings:

1. Buka `Settings`
2. Masuk ke `Pages`
3. Pastikan source menggunakan `GitHub Actions`

Setelah itu, push ke `main` akan otomatis deploy halaman `docs/`.

## Timeout Instrumentation

Jika perlu ubah timeout guard:

```bash
export CTS_VERIFIER_TEST_TIMEOUT_SECS=600
export CTS_VERIFIER_TEST_IDLE_TIMEOUT_SECS=180
```

## File Penting

- Build script: `build.sh`
- Release workflow: `.github/workflows/release.yml`
- Pages workflow: `.github/workflows/pages.yml`
- Pages index: `docs/index.html`
- Tauri config: `src-tauri/tauri.conf.json`
