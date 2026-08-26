# Mapa exhaustivo de causas — Pantalla gris (Sunlight v1.0.5, Android 16+ arm64)

> Estado del arte al momento del análisis (commit d3695b7).
> Síntoma objetivo: ventana **gris totalmente vacía**, proceso vivo, sin crash,
> sin wordmark "SUNLIGHT", sin texto de diagnóstico. Tras reinstalación limpia
> de las variantes arm64 y universal.
> Metodología: 4 agentes de auditoría independiente + código fuente de
> node_modules leído línea a línea + binario del APK inspeccionado + búsquedas
> web (Exa). Nada por asumido; cada afirmación cita evidencia.

---

## 0. Hechos verificados (base dura, no causas)

| # | Hecho | Evidencia |
|---|-------|-----------|
| H1 | Las 40 `.so` del APK están alineadas 16KB (p_align=0x4000), STORED y zipalignadas | llvm-readelf loop sobre el APK v1.0.5 |
| H2 | DT_NEEDED de todas las libs críticas satisfecho dentro del APK (`libc++_shared` incluida) | llvm-readelf -d |
| H3 | Manifiesto binario: `versionName='1.0.5'`, `versionCode='210005'`, label 'Sunlight 1.0.5', `extractNativeLibs=false`, soloader meta-data disabled | aapt2 dump badging/xmltree |
| H4 | Asset de GitHub ≡ build local (SHA-256 idéntico, descarga verificada) | gh release download + sha256sum |
| H5 | Firma válida (V2, CN=Sunlight OU=Moud) en todos los releases desde v1.0.0 | apksigner verify |
| H6 | El tema `AppTheme` (DayNight dark) tiene windowBackground **gris oscuro ~#303030** sin splash nativo → "gris vacío" ES literalmente ese fondo | res/values/styles.xml:4-7 |
| H7 | Todo lo visible del boot (wordmark, stamp de versión, textos de error) es JS-rendered. Si JS pintara 1 frame, habría wordmark o texto de error | App.tsx:96-173, index.js:94-138, ErrorBoundary self-contained |
| H8 | Ningún behavior change de targetSdk 36/Android 16 produce por sí mismo "ventana gris + proceso vivo" | auditoría OS (agente OEM) |
| H9 | ⚠️ **ANOMALÍA NUEVA**: el `assets/index.android.bundle` dentro del APK v1.0.5 difiere de un rebuild limpio `--reset-cache` hecho hoy (6,442,916 B vs 6,608,099 B; el rebuild contiene el módulo/string `react-native-worklets-core` (WorkletsProxy) que el bundle publicado NO contiene) | diff de bundles, agente ejecución-JS hallazgo #0 |

> **H9 es una alerta seria**: implica que los builds incrementales pudieron
> empaquetar un grafo Metro incompleto/distinto (cache de resolución de
> dependencias opcionales). Un bundle al que le faltan módulos puede fallar en
> runtime de formas no cubiertas por nuestros handlers. **Acción derivada:
> verificar qué más falta y siempre publicar con `--reset-cache`.**

---

## CAPA A — Instalación / distribución en el dispositivo

### A1. Instalación stale nunca reemplazada (hipótesis histórica dominante)
- **Mecanismo**: instaladores/file managers saltan silenciosamente updates con
  versionCode igual o menor; o el usuario abre el ícono viejo tras un download
  que nunca se completó. Desde v1.0.4 esto es detectable: el launcher dice
  "Sunlight <versión>".
- **Manifestación**: gris idéntico cada vez (el build viejo roto repite su fallo).
- **Test discriminador**: ¿el ícono dice "Sunlight 1.0.5"? ¿Settings→Apps?
- **Estado**: usuario reportó reinstalación limpia completa de ambas variantes;
  pendiente confirmación explícita del texto del ícono. Probabilidad residual
  **media-baja** si el protocolo se siguió tal cual, pero es la única capa que
  explica TODAS las rondas anteriores sin necesidad de bugs nuevos.

### A2. Perfil duplicado / Dual apps / work profile
- **Mecanismo**: MIUI App cloner, Samsung Dual Messenger, work profile: el
  package se instala en otro usuario; el ícono del perfil principal lanza un
  stub o la versión del otro perfil.
