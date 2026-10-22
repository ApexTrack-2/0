// ApexTrack — configuración del desarrollador (la misma para todas las personas que usan la app).
// No va acá ninguna clave privada: estos dos valores son públicos por diseño.

// ID de cliente OAuth de Google (tipo "Aplicación web"), con el origen https://ignacioandino2005.github.io
// autorizado y la API de Google Drive habilitada. Permiso pedido: drive.file (la app solo ve los
// archivos que ella misma crea, en la carpeta "ApexTrack copias"). Pasos en dev/SERVIDOR.md.
export const GOOGLE_CLIENT_ID = '22303629060-lmfad0ltpmcqgacv2kd0l1pd31n1j48c.apps.googleusercontent.com';

// Dirección del servicio de aprendizaje compartido (Apps Script del desarrollador, server/comunidad.gs).
// Recibe aportes anónimos de comidas analizadas por la IA y devuelve el conocimiento acumulado.
export const COMMUNITY_URL = 'https://script.google.com/macros/s/AKfycbwVMqCDWXbI1IFjHLaO_m4C1v_lFtXXwFdxklObcDd1_ZJKkoHaBw4-v8EkgiGKXxF4/exec';
