# Configuración de OAuth para Sunlight (Google / GitHub / GitLab)

La app inicia sesión con proveedores usando PKCE en el dispositivo y luego
cambia el token del proveedor por una key `moud_` en la consola
(`POST /api/auth/mobile/oauth`). **No se usan client secrets en la app**:
los bundles móviles son públicos.

## 1. Dónde van los client IDs

Editá `src/oauthConfig.ts`:

```ts
export const GOOGLE_CLIENT_ID = '<tu-id>.apps.googleusercontent.com';
export const GITHUB_CLIENT_ID = '<tu-id>';
export const GITLAB_CLIENT_ID = '<tu-id>';
```

Mientras un ID esté vacío, su botón queda deshabilitado con el hint
"faltan client IDs de OAuth".

## 2. Redirect URIs por proveedor

Cada proveedor usa un redirect URI diferente:

| Proveedor | Redirect URI | Scheme |
|---|---|---|
| **Google** | `com.googleusercontent.apps.<GUID>:/oauth2redirect/google` | Reversed client ID |
| **GitHub** | `com.moud.sunlight://auth` | App scheme |
| **GitLab** | `com.moud.sunlight://auth` | App scheme |

Google **no acepta** schemes custom arbitrarios — usa el client ID invertido
como scheme. Esto es manejado automáticamente por `src/oauthConfig.ts`
(`googleRedirectUrl()`).

## 3. Google Cloud Console (paso a paso)

**URL:** https://console.cloud.google.com/apis/credentials

### 3a. Consent screen (si no lo configuraste)

1. APIs & Services → OAuth consent screen → User type: **External**
2. App name: `Sunlight`
3. Scopes: agregá `openid`, `email`, `profile`
4. Test users: agregá tu email mientras estés en "Testing"
5. Publish app cuando estés listo para producción

### 3b. Crear client ID para Android

1. Credentials → Create credentials → OAuth client ID
2. Application type: **Android**
3. Name: `Sunlight Android`
4. Package name: `com.moud.sunlight`
5. SHA-1 certificate fingerprint:
   ```bash
   # Debug keystore (para desarrollo):
   keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android 2>/dev/null | grep SHA1
   
   # Release keystore (para producción):
   keytool -list -v -keystore <tu-keystore> -alias <tu-alias> | grep SHA1
   ```
6. Create → **copiá el Client ID** (formato: `XXXX.apps.googleusercontent.com`)

### 3c. Crear client ID para iOS

1. Credentials → Create credentials → OAuth client ID
2. Application type: **iOS**
3. Name: `Sunlight iOS`
4. Bundle ID: el de `ios/Sunlight/Info.plist` → `CFBundleIdentifier`
   (ej: `com.moud.sunlight`)
5. Create → **copiá el Client ID** (puede ser diferente al de Android)

### 3d. Usar el client ID

Usá el client ID de **Android** (o el que tengas) en `src/oauthConfig.ts`:

```ts
export const GOOGLE_CLIENT_ID = 'XXXX.apps.googleusercontent.com';
```

El redirect URL se deriva automáticamente:
`com.googleusercontent.apps.XXXX:/oauth2redirect/google`

### 3e. Android: actualizar appAuthRedirectScheme

Después de crear el client ID de Android, actualizá `android/app/build.gradle`:

```gradle
manifestPlaceholders += [
  appAuthRedirectScheme: "com.googleusercontent.apps.XXXX"
]
```

Reemplazá `XXXX` con el GUID de tu client ID (la parte antes de
`.apps.googleusercontent.com`).

**Nota:** Si usás tanto Google como GitHub/GitLab, necesitás registrar AMBOS
schemes. Agregá un intent-filter adicional en
`android/app/src/main/AndroidManifest.xml` dentro del `<activity>`:

```xml
<!-- Google OAuth redirect -->
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data
        android:scheme="com.googleusercontent.apps.XXXX"
        android:host="oauth2redirect"
        android:path="/google" />
</intent-filter>
```

Y dejá `appAuthRedirectScheme: "com.moud.sunlight"` en build.gradle para
GitHub/GitLab.

## 4. GitHub (Developer settings → OAuth Apps)

**URL:** https://github.com/settings/developers

1. OAuth Apps → New OAuth App
2. Campos:
   - Application name: `Sunlight`
   - Homepage URL: `https://mound.opceanai.com`
   - Authorization callback URL: `com.moud.sunlight://auth`
3. Register application
4. **Copiá el Client ID** (formato: `Iv1.xxxxxxxx`)
5. **NO necesitás el Client Secret** — la app usa PKCE + intercambio
   server-side en la consola

```ts
export const GITHUB_CLIENT_ID = 'Iv1.xxxxxxxx';
```

Scopes pedidos: `read:user`, `user:email`.

## 5. GitLab

**URL:** https://gitlab.com/-/user_settings/applications

1. New application
2. Campos:
   - Name: `Sunlight`
   - Redirect URI: `com.moud.sunlight://auth`
   - Confidential: **NO** (la app es pública, usa PKCE)
   - Scopes: `read_user`, `email`
3. Save application
4. **Copiá el Application ID**

```ts
export const GITLAB_CLIENT_ID = 'abc123def456...';
```

## 6. Como funciona el intercambio

1. La app inicia la autorizacion PKCE y redirige al proveedor correspondiente.
2. La app envia `POST /api/auth/mobile/oauth {provider, access_token}` a la consola Moud.
3. La consola verifica el token contra el proveedor y responde `{api_key, key_id, subject}`.

El subject resultante (`g:<sub>` / `gh:<id>` / `gl:<id>`) es dueno de las
keys de dispositivo; las vas a ver en `/device` de la consola.

## 7. Troubleshooting

| Error | Causa probable |
|---|---|
| `redirect_uri_mismatch` (Google) | No creaste un client ID tipo Android/iOS, o el SHA-1/bundle ID no coincide |
| `Custom URI scheme is not supported` (Google) | Estás usando un client tipo Web — necesitás Android/iOS |
| `invalid_client` (GitLab) | App marcada como Confidential — recreá como Public |
| La app no abre después del redirect | Falta rebuild nativo (los schemes están en Info.plist/AndroidManifest) |
| `oauth_invalid` al intercambiar | Token vencido o scope incorrecto — reintentá |
| Botón deshabilitado | Client ID vacío en `src/oauthConfig.ts` |

## 8. Checklist de release

- [ ] Google: client ID Android creado (con SHA-1 correcto)
- [ ] Google: client ID iOS creado (con Bundle ID correcto)
- [ ] Google: `appAuthRedirectScheme` actualizado en build.gradle
- [ ] Google: intent-filter adicional en AndroidManifest.xml (si usás ambos schemes)
- [ ] GitHub: OAuth App creado con callback `com.moud.sunlight://auth`
- [ ] GitLab: Application creada como Public con redirect `com.moud.sunlight://auth`
- [ ] Los 3 IDs pegados en `src/oauthConfig.ts`
- [ ] `npx tsc --noEmit` pasa
- [ ] Build nativo fresco (pod install / gradle)
- [ ] Login probado en dispositivo real con cada proveedor
