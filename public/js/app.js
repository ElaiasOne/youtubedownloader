// Elementos DOM principales
const logElement = document.getElementById('log');
const statusElement = document.getElementById('status');
const statusHint = document.getElementById('statusHint');
const urlInput = document.getElementById('url');
const downloadButton = document.getElementById('downloadBtn');
const formatModal = document.getElementById('formatModal');
const qualitySelect = document.getElementById('qualitySelect');
const qualityWrap = document.getElementById('qualityWrap');
const cancelBtn = document.getElementById('cancelBtn');

// Barra de progreso
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

// Tarjeta de vista previa
const videoPreviewCard = document.getElementById('videoPreviewCard');
const previewThumb = document.getElementById('previewThumb');
const previewTitle = document.getElementById('previewTitle');
const previewAuthor = document.getElementById('previewAuthor');

// Variables de estado
let selectedTrimPath = '';
let selectedConvertPath = '';
let isOperationRunning = false;
let previewDebounceTimer = null;

// Escuchador de salida de progreso IPC
window.api.onProgress(text => {
  appendLog(text);
});

// Función para agregar logs y parsear porcentaje de avance
function appendLog(text) {
  if (!text) return;
  const line = document.createElement('p');
  line.className = 'log-item';
  line.textContent = text.trim();
  logElement.appendChild(line);
  logElement.scrollTop = logElement.scrollHeight;

  // Regex para extraer porcentaje de yt-dlp: "[download]  45.2% of 10.50MiB at 3.20MiB/s"
  const percentMatch = text.match(/\[download\]\s+(\d+(?:\.\d+)?)\%/i);
  if (percentMatch && percentMatch[1]) {
    const percent = parseFloat(percentMatch[1]);
    updateProgress(percent, `Descargando: ${percent.toFixed(1)}%`);
  }
}

function updateProgress(percent, text) {
  progressContainer.style.display = 'block';
  progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  if (text) progressText.textContent = text;
}

function hideProgress() {
  progressContainer.style.display = 'none';
  progressBar.style.width = '0%';
}

// Búsqueda automática de vista previa de video al escribir la URL
urlInput.addEventListener('input', () => {
  clearTimeout(previewDebounceTimer);
  const url = urlInput.value.trim();

  if (!url || !/(?:youtube\.com|youtu\.be)/i.test(url)) {
    videoPreviewCard.style.display = 'none';
    return;
  }

  previewDebounceTimer = setTimeout(async () => {
    try {
      const info = await window.api.fetchPreview(url);
      if (info && info.title) {
        previewThumb.src = info.thumbnail_url || '';
        previewTitle.textContent = info.title;
        previewAuthor.textContent = info.author_name ? `Canal: ${info.author_name}` : 'YouTube Video';
        videoPreviewCard.style.display = 'flex';
      } else {
        videoPreviewCard.style.display = 'none';
      }
    } catch (e) {
      videoPreviewCard.style.display = 'none';
    }
  }, 400);
});

urlInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    download();
  }
});

// Navegación entre pestañas
function switchTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach(panel => panel.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  if (tabName === 'download') {
    document.getElementById('tab-download').style.display = 'block';
    document.getElementById('tabNavDownload').classList.add('active');
    statusHint.textContent = 'Tip: Pega la URL para ver la vista previa automática.';
  } else if (tabName === 'trim') {
    document.getElementById('tab-trim').style.display = 'block';
    document.getElementById('tabNavTrim').classList.add('active');
    statusHint.textContent = 'Tip: Especifica los tiempos de inicio y fin en formato HH:MM:SS.';
  } else if (tabName === 'convert') {
    document.getElementById('tab-convert').style.display = 'block';
    document.getElementById('tabNavConvert').classList.add('active');
    statusHint.textContent = 'Tip: El archivo convertido se guardará en la carpeta de descargas.';
  }
}

// Modal de Descarga
let pendingFormat = 'mp4';

function openModal() {
  formatModal.classList.add('active');
  updateQualityDropdown('mp4');
}

