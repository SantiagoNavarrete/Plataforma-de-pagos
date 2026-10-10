# Boleta

Plataforma de compra de boletos para eventos en México. La primera etapa incluye una experiencia de catálogo y páginas de eventos adaptable a celulares, con información de demostración.

## Requisitos

- Node.js 20.9 o posterior
- npm
- Docker Desktop (para la base local de PostgreSQL)

## Ejecutar localmente

Para explorar la interfaz y el catálogo de demostración:

```powershell
npm install
npm run dev
```

Para activar PostgreSQL y probar también `GET /api/eventos`, prepara la base:

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d postgres
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed
npm run dev
```

Visita [http://localhost:3000](http://localhost:3000). Los comandos de base de datos requieren Docker Desktop, PostgreSQL disponible y `DATABASE_URL` en `.env`. `npm run db:seed` carga `.env` automáticamente; para que apunte a Supabase, reemplaza los valores locales de `DATABASE_URL` y `DIRECT_URL` por las cadenas de conexión del proyecto.
Al desplegar en Vercel, selecciona como **Root Directory** la carpeta del proyecto (la que contiene `package.json`, `prisma/` y `vercel.json`). Para usar Supabase como PostgreSQL, abre **Connect** en el panel del proyecto y configura `DATABASE_URL` con la cadena **Transaction pooler** (puerto 6543) para las funciones de Vercel; conserva los parámetros `pgbouncer=true`, `connection_limit=1` y `sslmode=require`. Configura `DIRECT_URL` con la cadena **Session pooler** o **Direct connection** para migraciones (si el entorno no tiene IPv6, usa Session pooler). Usa la contraseña de la base de datos de Supabase, no la publishable key de la API. Añade ambas variables en Vercel y en el entorno local; no las publiques ni las guardes en Git.

Con esas variables configuradas, ejecuta `npx prisma migrate deploy` para aplicar las migraciones y `npm run db:seed` una sola vez para cargar el catálogo de demostración. El proyecto sigue usando Prisma para la base y Better Auth para cuentas; no necesita `@supabase/supabase-js`, `@supabase/ssr`, la URL pública ni la publishable key para este flujo.

Para habilitar registro e inicio de sesión, configura `AUTH_SECRET` (aleatorio, al menos 32 bytes), `APP_URL` y las variables SMTP del correo de verificación. `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` son opcionales; el URI de retorno autorizado en Google es `${APP_URL}/api/auth/callback/google`. Sin la configuración de autenticación se conserva la compra como invitado, pero las funciones de cuenta y administración responden como no configuradas.

## Comandos

```bash
npm run lint
npm run build
npm start
npm run db:validate
```

## Estructura inicial

```text
src/
  app/
    api/eventos/route.ts      # API pública para consultar eventos publicados
    api/admin/                # Sesión, recintos, eventos, reportes y CSV
    api/auth/[...all]/        # Autenticación, verificación de correo y sesiones
    api/reservas/             # Reserva, consulta, pago y cancelación transaccionales
    api/pagos/webhook/        # Recepción de notificaciones firmadas
    api/validar/route.ts      # Validación atómica y de un solo uso
    api/cron/ticket-emails/   # Reintento autenticado de correos pendientes
    checkout/[orderNumber]/   # Resumen del pedido y cuenta regresiva
    admin/                    # Consola administrativa protegida
    cuenta/                   # Registro, acceso e historial de compras
    mis-boletos/[orderNumber] # Boletos protegidos con enlace de acceso
    validar/                  # Escáner de QR para el personal
    eventos/[slug]/page.tsx   # Ficha de evento
    globals.css               # Estilos responsive
    layout.tsx                # Layout y metadatos
    page.tsx                  # Catálogo
  components/
    event-explorer.tsx        # Búsqueda y filtros interactivos
    event-ticket-panel.tsx    # Selección de boletos y reserva temporal
    checkout-summary.tsx      # Totales, vencimiento y cancelación
    ticket-validator.tsx      # Escáner de cámara y validación manual
  lib/
    auth.ts                   # Better Auth, Google OAuth, correo y roles
    events.ts                 # Datos de demostración y formato MXN
    mercado-pago.ts           # Cliente REST, firma y validación de respuestas
    prisma.ts                 # Cliente PostgreSQL reutilizable
    tickets.ts                # QR firmados, acceso de cliente y emisión idempotente
    ticket-emails.ts          # Correo SMTP y cola de reintentos
prisma/
  schema.prisma               # Modelo de usuarios, eventos y transacciones
  migrations/                 # Migraciones PostgreSQL versionadas
  seed.ts                     # Catálogo inicial de demostración
