# Integration Platform Monorepo

Plataforma de integración multi-cliente construida en TypeScript y estructurada como monorepo con npm workspaces. La solución separa responsabilidades entre dominio, adaptadores, funciones serverless y IaC basada en AWS CDK.

## Estructura
- `libs/domain`: modelos de dominio, puertos y casos de uso (detección y procesamiento) desacoplados de infraestructura.
- `libs/adapters`: adaptadores para fuentes Mongo/FTP/API, cliente HTTP hacia el SaaS, repositorios Mongo para configuración y bitácoras, rate limiter y métricas.
- `libs/observability`: logger estructurado con `pino`.
- `funcs/orchestrator`: Lambda disparada por EventBridge para detectar expediciones, consultar pendientes en el SaaS y encolar mensajes con prioridad en SQS.
- `funcs/processor`: Lambda consumidora de SQS que resuelve el adaptador adecuado, aplica el mapping de estados, actualiza el SaaS y persiste bitácoras en Mongo del cliente.
- `infra/cdk-app`: definición de colas (prioridad y estándar) con DLQ, Lambdas y scheduler, exponiendo variables de entorno para las URLs de ambas colas y el acceso al SaaS.

## Principios clave
- **SOLID / DIP**: la lógica de negocio depende de puertos definidos en `libs/domain`. Los adaptadores proveen implementaciones concretas.
- **Escalabilidad y prioridad**: uso de colas separadas por prioridad y límites por ventana configurable en el dominio y rate limiter.
- **Trazabilidad**: bitácoras en MongoDB por cliente y métricas listas para CloudWatch.
- **Configurabilidad**: variables de entorno para secretos y URIs; la configuración de integraciones se obtiene desde la base Mongo central.

## Próximos pasos sugeridos
- Incorporar CI/CD y validaciones (lint/tests) en pipelines.
- Completar implementación real de repositorio de expediciones pendientes contra el SaaS.
- Añadir autenticación y renovación de tokens para fuentes API con OAuth2/JWT.
- Definir alarmas de CloudWatch y dashboards por cliente e integración.
