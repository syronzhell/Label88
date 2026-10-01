# BQQT Label 88 mm — GitHub + Vercel

Tool crop dan gabungkan PDF resi ekspedisi menjadi label 88 mm.
Proses di browser, tanpa database, tanpa API key, dan tanpa login di dalam tool.
Browser: Safari 18+ / iOS 18+, Chrome, atau Edge terbaru.

## Upload ke GitHub

1. Ekstrak ZIP ini di komputer.
2. Buka https://github.com/new dan buat repository bernama `bqqt-label-88mm`.
   Public atau private boleh; ini adalah kode tool, bukan tempat menyimpan PDF buyer.
3. Buka repo, pilih **Add file → Upload files**. Pada repo kosong, gunakan link
   **uploading an existing file** bila menu Add file belum ada.
4. Tarik semua isi folder hasil ekstrak ke area upload, termasuk folder `vendor`
   dan `licenses`. Upload isinya; jangan upload ZIP atau folder pembungkusnya.
5. Pastikan `index.html`, `app.js`, `style.css`, dan `vercel.json` berada langsung
   di root repository, lalu pilih **Commit changes**.

## Deploy ke Vercel

1. Buka https://vercel.com/new dan hubungkan GitHub jika diminta.
2. Import repository `bqqt-label-88mm`.
3. Framework Preset: **Other**.
4. Root Directory: root repo (biarkan default / kosong).
5. Build Command: kosong. Install Command: kosong. Output Directory: **.**
   Setting ini juga sudah disertakan di `vercel.json`.
6. Environment Variables: tidak perlu diisi.
7. Klik **Deploy**, lalu buka URL production yang diberikan Vercel.

Gunakan URL production untuk dibuka di Safari / ditambahkan ke Home Screen.
Jika Vercel meminta login saat orang lain membuka link, cek Deployment Protection
pada proyek Vercel dan gunakan URL production. Tool ini tidak menyediakan login.
Pengaturan akses hosting tetap berada di akun Vercel milikmu.

## Cara pakai

- Pilih banyak PDF dari perangkat. Default A4 dibagi empat: pola 2 x 2.
- Cek preview, pilih label, lalu **Buat PDF gabungan**.
- Download hasilnya atau pilih **Bagikan / Simpan ke Files** di iPhone.
- Atur kertas custom sesuai ukuran PDF dan cetak Actual size / 100%.
- Print dan scan satu barcode dulu sebelum mencetak banyak label.

## Mengubah kode nanti

- Tampilan / teks: `index.html` dan `style.css`.
- Perilaku crop, ukuran kertas, seleksi, dan PDF: `app.js`.
- Aset PDF bawaan tersimpan pada bagian `pdf-assets` dalam `index.html`.
- Library PDF.js dan worker harus selalu menggunakan versi yang sama.
- Setelah perubahan masuk ke branch production GitHub yang terhubung, Vercel
  akan melakukan deployment baru sesuai pengaturan Git integration proyekmu.

## Lisensi dan sumber

PDF-lib: MIT. PDF.js: Apache-2.0. Lisensi font pendukung ada di `licenses`.
Kode ini tidak menyertakan kredensial, identitas hosting ChatGPT, atau PDF buyer.

Panduan resmi:
- https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
- https://vercel.com/docs/builds/configure-a-build
- https://vercel.com/docs/deployments

Paket sudah disiapkan untuk deploy. Belum di-upload ke akun GitHub / Vercel milikmu.