- **Test**: Settings→Apps → buscar TODAS las entradas "Sunlight"; pestaña
  Work/Dual apps.

### A3. Play Protect bloqueó/deshabilitó post-install
- **Mecanismo**: primer intento bloqueado deja estado persistente; escaneo
  posterior deshabilita la app silenciosamente.
- **Test**: Play Store → avatar → Play Protect → historial; Apps→Sunlight →
  ¿deshabilitada?

### A4. Descarga truncada/corrupta
- **Descartada para v1.0.5** (H4: hash idéntico). Manifestaría siempre como
  "App not installed"/parse error, nunca como gris.

### A5. Restricted settings (Android 13+) para sideloads
- Solo bloquea permisos sensibles posteriores; **no** el arranque. Descartada
  para este síntoma.

---

## CAPA B — Pre-Application (ContentProviders corren ANTES de onCreate)

### B1. `MlKitInitProvider` (vision-camera→MLKit) o `androidx.startup InitializationProvider` (EmojiCompat) colgados
- **Mecanismo**: los ContentProviders se inicializan síncronamente en main
  thread ANTES de `Application.onCreate`. Si MLKit init bloquea (I/O, metadata,
  Play Services), main thread queda colgado **sin ninguna marca nuestra**.
- **Manifestación**: gris eterno, proceso vivo, `native_boot.txt` SIN la marca
  `application-onCreate`.
- **Test discriminador**: presencia/ausencia de esa marca (ver §Tests T2).
- **Probabilidad**: baja-media (no hay reportes genéricos de MLKit colgando en
  A16, pero nadie lo ha descartado en ESTE dispositivo).
- **Evidencia**: manifiesto mergeado contiene ambos providers; agente cadena-nativa paso 1c.

---

## CAPA C — Application.onCreate (nativo)

Marcas existentes: `application-onCreate` → `dynamic-colors-done` →
`react-native-loaded` (MainApplication.kt:39-45).

### C1. `SoLoader.init(ctx, OpenSourceMergedSoMapping)` — IOException → RuntimeException → crash, no gris. Descartado como gris.
### C2. `DefaultNewArchitectureEntryPoint.load()` → `maybeLoadSoLibrary()` hace dlopen de `libreactnative.so` + JNI_OnLoad **en main thread**
- **Mecanismo de hang**: dlopen/JNI_OnLoad bloqueado (lock del linker retenido
  por otra carga concurrente, HAL wedged) → main colgado SIN marca
  `react-native-loaded`.
- **Manifestación**: gris eterno; marca ausente.
- **Probabilidad**: baja (JNI_OnLoad de libreactnative es registro puro).

### C3. DynamicColors.applyToActivitiesIfAvailable — trivial, descartado.

---

## CAPA D — MainActivity / ReactHost / PackageList (main thread)

### D1. Construcción de PackageList (23 packages): constructores triviales verificados uno a uno — sin I/O/binder/loadLibrary. Descartado.
### D2. `HermesInstance()` companion → dlopen `libhermestooling.so` en main — mismo riesgo-hang teórico que C2 (baja).
### D3. `ReactSurfaceView` creada vacía + `setContentView` → **este es el momento exacto donde el GRIS aparece** (windowBackground H6). Todo lo que pase después solo cambia lo que se pinta encima.

---

## CAPA E — ReactInstance creation (bgExecutor, módulos EAGER legacy) ⭐ CAPA MÁS SOSPECHOSA

Mecanismo estructural verificado: `shouldEnableLegacyModuleInterop()==true`
(bridgeless+turboInterop) ⇒ `createNativeModules()` EAGER para todo paquete
legacy durante `ReactInstance.init` (ReactPackageTurboModuleManagerDelegate.kt:61-64).
Legacy packages de este app: **app-auth, biometrics, keychain, linear-gradient
(vacío), vision-camera, SunlightPackage**.