docker-compose.yml            # PostgreSQL local
```

## Etapas del producto

1. Catálogo responsive, búsqueda, filtros y ficha de evento (implementado con datos de demostración).
2. PostgreSQL, Prisma y API pública del catálogo (implementado; semilla demostrativa).
3. Reservas transaccionales de 10 minutos, límite de ocho boletos por correo y checkout con IVA visible (implementado).
4. Mercado Pago Checkout Pro, retorno, estados y webhook firmado/idempotente (implementado; requiere credenciales para probar cargos).
5. Emisión de boletos digitales, correo y validación de acceso de un solo uso (implementado).
6. Panel de administración, exportación e informes (implementado).
7. Autenticación individual y compras vinculadas (implementado); solicitud y descarga de CFDI 4.0 vía Facturama API Web (implementado; requiere configuración y pruebas con la cuenta emisora). Documentos legales y preparación final de despliegue siguen pendientes.

`GET /api/eventos` consulta eventos, zonas, precios y disponibilidad de PostgreSQL. El contenido editorial y las tarjetas del inicio parten de la muestra de `src/lib/events.ts`; las páginas de evento sincronizan los precios y el inventario antes de permitir una reserva. Una reserva aplica una actualización atómica del inventario dentro de una transacción, dura 10 minutos, limita a ocho boletos por correo y libera cantidades al cancelar o vencer. El cargo de servicio es $0 MXN por decisión inicial; el checkout muestra boletos, IVA de 16% y total.

## Mercado Pago (Checkout Pro)

Configura `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `MERCADO_PAGO_CHECKOUT_MODE` y `APP_URL` como variables de entorno del servidor (por ejemplo, en `.env` local y en las variables del despliegue). Para pagos de muestra en Vercel, establece `MERCADO_PAGO_CHECKOUT_MODE=sandbox` y usa credenciales de prueba de Mercado Pago; el modo sandbox selecciona `sandbox_init_point` también cuando Next.js corre en producción. Para cobrar realmente, establece `MERCADO_PAGO_CHECKOUT_MODE=production` y usa credenciales productivas. Configura la URL pública HTTPS `/api/pagos/webhook` en Mercado Pago. Checkout Pro conserva los datos de tarjeta en la pasarela; el servidor solo crea preferencias y verifica el pago consultando el recurso firmado.

La preferencia excluye efectivo (`ticket`) y transferencia (`bank_transfer`) porque se eligió una reserva de inventario de 10 minutos. Acepta los medios en línea que habilite la cuenta de Mercado Pago; solicita hasta 12 mensualidades cuando la tarjeta y la cuenta sean elegibles. Disponibilidad de MSI, 3D Secure y billetera depende del proveedor, emisor y configuración del comercio. PayPal y las integraciones independientes de Apple Pay/Google Pay aún no están conectadas.

El webhook valida `x-signature`, reconsulta el pago con credenciales del servidor y compara referencia, MXN e importe antes de modificar la orden. Los avisos duplicados se deduplican. Si una autorización aprobada llega tras vencer la reserva, el servidor solicita un reembolso idempotente en lugar de asignar inventario ya liberado.

La integración necesita credenciales y una base de datos reales para completar su prueba de extremo a extremo. No se cobran pagos durante el build, y nunca se almacenan datos de tarjeta en PostgreSQL.

## CFDI 4.0 (Facturama API Web)

La página protegida de boletos permite solicitar una factura después de que el pago está confirmado. El formulario solicita RFC, nombre fiscal, régimen fiscal, código postal y uso de CFDI; las descargas PDF/XML pasan por el servidor y requieren la sesión propietaria o el enlace privado de acceso de la orden. El estado queda auditado. Una orden solo admite un CFDI; únicamente errores HTTP de rechazo explícito de Facturama permiten corregir datos y reintentar. Ante timeout, respuesta ambigua o fallo al guardar un CFDI emitido, se bloquea el reintento automático y se requiere conciliación manual.

Configura las siguientes variables en `.env` y en el entorno del despliegue. No compartas ni publiques las credenciales:

- `FACTURAMA_ENVIRONMENT`: `sandbox` o `production` (el valor de ejemplo es sandbox).
- `FACTURAMA_USER` y `FACTURAMA_PASSWORD`: credenciales de API Web de Facturama, separadas de las credenciales de la cuenta emisora.
- `FACTURAMA_NAME_ID`, `FACTURAMA_EXPEDITION_PLACE`, `FACTURAMA_PRODUCT_CODE`, `FACTURAMA_UNIT_CODE`, `FACTURAMA_UNIT` y opcionalmente `FACTURAMA_SERIE`: valores de catálogo/configuración de tu emisor Facturama y del producto. No uses valores de ejemplo en producción.
- `FACTURAMA_PAYMENT_FORM_CREDIT_CARD`, `FACTURAMA_PAYMENT_FORM_DEBIT_CARD` y `FACTURAMA_PAYMENT_FORM_WALLET`: clave de forma de pago SAT correspondiente al medio realmente confirmado por Mercado Pago. Si no se configura una clave para ese medio, la emisión se detiene antes de contactar al proveedor.