function closeModal(e) {
  if (!e || e.target === formatModal || e.target.classList.contains('modal-close')) {
    formatModal.classList.remove('active');
  }
}

function updateQualityDropdown(format) {
  pendingFormat = format;
  qualitySelect.innerHTML = '';

  if (format === 'mp4') {
    qualitySelect.innerHTML = `
      <option value="best">Máxima Calidad Disponible</option>
      <option value="1080p">1080p (Full HD)</option>
      <option value="720p">720p (HD)</option>
      <option value="480p">480p (SD)</option>
    `;
  } else {
    qualitySelect.innerHTML = `
      <option value="320k">320 kbps (Alta Calidad Audio)</option>
      <option value="192k">192 kbps (Estándar Audio)</option>
      <option value="128k">128 kbps (Compacto Audio)</option>
    `;
  }
}

function download() {
  const url = urlInput.value.trim();
  if (!url) {
    statusElement.textContent = 'Por favor pega una URL válida de YouTube.';
    statusElement.classList.remove('ok');
    urlInput.focus();
    return;
  }
  openModal();
}

function confirmDownload(format) {
  closeModal();
  const quality = qualitySelect.value;
  startDownload(format, quality);
}

// Iniciar descarga
async function startDownload(format, quality) {
  const url = urlInput.value.trim();
  if (!url) return;

  setRunningState(true, `Descargando (${format.toUpperCase()} - ${quality.toUpperCase()})...`);
  updateProgress(0, 'Iniciando descarga...');
  appendLog(`[START] Descarga iniciada (${format.toUpperCase()} - ${quality}) para: ${url}`);

  try {
    const code = await window.api.download(url, format, quality);
    if (code === 0) {
      statusElement.textContent = `Descarga (${format.toUpperCase()}) completada con éxito.`;
      statusElement.classList.add('ok');
      updateProgress(100, 'Completado');
      appendLog(`[OK] Descarga (${format.toUpperCase()}) finalizada correctamente.`);
    } else if (code === null || code === -1) {
      statusElement.textContent = 'Proceso cancelado o interrumpido.';
      statusElement.classList.remove('ok');
      appendLog('[WARN] Descarga cancelada por el usuario.');
    } else {
      statusElement.textContent = 'El proceso terminó con código: ' + code;
      statusElement.classList.remove('ok');
      appendLog('[WARN] El proceso devolvió código: ' + code);
    }
  } catch (error) {
    statusElement.textContent = 'Error durante la descarga.';
    statusElement.classList.remove('ok');
    appendLog('[ERROR] ' + (error && error.message ? error.message : String(error)));
  } finally {
    setRunningState(false);
  }
}

// Recortar Video/Audio
async function selectFileForTrim() {
  const filePath = await window.api.selectFile();
  if (filePath) {
    selectedTrimPath = filePath;
    document.getElementById('trimFileLabel').textContent = filePath;
    statusElement.textContent = 'Archivo seleccionado para recortar.';
    statusElement.classList.add('ok');
  }
}

// Convierte cadena de tiempo a segundos
function parseTimeToSeconds(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const cleaned = timeStr.trim();
  if (!cleaned) return null;

  const parts = cleaned.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
    return Math.max(0, h * 3600 + m * 60 + s);
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    if (isNaN(m) || isNaN(s)) return null;
    return Math.max(0, m * 60 + s);
  } else if (parts.length === 1) {
    const s = parseFloat(parts[0]);
    if (isNaN(s)) return null;
    return Math.max(0, s);
  }
  return null;
}

// Convierte segundos a formato HH:MM:SS
function formatSecondsToHHMMSS(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || isNaN(totalSeconds)) return '00:00:00';
  const secNum = Math.floor(totalSeconds);
  const hours = Math.floor(secNum / 3600);
  const minutes = Math.floor((secNum % 3600) / 60);
  const seconds = secNum % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