### E1. ⚠️⚠️ vision-camera `CameraViewModule` companion re-lanza `Error`
```kotlin
// CameraViewModule.kt:40-54 (node_modules/react-native-vision-camera)
init { System.loadLibrary("VisionCamera") } // catch(UnsatisfiedLinkError){log; THROW e}
```
- **Mecanismo exacto de gris-eterno-sin-crash (verificado en fuentes RN)**:
  `Task.call` de Bolts captura solo `catch (e: Exception)` (Task.kt:304-338) —
  un `java.lang.Error` escapa al `FutureTask` del executor, que lo guarda como
  outcome y **jamás lo relanza** → el `TaskCompletionSource` nunca completa →
  `BridgelessAtomicRef.getOrCreate` solo captura `RuntimeException`
  (BridgelessAtomicRef.kt:53-72) → estado queda **`Creating` PARA SIEMPRE** →
  cualquier llamador posterior entra en `wait()` **sin timeout** (:75-97) →
  `startSurface` jamás corre → **gris eterno, proceso vivo, cero logs**.
- **Probabilidad**: ALTA — es el único camino encontrado cuyo mecanismo produce
  EXACTAMENTE el síntoma con proceso vivo y sin rastro.
- **Condiciones que disparan el UnsatisfiedLinkError en un device real aunque
  el .so esté alineado**: kernel 16KB con toggles raros (H1 lo hace improbable),
  mapeo de nombres de OpenSourceMergedSoMapping, SELinux/fscrypt del
  filesystem, OOM durante mmap.
- **Fix directo disponible**: excluir vision-camera del autolinking (patrón
  Firebase ya existente en react-native.config.js) + diferir sus imports JS.

### E2. ⚠️ vision-camera `CameraDevicesManager`: binder call síncrono en construcción
- `cameraManager.cameraIdList` (binder a cameraserver) + coroutine
  `ProcessCameraProvider.getInstance(...).await(executor)` lanzada en `init{}`.
