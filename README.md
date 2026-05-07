# 🚀 CTS Verifier Pro (Industrial Edition)

![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-blue)
![Tech](https://img.shields.io/badge/tech-Tauri%20%7C%20Rust%20%7C%20JS-orange)
![License](https://img.shields.io/badge/license-MIT-green)

**CTS Verifier Pro** adalah aplikasi desktop modern berbasis **Tauri** dan **Rust** yang dirancang khusus untuk mempercepat proses kualifikasi Google Android melalui otomatisasi instalasi APK CTS Verifier. 

Aplikasi ini menggantikan metode skrip batch tradisional dengan antarmuka grafis yang canggih, mendukung eksekusi paralel pada banyak perangkat sekaligus, dan memberikan detail properti perangkat secara real-time.

---

## ✨ Fitur Unggulan

- ⚡ **Parallel Multi-Installation**: Instalasi APK ke banyak perangkat Android secara bersamaan (Async Execution).
- 📱 **Detailed Device Discovery**: Menampilkan properti teknis lengkap seperti Android Version, SDK, Security Patch, Carrier, Region, dan PDA.
- 🎨 **Industrial Dark UI**: Antarmuka modern dengan *glassmorphism* dan tema gelap yang nyaman untuk penggunaan durasi lama.
- 📊 **Real-time Console Log**: Monitor setiap langkah instalasi dengan konsol log terintegrasi yang mendetail.
- 📦 **All-in-One Bundling**: Folder APK (`apks/`) sudah tersemat langsung di dalam aplikasi (Resources), tidak perlu konfigurasi folder manual.
- 🛠️ **Automated Configuration**: Secara otomatis mengatur `Device Owner`, memberikan izin `read_device_identifiers`, dan `MANAGE_EXTERNAL_STORAGE`.

---

## 🛠️ Persyaratan Sistem

- **Linux**: Perangkat lunak `adb` (android-tools) harus terpasang.
- **Windows**: Perangkat lunak `adb` harus terdaftar di System PATH.
- **Android**: Perangkat harus dalam mode `USB Debugging` aktif.

---

## 📥 Instalasi & Penggunaan

### Menggunakan Installer (Rekomendasi)
Unduh installer terbaru dari halaman [Releases](https://github.com/endrisusanto/cts-verifier-pro/releases):
- **Linux (Fedora/RPM)**: `sudo dnf install ./cts-verifier-pro-1.0.0.rpm`
- **Linux (Debian/Ubuntu)**: `sudo dpkg -i cts-verifier-pro_1.0.0.deb`
- **Windows**: Jalankan `cts-verifier-pro_1.0.0_x64_en-US.msi`

### Menjalankan dari Source Code
Jika Anda ingin mengembangkan atau menjalankan dari source:
1. Clone repository:
   ```bash
   git clone https://github.com/endrisusanto/cts-verifier-pro.git
   cd cts-verifier-pro
   ```
2. Install dependensi:
   ```bash
   npm install
   ```
3. Jalankan mode pengembangan:
   ```bash
   npm run tauri dev
   ```

---

## 🚀 Workflow GitHub Actions

Proyek ini dilengkapi dengan CI/CD otomatis. Setiap kali Anda membuat tag rilis (`v*`), GitHub Actions akan otomatis membangun:
- Installer `.exe` dan `.msi` (Windows)
- Installer `.deb` dan `.rpm` (Linux)

Cara membuat rilis baru:
```bash
git tag -a v1.0.0 -m "Initial Industrial Release"
git push origin v1.0.0
```

---

## 🤝 Kontribusi

Kontribusi selalu terbuka! Silakan buat *Issue* atau kirimkan *Pull Request* untuk peningkatan fitur.

---

## 📄 Lisensi

Didistribusikan di bawah Lisensi MIT. Lihat `LICENSE` untuk informasi lebih lanjut.

---
**Developed by Endri Pro** - *Optimizing Android Automation Suite*