async function runTrim() {
  if (!selectedTrimPath) {
    statusElement.textContent = 'Selecciona un archivo multimedia primero.';
    statusElement.classList.remove('ok');
    return;
  }

  const startRaw = document.getElementById('trimStart').value.trim();
  const endRaw = document.getElementById('trimEnd').value.trim();

  const startSec = startRaw ? parseTimeToSeconds(startRaw) : 0;
  if (startSec === null) {
    statusElement.textContent = 'Formato inválido en Tiempo Inicio. Usa HH:MM:SS o MM:SS.';
    statusElement.classList.remove('ok');
    return;
  }

  if (!endRaw) {
    statusElement.textContent = 'Especifica el tiempo final del recorte.';
    statusElement.classList.remove('ok');
    return;
  }

  const endSec = parseTimeToSeconds(endRaw);
  if (endSec === null) {
    statusElement.textContent = 'Formato inválido en Tiempo Fin. Usa HH:MM:SS o MM:SS.';
    statusElement.classList.remove('ok');
    return;
  }

  if (endSec <= startSec) {
    statusElement.textContent = 'El tiempo final debe ser mayor al tiempo inicial.';
    statusElement.classList.remove('ok');
    return;
  }

  const startTime = formatSecondsToHHMMSS(startSec);
  const endTime = formatSecondsToHHMMSS(endSec);

  // Auto-ajustar inputs en pantalla si tenían overflow (ej. 00:60:00 -> 01:00:00)
  document.getElementById('trimStart').value = startTime;
  document.getElementById('trimEnd').value = endTime;

  setRunningState(true, 'Recortando archivo...');
  updateProgress(20, 'Procesando recorte con FFmpeg...');
  appendLog(`[START] Recorte iniciado para: ${selectedTrimPath} (Inicio: ${startTime}, Fin: ${endTime})`);

  try {
    const result = await window.api.trimFile({ inputPath: selectedTrimPath, startTime, endTime });
    if (result.code === 0) {
      statusElement.textContent = 'Recorte finalizado con éxito.';
      statusElement.classList.add('ok');
      updateProgress(100, 'Recorte finalizado');
      appendLog(`[OK] Archivo recortado guardado en: ${result.outputPath}`);
    } else {
      statusElement.textContent = 'Error o cancelación al recortar.';
      statusElement.classList.remove('ok');
    }
  } catch (error) {
    statusElement.textContent = 'Error durante el recorte.';
    statusElement.classList.remove('ok');
    appendLog('[ERROR] ' + (error && error.message ? error.message : String(error)));
  } finally {
    setRunningState(false);
  }
}

// Convertir Formato
async function selectFileForConvert() {
  const filePath = await window.api.selectFile();
  if (filePath) {
    selectedConvertPath = filePath;
    document.getElementById('convertFileLabel').textContent = filePath;
    statusElement.textContent = 'Archivo seleccionado para conversión.';
    statusElement.classList.add('ok');
  }
}

async function runConvert() {
  if (!selectedConvertPath) {
    statusElement.textContent = 'Selecciona un archivo multimedia primero.';
    statusElement.classList.remove('ok');
    return;
  }

  const targetFormat = document.getElementById('targetFormatSelect').value;
  setRunningState(true, `Convirtiendo a ${targetFormat.toUpperCase()}...`);
  updateProgress(20, 'Convirtiendo formato con FFmpeg...');
  appendLog(`[START] Conversión iniciada para ${selectedConvertPath} a ${targetFormat.toUpperCase()}`);

  try {
    const result = await window.api.convertFile({ inputPath: selectedConvertPath, targetFormat });
    if (result.code === 0) {
      statusElement.textContent = `Conversión a ${targetFormat.toUpperCase()} finalizada con éxito.`;
      statusElement.classList.add('ok');
      updateProgress(100, 'Conversión finalizada');
      appendLog(`[OK] Archivo convertido guardado en: ${result.outputPath}`);
    } else {
      statusElement.textContent = 'Error o cancelación en la conversión.';
      statusElement.classList.remove('ok');
    }
  } catch (error) {
    statusElement.textContent = 'Error durante la conversión.';
    statusElement.classList.remove('ok');
    appendLog('[ERROR] ' + (error && error.message ? error.message : String(error)));
  } finally {
    setRunningState(false);
  }
}

