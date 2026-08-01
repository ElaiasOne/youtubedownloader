const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

let activeChildProcess = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 700,
    minHeight: 550,
    autoHideMenuBar: true,
    title: 'YouTube Video Downloader',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  Menu.setApplicationMenu(null);
  win.removeMenu();
  win.loadFile('public/index.html');
}

// Inicialización de directorio de descargas y verificación de binarios
app.whenReady().then(() => {
  const downloadsDir = path.join(__dirname, 'downloads');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  const ytdlpPath = path.join(__dirname, 'yt-dlp.exe');
  const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');

  if (!fs.existsSync(ytdlpPath)) {
    console.warn('[WARN] yt-dlp.exe no encontrado en la raíz del proyecto.');
  }
  if (!fs.existsSync(ffmpegPath)) {
    console.warn('[WARN] ffmpeg.exe no encontrado en la raíz del proyecto.');
  }

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handler para cancelar cualquier proceso en ejecución
ipcMain.handle('cancel-process', async () => {
  if (activeChildProcess) {
    try {
      activeChildProcess.kill('SIGKILL');
      activeChildProcess = null;
      return true;
    } catch (e) {
      console.error('Error cancelando proceso:', e);
      return false;
    }
  }
  return false;
});

// Handler para abrir la carpeta de descargas en el Explorador de Windows
ipcMain.handle('open-downloads-folder', async () => {
  const downloadsDir = path.join(__dirname, 'downloads');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }
  await shell.openPath(downloadsDir);
  return true;
});

// Helper para descargar archivos manejando redirecciones (301/302) y progreso
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    function startDownload(currentUrl) {
      https.get(currentUrl, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          startDownload(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Servidor retornó código: ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        let downloadedBytes = 0;
        const file = fs.createWriteStream(dest);

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const percent = (downloadedBytes / totalBytes) * 100;
            onProgress(percent);
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          fs.unlink(dest, () => reject(err));
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    }

    startDownload(url);
  });
}

// Handler para verificar si los binarios requeridos existen
ipcMain.handle('check-binaries', async () => {
  const ytdlpPath = path.join(__dirname, 'yt-dlp.exe');
  const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
  return {
    ytDlpExists: fs.existsSync(ytdlpPath),
    ffmpegExists: fs.existsSync(ffmpegPath)
  };
});

