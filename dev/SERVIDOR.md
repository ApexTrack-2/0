# ApexTrack — configuración que hace el desarrollador (una sola vez)

Las personas que usan la app no tienen que crear nada: solo tocan **Conectar con Google** y aceptan.
Para que eso funcione, el desarrollador tiene que cargar una vez dos valores en `js/config.js`.

## 1. ID de cliente de Google (copia automática en Drive)

La app pide el permiso `drive.file`: solo puede ver y crear sus propios archivos, dentro de la carpeta
"ApexTrack copias". No ve el resto del Drive de nadie. Google lo considera un permiso "no sensible",
así que no hace falta que Google revise la app.

1. Entrá a <https://console.cloud.google.com/> con tu cuenta y creá un proyecto (por ejemplo "ApexTrack").
2. **APIs y servicios → Biblioteca** → buscá **Google Drive API** → **Habilitar**.
3. **APIs y servicios → Pantalla de consentimiento de OAuth** (o "Google Auth Platform"):
   - Tipo de usuario: **Externo**.
   - Nombre de la app: ApexTrack · correo de asistencia: el tuyo · dominio autorizado: `github.io`.
   - Permisos (scopes): agregá `.../auth/drive.file` y `email`.
   - **Publicá la app** ("Publicar aplicación" → En producción). Si queda en "Prueba", solo pueden
     entrar las cuentas que agregues como usuarios de prueba (máximo 100).
4. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - Orígenes de JavaScript autorizados: `https://ignacioandino2005.github.io`
   - (No hacen falta URI de redireccionamiento.)
5. Copiá el **ID de cliente** (termina en `.apps.googleusercontent.com`) y pegalo en `js/config.js`,
   en `GOOGLE_CLIENT_ID`. Ese ID es público: no es una clave secreta.

Cómo funciona en el teléfono:
- Se guarda un archivo por día (`ApexTrack_copia_AAAA-MM-DD.json`). Se conservan los de las últimas
  2 semanas y uno por mes (para siempre).
- Nunca se sube una app vacía. Si la app tiene mucho menos datos que la última copia, se guarda aparte
  (`…_reducida.json`) y no pisa la buena.
- El permiso de Google dura 1 hora. Cuando hace falta subir y venció, la app lo renueva con el siguiente
  toque en un botón (Google abre su ventanita y se cierra sola), como mucho dos veces por día.
- Si se borran los datos del navegador, al entrar con la misma cuenta se ven todas las copias.

## 2. Servicio de aprendizaje compartido (IA propia)

Junta los aportes anónimos de todas las personas (qué dijeron y qué entendió Gemini) y arma el
"conocimiento" que cada teléfono descarga para que la IA propia (sin conexión) entienda cada vez más.

1. Creá una planilla nueva en Google Sheets (por ejemplo "ApexTrack comunidad").
2. **Extensiones → Apps Script**. Borrá lo que aparece y pegá todo el contenido de `server/comunidad.gs`.
3. Guardá. Arriba elegí la función **instalar** y tocá **Ejecutar** (autorizá los permisos). Crea las hojas
   "aportes" y "mensajes" y un disparador que rearma el conocimiento cada noche.
4. **Implementar → Nueva implementación** → tipo **Aplicación web**:
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario**.
5. Copiá la URL que termina en `/exec` y pegala en `js/config.js`, en `COMMUNITY_URL`.

Para revisar: abrí `URL?op=estado` (cantidad de aportes) o `URL?op=conocimiento` (lo que descargan
los teléfonos). En `server/comunidad.gs`, `MIN_PERSONAS` define cuántas personas distintas tienen que
coincidir para publicar un alimento: con pocos usuarios va en 1; cuando haya más, conviene subirlo a 2 o 3.

Qué se guarda y qué no:
- Sí: lo que se dijo de cada alimento ("dos milanesas de pollo al horno"), lo que entendió la IA
  (alimento, cantidad, gramos, valores por 100 g), si la persona lo corrigió, el modelo usado y el
  mensaje completo con su resultado (para entrenar más adelante un modelo propio).
- No: nombre, correo, peso, metas, clave de la IA ni ningún otro dato de la persona. Cada teléfono se
  identifica con un número al azar, solo para contar cuántas personas confirman un dato.