- **Issue upstream confirmado (#3586, #3685)**: en RN moderno esta clase crashea
 /cuelga; el maintainer y usuarios aplicaron el patch de mover `init{}` →
  `initialize()`. En Pixel 8/Android 16 hay issue abierto (#3685).
- **Mecanismo de hang**: binder call sin timeout del lado cliente; cameraserver
  wedged (crash previo de cámara, otra app sosteniendo HAL) → bgExecutor
  (UN solo hilo, ReactHostImpl.kt:102) bloqueado para siempre.
- **Probabilidad**: MEDIA-ALTA (coincide con síntoma; device concreto
  desconocido).

### E3. SunlightPackage: RustDownloadModule/AccelModule companions con loadLibrary
- Ambos con guard try/catch(Throwable)+flag ✓ PERO: **si el propio dlopen se
  CUELGA (futex del linker), el catch nunca llega** (agente nativo 6-D).
- Probabilidad: baja (libs propias pequeñas, alineadas, DT_NEEDED satisfechos).

### E4. keychain DataStorePrefsStorage / biometrics / app-auth ctors — triviales, descartados.

### E5. Deadlock TurboModuleManager: segundo hilo espera en `wait()` sin timeout
mientras el primero crea un módulo colgado (TurboModuleManager.kt:244-264) —
amplificador de E1/E2, no causa raíz.

---

## CAPA F — Carga y evaluación del bundle Hermes (JS thread)

Orden real: `loadScript` evalúa el bundle COMPLETO síncronamente en `mqt_v_js`
ANTES de cualquier paint. **No existe timeout en toda la pila** (verificado:
ningún waitFor(timeout) sobre estos tasks).

### F1. ⚠️ executorch: dlopen síncrono de ~33 MB en el JS thread antes del primer frame
- `require('react-native-executorch')` → RnExecutorchModules.ts:23-24 →
  `TurboModuleRegistry.get('ETInstaller')` construye el módulo nativo EN EL
  MISMO call JS → ETInstaller.kt:50-59: `System.loadLibrary("executorch")`
  (22.9 MB) + `System.loadLibrary("react-native-executorch")` (9.9 MB) +
  `initHybrid` (registro JNI masivo) + luego `install()` con
  `injectJSIBindings` (~20 bindings JSI, `isBlockingSynchronousMethod=true`).
- **Hang posible**: dlopen de 33 MB en flash degradada / contención de linker /
  static-initializers C++ — sin lanzar excepción.
- **Si lanza**: contenido por try/catch de index.js → `executorch-skipped` →
  continúa (no gris).
- **Probabilidad**: MEDIA (ventana de riesgo real y grande en el tiempo previo
  al paint).
- **Nota**: nuestro breadcrumb `js-entry` corre ANTES de esto; si en el journal
  del dispositivo `js-entry` existe pero `executorch-init/-skipped` no ⇒
  confirmado colgado aquí.

### F2. ⚠️ worklets/reanimated: deadlock JS↔UI-runtime en arranque bridgeless
- Import estático de App.tsx → worklets `index.js:8 init()` a nivel módulo →
  `installTurboModule()` (crea UI runtime) + `loadUnpackersWithBytecode`
  (compila bytecode Hermes de 6 unpackers) + `installRNBindingsOnUIRuntime`
  usa **`runOnUISync(...)` que BLOQUEA el JS thread hasta que el UI-runtime
  ejecuta** — patrón clásico de deadlock si UI espera algo del JS.
- **checkCppVersion es __DEV__-only** → mismatch JS/C++ en release pasa
  silencioso.
- **Si lanza** (proxy ausente): contenido → BootErrorScreen con wordmark → NO
  coincide. **Si cuelga**: gris sin wordmark → coincide.
- **Probabilidad**: MEDIA-BAJA (deadlock requiere condición de carrera
  específica; pero el costo de descartarlo es bajo: lazy-load de screens).

### F3. ScanDeviceScreen importa vision-camera estáticamente → su código de
módulo ejecuta `installFrameProcessorBindings()` sync durante la eval del grafo
(catch → dummy proxy). Hang improbable pero existe (misma clase F1).

### F4. Resto del grafo estático auditado limpio: secure.ts/biometricGate (ctor
JS puro), firebase 100% lazy, tamagui createTamagui JS puro,
TerminalScreen.requireNativeComponent (lazy factory), VmScreen NativeModules
undefined-safe, llama.rn solo import type.

### F5. Fatal JS post-handler → en release bridgeless el proceso MUERE
(cadena verificada: previousHandler→reportException→ExceptionsManagerModule
LANZA JavascriptException→handleHostException→default {throw it}→crash).
⇒ **El zombie-JS-vivo NO es posible vía throw**: si hubiera un throw JS, la
app cerraría. El gris-eterno REQUIERE colgado (F1/F2/F3) o capa E. Esto reduce
drásticamente el espacio de búsqueda.

---

## CAPA G — Render/mount React (post-eval)

- RootBoundary self-contained atrapa render errors → recovery screen con
  texto. BootErrorScreen idem. Watchdog 8s + failsafe 2400ms cubren promesas
  colgadas y callback perdido. **Capa G exonerada** para gris-sin-texto.

---

## HALLAZGO TRANSVERSAL H9 (anomalía del bundle) — requiere acción

El bundle publicado ≠ rebuild `--reset-cache`:
| Métrica | Bundle en APK v1.0.5 | Rebuild limpio hoy |
|---|---|---|
| Bytes | 6,442,916 | 6,608,099 |
| String `react-native-worklets-core` | ausente | presente |

`react-native-worklets-core` NO está instalado (peer opcional de
vision-camera); Metro marca requires-en-try/catch como opcionales y resuelve a
null. La diferencia de 165 KB sugiere que **la cache de Metro alteró el grafo**
entre builds. Consecuencias posibles: módulos enteros ausentes del bundle →
fallos de runtime impredecibles.

**Acción obligatoria derivada**: publicar SIEMPRE con `--reset-cache`; y
diff-ar el bundle publicado contra uno limpio para listar TODO lo que faltaba.
(Esta anomalía podría incluso explicar el gris por sí sola si un módulo
crítico quedó fuera del grafo empaquetado.)

---

## MATRIZ RESUMEN (causa → mecanismo → manifestación → test)

| # | Causa | Capa | Mecanismo del síntoma | Test discriminador (sin adb) | Prob. |
|---|-------|------|----------------------|------------------------------|-------|
| 1 | Install stale/perfil duplicado | A | Build viejo roto se repite | Texto EXACTO del ícono launcher | Media-baja* |
| 2 | vision-camera Error re-lanzado → ref `Creating` eterna | E1 | Bolts solo catchea Exception; Error escapa → task incompleta para siempre | Excluir vision-camera del autolinking → reinstalar | **Alta** |
| 3 | vision-camera binder hang (cameraIdList/ProcessCameraProvider) | E2 | bgExecutor único hilo bloqueado sin timeout | Ídem + trinidad OEM si Xiaomi | Media-alta |
| 4 | executorch dlopen 33MB colgado en JS thread | F1 | evaluateJavaScript nunca retorna; sin timeout en pila | Comentar initExecutorch en index.js → reinstall | Media |
| 5 | worklets runOnUISync deadlock | F2 | JS thread bloqueado esperando UI runtime | Lazy-load de screens con reanimated/worklets | Media-baja |
| 6 | Bundle incompleto por cache Metro (H9) | F/H9 | Módulo crítico ausente → fallo temprano no cubierto | Publicar --reset-cache y comparar | **Por confirmar** |
| 7 | MLKit/Startup provider colgado pre-onCreate | B | main thread antes de cualquier marca | Ausencia de `application-onCreate` en native_boot.txt | Baja-media |
| 8 | HyperOS/MIUI congela cold-start | A/OEM | Battery/AutoStart manager congela proceso vivo | ¿Marca Xiaomi/HONOR? Autostart ON + sin restricciones | Media-alta SOLO si OEM coincide |
| 9 | Snapshot muerto en Recientes (proceso ya muerto) | OS | Kill silencioso + preview cacheada | Force stop + abrir SIEMPRE desde launcher | Media (falsa-pantalla-gris) |
| 10 | dlopen hang en otros companions (C2/D2/E3) | C/D/E | linker lock futex | Marcas nativas ausentes | Baja |
| 11 | GPU/driver Fabric en build preview A16 | HW | Pipeline render falla silencioso | Dev options→disable HW accel (diagnóstico) | Muy baja |
| 12 | Almacenamiento lleno (<200MB) | Estado | AsyncStorage/SQLite no crea archivos | Settings→Storage | Baja |

\* La probabilidad de #1 baja con cada protocolo cumplido, pero SOLO la
confirmación explícita del texto del ícono la cierra.

---

## TESTS DISCRIMINADORES ORDENADOS POR COSTO

- **T0 (gratis, ya diseñado)**: texto exacto del ícono launcher + Settings→Apps.
- **T1 (gratis)**: ¿marca/modelo del teléfono? (activa/elimina #8 y #12 del
  ranking OEM).
- **T2 (gratis)**: abrir la app, esperar 30 s, cerrarla del todo, volver a
  abrirla → si el splash ahora muestra `last run failed: ...`, el JS CORRIÓ en
  la corrida anterior y el punto de corte queda registrado (bootLog). Si nunca
  aparece, JS nunca corrió ⇒ capas E/F/B.
- **T3 (build A/B)**: v1.0.6 con (a) `--reset-cache`, (b) vision-camera
  excluido del autolinking + imports diferidos, (c) initExecutorch comentado.
  Si arranca → re-habilitar de a uno para identificar el culpable.
- **T4 (si hay PC)**: USB + `adb logcat -s BridgelessReact ReactNativeJS` +
  `kill -3` para thread dump — localiza el hilo bloqueado en minutos.
- **T5 (definitivo, sin PC)**: emulador local repro (rechazado por recursos,
  sigue siendo la vía científica).

---

## CONCLUSIÓN DEL MAPA

El espacio de causas compatibles con «gris total + proceso vivo + APK sano» se
redujo a: **colgados nativos silenciosos en la creación de la instancia
(capas E/F)** — dominados por vision-camera (E1/E2) y executorch (F1) — más la
posibilidad de **bundle incompleto por cache Metro (H9)** y la capa de
instalación (A) que solo el texto del ícono cierra definitivamente.