// Cancelar proceso activo
async function cancelCurrentProcess() {
  const canceled = await window.api.cancelProcess();
  if (canceled) {
    statusElement.textContent = 'Proceso cancelado por el usuario.';
    statusElement.classList.remove('ok');
    appendLog('[CANCEL] Proceso detenido por el usuario.');
    setRunningState(false);
  }
}

// Abrir carpeta de descargas
async function openDownloadsFolder() {
  await window.api.openDownloadsFolder();
}

// Actualizar yt-dlp a la última versión
async function updateYtDlp() {
  const updateBtn = document.getElementById('updateYtDlpBtn');
  if (updateBtn) updateBtn.disabled = true;
  statusElement.textContent = 'Buscando actualizaciones para yt-dlp...';
  appendLog('[INFO] Comprobando y actualizando yt-dlp.exe...');

  try {
    const result = await window.api.updateYtDlp();
    if (result && result.success) {
      statusElement.textContent = 'yt-dlp actualizado correctamente.';
      statusElement.classList.add('ok');
      appendLog(`[OK] ${result.message}`);
    } else {
      statusElement.textContent = 'No se pudo actualizar yt-dlp.';
      statusElement.classList.remove('ok');
      appendLog(`[WARN] ${result ? result.message : 'Error desconocido'}`);
    }
  } catch (error) {
    statusElement.textContent = 'Error al actualizar yt-dlp.';
    statusElement.classList.remove('ok');
    appendLog(`[ERROR] ${error.message || error}`);
  } finally {
    if (updateBtn) updateBtn.disabled = false;
  }
}

// Control del estado global de ejecución
function setRunningState(running, statusMsg) {
  isOperationRunning = running;
  downloadButton.disabled = running;
  document.getElementById('trimBtn').disabled = running;
  document.getElementById('convertBtn').disabled = running;
  cancelBtn.style.display = running ? 'inline-block' : 'none';

  if (running) {
    statusElement.textContent = statusMsg || 'Procesando...';
    statusElement.classList.remove('ok');
  }
}

// Lógica de autodescarga e instalación de binarios
const installerOverlay = document.getElementById('installerOverlay');
const installerProgressFill = document.getElementById('installerProgressFill');
const installerStatusText = document.getElementById('installerStatusText');
const installerPercentText = document.getElementById('installerPercentText');
const startInstallBtn = document.getElementById('startInstallBtn');

async function checkAndPromptBinaries() {
  try {
    const status = await window.api.checkBinaries();
    if (!status.ytDlpExists || !status.ffmpegExists) {
      installerOverlay.style.display = 'flex';
      let missing = [];
      if (!status.ytDlpExists) missing.push('yt-dlp');
      if (!status.ffmpegExists) missing.push('FFmpeg');
      installerStatusText.textContent = `Falta configurar: ${missing.join(' y ')}.`;
      startInstallBtn.style.display = 'block';
    } else {
      installerOverlay.style.display = 'none';
    }
  } catch (e) {
    console.error('Error comprobando binarios:', e);
  }
}

async function startBinaryInstallation() {
  startInstallBtn.disabled = true;
  startInstallBtn.textContent = 'Instalando...';
  
  window.api.onInstallProgress(({ status, percent }) => {
    if (percent >= 0) {
      installerProgressFill.style.width = `${percent}%`;
      installerPercentText.textContent = `${percent}%`;
    }
    installerStatusText.textContent = status;

    if (percent === -1) {
      startInstallBtn.disabled = false;
      startInstallBtn.textContent = 'Reintentar Instalación';
    }
  });

  try {
    const success = await window.api.downloadBinaries();
    if (success) {
      setTimeout(() => {
        installerOverlay.style.display = 'none';
      }, 1000);
    }
  } catch (e) {
    installerStatusText.textContent = 'Error al instalar herramientas: ' + e.message;
    startInstallBtn.disabled = false;
    startInstallBtn.textContent = 'Reintentar Instalación';
  }
}

// Comprobar binarios al iniciar la app
checkAndPromptBinaries();
