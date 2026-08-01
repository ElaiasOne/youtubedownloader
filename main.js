const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const { spawn } = require('child_process');
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