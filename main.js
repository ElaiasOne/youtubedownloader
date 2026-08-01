const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 860,
    height: 680,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  Menu.setApplicationMenu(null);
  win.removeMenu();
  win.loadFile('public/index.html');
}

app.whenReady().then(createWindow);

// Handler para descargar videos de YouTube con yt-dlp
ipcMain.handle('download-video', async (event, payload) => {
  // Manejar payload tanto si es un objeto { url, format } como si es una string URL directa
  const url = typeof payload === 'object' && payload.url ? payload.url : payload;
  const format = (typeof payload === 'object' && payload.format) ? payload.format : 'mp4';

  return new Promise((resolve, reject) => {
    // Configuración base de argumentos para yt-dlp
    const ytdlpArgs = [
      '-o',
      'downloads/%(title)s.%(ext)s',
      '--ffmpeg-location',
      __dirname
    ];

    if (format === 'mp3') {
      // Extraer solo audio y convertir a mp3
      ytdlpArgs.push('-x', '--audio-format', 'mp3', url);
    } else {
      // Descargar video mp4 completo
      ytdlpArgs.push('-S', 'ext:mp4', '-f', 'bv*+ba/b', url);
    }

    const ytdlp = spawn(
      path.join(__dirname, 'yt-dlp.exe'),
      ytdlpArgs
    );

    ytdlp.stdout.on('data', data => {
      event.sender.send('progress', data.toString());
    });

    ytdlp.stderr.on('data', data => {
      event.sender.send('progress', data.toString());
    });

    ytdlp.on('close', code => {
      resolve(code);
    });

  });

});

// Handler para abrir la ventana nativa de selección de archivos de Windows
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

// Handler para recortar video/audio mediante FFmpeg
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

    ffmpeg.stdout.on('data', data => {
      event.sender.send('progress', data.toString());
    });

    ffmpeg.stderr.on('data', data => {
      event.sender.send('progress', data.toString());
    });

    ffmpeg.on('close', code => {
      resolve({ code, outputPath });
    });
  });
});

// Handler para convertir formato mediante FFmpeg
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

    ffmpeg.stdout.on('data', data => {
      event.sender.send('progress', data.toString());
    });

    ffmpeg.stderr.on('data', data => {
      event.sender.send('progress', data.toString());
    });

    ffmpeg.on('close', code => {
      resolve({ code, outputPath });
    });
  });
});