Solicita los valores fiscales al emisor y valídalos con su contador; no infieras claves SAT ni actives producción antes de confirmar que la descripción, clave de producto/servicio, unidad, régimen, uso de CFDI, forma de pago y tratamiento del IVA aplican a la operación. El esquema actual calcula IVA de 16% en boletos y no incluye cargo de servicio; requiere validación fiscal antes de emitir comprobantes reales. El endpoint API Web utilizado es `POST /3/cfdis`; los documentos se recuperan con las rutas autenticadas de PDF/XML. Aún se necesita probar el flujo completo con credenciales sandbox y una base PostgreSQL real.

## Boletos digitales y acceso

Al confirmar el pago, la misma transacción que confirma la orden emite un QR único por boleto y crea un registro de entrega idempotente. El QR contiene un identificador firmado con HMAC; la base de datos conserva solo su hash. Se manda el QR adjunto y un enlace de acceso seguro al correo comprador. El enlace permite ver los boletos sin cuenta; no compartas el enlace. Desde “Mis boletos” se puede imprimir o guardar la página como PDF.

Configura estas variables del servidor en `.env` y en el hosting:

- `TICKET_QR_SECRET`: secreto aleatorio de al menos 32 bytes. Debe permanecer estable; cambiarlo invalida los QR y enlaces ya emitidos.
- `TICKET_VALIDATION_SECRET`: clave aleatoria de al menos 32 bytes para autorizar al personal en `/validar`. No la expongas en el código cliente ni la compartas con compradores.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`: conexión SMTP del proveedor de correo.
- `CRON_SECRET`: secreto aleatorio de al menos 32 bytes para proteger `/api/cron/ticket-emails`.

Puedes crear secretos localmente con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Repite el comando para obtener una clave distinta para cada variable. El cron incluido se ejecuta una vez al día a las 09:00 UTC (Vercel Hobby puede demorarlo hasta 59 minutos); los correos fallidos pueden tardar hasta un día en reintentarse. Vercel Hobby solo permite ejecuciones de cron diarias; para conservar reintentos cada cinco minutos se necesita un plan compatible o un programador externo. El endpoint acepta solicitudes `GET` o `POST` con `Authorization: Bearer <CRON_SECRET>`.

Después de diez intentos fallidos, una entrega queda en estado `FAILED` para revisión; tras corregir SMTP, un operador puede reencolarla desde PostgreSQL con `UPDATE "TicketEmailDelivery" SET "status" = 'PENDING', "attempts" = 0, "lastError" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = '<id>' AND "status" = 'FAILED';`.

En `/validar`, el personal introduce la clave compartida y escanea el QR con la cámara (requiere HTTPS, excepto en `localhost`) o pega el contenido manualmente. La API vuelve a comprobar la firma y el estado de la orden y marca el boleto usado mediante una actualización atómica; dos escaneos simultáneos no pueden aceptar el mismo boleto. La clave del validador sigue siendo compartida y se debe migrar a cuentas de staff antes de operar un evento en producción.

## Administración y reportes

En `/cuenta`, crea una cuenta con correo y contraseña; el correo debe verificarse antes del acceso. Google está disponible si configuras sus credenciales OAuth. Better Auth mantiene sesiones en PostgreSQL y aplica límite de solicitudes persistente. Al reservar con una sesión activa, la orden queda vinculada a la cuenta y aparece en `/cuenta/compras`; las órdenes de invitado siguen disponibles mediante su enlace privado de correo.

El rol de administración no se puede elegir desde el registro público. Para habilitar a una persona después de verificar su cuenta, ejecuta esta operación desde un canal administrativo seguro de PostgreSQL, sustituyendo el correo:

```sql
UPDATE "User" SET "role" = 'admin' WHERE lower("email") = lower('admin@tu-dominio.mx');
```

Las APIs administrativas verifican la sesión individual y el rol en el servidor; las escrituras también validan el encabezado `Origin` contra `APP_URL`. El secreto compartido temporal del panel se eliminó.

El panel crea recintos y eventos con zonas/precios, cambia el estado de eventos y actualiza precios e inventario. El inventario no se puede reducir por debajo de boletos vendidos o reservados; cada cambio administrativo y exportación queda en `AuditLog`. Cancelar un evento bloquea accesos y marca los boletos sin usar como cancelados, pero no inicia reembolsos automáticamente: deben tramitarse por separado conforme a la política aplicable.

Los reportes agrupan ventas por día de Ciudad de México y aceptan periodos de hasta 366 días. La exportación CSV incluye órdenes pagadas y reembolsadas, escapa valores de celdas para evitar fórmulas de hoja de cálculo y rechaza periodos que excedan 50,000 órdenes. Los reembolsos parciales se identifican por estado, pero su importe no se reporta porque no se persiste actualmente.