// Handler para descargar e instalar los binarios que falten
ipcMain.handle('download-binaries', async (event) => {
  const ytdlpPath = path.join(__dirname, 'yt-dlp.exe');
  const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
  const zipPath = path.join(__dirname, 'ffmpeg.zip');
  const tempDir = path.join(__dirname, 'ffmpeg_temp');

  try {
    // 1. Descargar yt-dlp si no existe
    if (!fs.existsSync(ytdlpPath)) {
      event.sender.send('install-progress', { status: 'Descargando yt-dlp.exe...', percent: 0 });
      await downloadFile(
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
        ytdlpPath,
        (percent) => {
          event.sender.send('install-progress', { status: 'Descargando yt-dlp.exe...', percent: Math.round(percent) });
        }
      );
    }

    // 2. Descargar FFmpeg si no existe
    if (!fs.existsSync(ffmpegPath)) {
      event.sender.send('install-progress', { status: 'Descargando FFmpeg (zip)...', percent: 0 });
      await downloadFile(
        'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
        zipPath,
        (percent) => {
          event.sender.send('install-progress', { status: 'Descargando FFmpeg (zip)...', percent: Math.round(percent) });
        }
      );

      // Extraer usando PowerShell en Windows
      event.sender.send('install-progress', { status: 'Extrayendo FFmpeg (esto puede tardar unos segundos)...', percent: 100 });
      
      const psCommand = `Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force; ` +
        `Get-ChildItem -Path '${tempDir}' -Filter 'ffmpeg.exe' -Recurse | Move-Item -Destination '${__dirname}' -Force; ` +
        `Get-ChildItem -Path '${tempDir}' -Filter 'ffprobe.exe' -Recurse | Move-Item -Destination '${__dirname}' -Force; ` +
        `Remove-Item -Path '${tempDir}' -Recurse -Force; ` +
        `Remove-Item -Path '${zipPath}' -Force;`;

      await new Promise((resolve, reject) => {
        exec(`powershell -Command "${psCommand}"`, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Error al descomprimir con PowerShell: ${error.message || stderr}`));
          } else {
            resolve();
          }
        });
      });
    }

    event.sender.send('install-progress', { status: 'Instalación completada con éxito.', percent: 100 });
    return true;
  } catch (error) {
    console.error('Error durante la instalación de dependencias:', error);
    event.sender.send('install-progress', { status: `Error: ${error.message}`, percent: -1 });
    // Limpieza en caso de error
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {}
    }
    return false;
  }
});

// Handler para obtener vista previa (thumbnail y título) de un video de YouTube vía oEmbed
ipcMain.handle('fetch-video-preview', async (event, videoUrl) => {
  return new Promise((resolve) => {
    if (!videoUrl || typeof videoUrl !== 'string') {
      return resolve(null);
    }

    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;

    https.get(oembedUrl, (res) => {
      if (res.statusCode !== 200) {
        return resolve(null);
      }

      let rawData = '';
      res.on('data', chunk => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          resolve({
            title: parsed.title || '',
            author_name: parsed.author_name || '',
            thumbnail_url: parsed.thumbnail_url || ''
          });
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => {
      resolve(null);
    });
  });
});

// Handler para descargar videos/audio de YouTube con yt-dlp
ipcMain.handle('download-video', async (event, payload) => {
  const url = typeof payload === 'object' && payload.url ? payload.url : payload;
  const format = (typeof payload === 'object' && payload.format) ? payload.format : 'mp4';
  const quality = (typeof payload === 'object' && payload.quality) ? payload.quality : 'best';

  return new Promise((resolve) => {
    const ytdlpArgs = [
      '-o',
      'downloads/%(title)s.%(ext)s',
      '--ffmpeg-location',
      __dirname
    ];

    if (format === 'mp3') {
      ytdlpArgs.push('-x', '--audio-format', 'mp3');
      if (quality === '320k') {
        ytdlpArgs.push('--audio-quality', '0');
      } else if (quality === '192k') {
        ytdlpArgs.push('--audio-quality', '2');
      } else if (quality === '128k') {
        ytdlpArgs.push('--audio-quality', '5');
      }
      ytdlpArgs.push(url);
    } else {
      let formatSpec = 'bv*+ba/b';
      if (quality === '1080p') {
        formatSpec = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
      } else if (quality === '720p') {
        formatSpec = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
      } else if (quality === '480p') {
        formatSpec = 'bestvideo[height<=480]+bestaudio/best[height<=480]/best';
      }

      ytdlpArgs.push('-S', 'ext:mp4', '-f', formatSpec, url);
    }

    const ytdlp = spawn(
      path.join(__dirname, 'yt-dlp.exe'),
      ytdlpArgs
    );

    activeChildProcess = ytdlp;

    ytdlp.stdout.on('data', data => {
      event.sender.send('progress', data.toString());
    });

    ytdlp.stderr.on('data', data => {
      event.sender.send('progress', data.toString());
    });

    ytdlp.on('close', code => {
      activeChildProcess = null;
      resolve(code);
    });

    ytdlp.on('error', err => {
      activeChildProcess = null;
      event.sender.send('progress', `[ERROR] Error de ejecución: ${err.message}`);
      resolve(-1);
    });
  });
});

// Handler para abrir selección de archivos
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Archivos Multimedia', extensions: ['mp4', 'mp3', 'mkv', 'avi', 'mov', 'wav', 'flac', 'webm', 'm4a'] },
      { name: 'Todos los archivos', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// Handler para recortar video/audio con FFmpeg
ipcMain.handle('trim-file', async (event, { inputPath, startTime, endTime }) => {
  return new Promise((resolve) => {
    const ext = path.extname(inputPath);
    const baseName = path.basename(inputPath, ext);
    const outputPath = path.join(__dirname, 'downloads', `${baseName}_recortado${ext}`);

    const ffmpegArgs = ['-y'];
    if (startTime) ffmpegArgs.push('-ss', startTime);
    if (endTime) ffmpegArgs.push('-to', endTime);
    ffmpegArgs.push('-i', inputPath, '-c', 'copy', outputPath);

    const ffmpeg = spawn(path.join(__dirname, 'ffmpeg.exe'), ffmpegArgs);
    activeChildProcess = ffmpeg;

    ffmpeg.stdout.on('data', data => {
      event.sender.send('progress', data.toString());
    });

    ffmpeg.stderr.on('data', data => {
      event.sender.send('progress', data.toString());
    });

    ffmpeg.on('close', code => {
      activeChildProcess = null;
      resolve({ code, outputPath });
    });

    ffmpeg.on('error', err => {
      activeChildProcess = null;
      event.sender.send('progress', `[ERROR] ${err.message}`);
      resolve({ code: -1, outputPath: '' });
    });
  });
});

// Handler para convertir formato con FFmpeg
ipcMain.handle('convert-file', async (event, { inputPath, targetFormat }) => {
  return new Promise((resolve) => {
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(__dirname, 'downloads', `${baseName}.${targetFormat}`);

    const ffmpegArgs = ['-y', '-i', inputPath];
    if (targetFormat === 'mp3') {
      ffmpegArgs.push('-vn', '-acodec', 'libmp3lame', '-q:a', '2');
    }
    ffmpegArgs.push(outputPath);

    const ffmpeg = spawn(path.join(__dirname, 'ffmpeg.exe'), ffmpegArgs);
    activeChildProcess = ffmpeg;

    ffmpeg.stdout.on('data', data => {
      event.sender.send('progress', data.toString());
    });

    ffmpeg.stderr.on('data', data => {
      event.sender.send('progress', data.toString());
    });

    ffmpeg.on('close', code => {
      activeChildProcess = null;
      resolve({ code, outputPath });
    });

    ffmpeg.on('error', err => {
      activeChildProcess = null;
      event.sender.send('progress', `[ERROR] ${err.message}`);
      resolve({ code: -1, outputPath: '' });
    });
  });
});