- Cada persona lo puede desactivar en Ajustes → Inteligencia artificial → "Ayudar a entrenarla".

## 3. Avisos con la app cerrada (notificaciones push)

Usan el mismo Apps Script de la comunidad (`server/comunidad.gs`). Cada teléfono le manda sus horarios de
los próximos 14 días; cada 5 minutos el script despierta a los teléfonos que tienen un aviso vencido y el
propio teléfono decide qué mostrar (por ejemplo, no avisa del almuerzo si ya lo registraste).

1. En el editor de Apps Script, reemplazá todo el código por el nuevo `server/comunidad.gs` y guardá.
2. Arriba elegí la función **instalarAvisos** → **Ejecutar** → autorizá (pide permiso para "conectarse a un
   servicio externo": es para mandar los avisos a Google/Chrome). Crea las claves de los avisos (quedan
   guardadas en el script, nunca en el repositorio) y un disparador cada 5 minutos.
3. **Implementar → Gestionar implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar.**
   La URL no cambia.
4. Para revisar: `URL?op=estado` tiene que mostrar `"avisos_listos": true` y cuántos teléfonos están suscriptos.

En el teléfono: Ajustes → Recordatorios → activar. Si el servidor no está listo, los avisos funcionan igual
mientras la app esté abierta o en segundo plano.

## 4. IA de bienvenida (metas de las personas nuevas)

La primera vez que alguien abre la app, cuenta sus datos y la IA calcula sus metas con **la clave del
desarrollador**. Esa clave **no va en el código** (el repositorio es público: cualquiera podría copiarla y
Google desactiva las claves publicadas). Se guarda en el Apps Script y el teléfono nunca la ve:

1. En el editor de Apps Script: **Configuración del proyecto** (ícono de engranaje, a la izquierda).
2. Abajo, **Propiedades de la secuencia de comandos → Agregar propiedad**:
   - Propiedad: `GEMINI_KEY`
   - Valor: tu clave de Gemini.
3. **Guardar**. No hace falta volver a implementar por esto.
4. Para revisar: `URL?op=estado` tiene que mostrar `"bienvenida_lista": true`.

Límites (en `server/comunidad.gs`): 2 usos por teléfono (`PLAN_MAX_POR_TELEFONO`) y 300 por día en total
(`PLAN_MAX_POR_DIA`). Después cada persona carga su propia clave; "Calcular con IA" en Perfil y metas usa
la clave de la persona, no la de bienvenida. Si la clave falta o se agota el cupo, la app ofrece completar
los datos a mano.

## 5. Cuántas personas usan la app

Cada teléfono avisa una vez por día que está activo (número al azar, versión, cuántas comidas y días
registró, si usa la IA o los recordatorios). Se puede apagar en Ajustes → Privacidad.

- **Cantidades** (público, sin nombres): `URL?op=estado` → `usuarios`: instalaciones, activos hoy / 7 / 30
  días, con datos cargados, con más de 7 días registrados, que usan IA, identificados y versiones.
- **Detalle** (solo vos): hoja **usuarios** de la planilla. Una fila por instalación: primera y última vez,
  días activos, comidas y días registrados, y el nombre / contacto / mensaje **solo** de quienes eligieron
  identificarse (Ajustes → Privacidad → "Decirle al desarrollador quién soy"). Si lo apagan, se borra.

## 6. Pruebas

Desde `dev/`: `npm install` una vez y después, dentro de `dev/test/`:

```
node foods.test.mjs
node offline.test.mjs
node ai_pipeline.test.mjs
node client.test.mjs        # modelos, límites, errores y consulta de respaldo
node local_first.test.mjs   # qué resuelve la IA propia sola
node server.test.mjs        # servicio de la comunidad (simulado) de punta a punta
node vapid.test.mjs         # firma de los avisos (verificada con WebCrypto) y envío
node reminders.test.mjs     # qué recordatorio se muestra y cuál se saltea
node goals.test.mjs         # metas: la suma de los macros da las calorías y valores razonables por caso
node features.mjs           # bienvenida, pestañas, ayuno, ideas, recordatorios, resumen semanal, texto grande (Chromium)
node persist.mjs            # pérdida y recuperación de datos, Drive y comunidad (Chromium)
node e2e.mjs                # todos los botones y menús (Chromium)
```
