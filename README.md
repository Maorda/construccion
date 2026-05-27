Plan de Acción y Diseño Definitivo: Google Sheets ODM
Este plan de acción consolida la arquitectura del Google Sheets ODM integrando el código y servicios avanzados que ya has completado, y detalla la implementación de las piezas faltantes necesarias para lograr un ecosistema 100% operativo, dinámico y robusto en NestJS.

🏗️ Estado Actual & Componentes Listos
Has desarrollado los cimientos más complejos y sofisticados del sistema:

Decoradores de Metadatos: @Table (con pluralización inteligente), @Column (con listas posicionales de columnas y soporte para borrado lógico y autoincremento), @PrimaryKey (identidad única) y @SubCollection (resolución diferida de relaciones para evitar referencias circulares).
Constantes del ODM: Symbols para evitar colisiones accidentales de metadatos.
MetadataRegistry: Servicio NestJS capaz de leer metadatos jerárquicos profundos y mapeos posicionales de columnas.
GoogleAutenticarService: Servicio asíncrono optimizado con getters perezosos.
GoogleHealthService: Validador de estabilidad de red con reintentos para asegurar que la hoja esté en línea.
DatabaseConfigService: Servicio de ciclo de vida (OnModuleInit) que descubre automáticamente todos los repositorios decorados y los inicializa al arrancar la aplicación.
🛠️ Plan de Implementación de los Componentes Faltantes
Para que todo el sistema empiece a funcionar de inmediato, implementaremos las siguientes piezas:

1. Interfaces de Opciones (src/sheetOdm/interfaces/database.options.interface.ts)
Definiremos los tipos necesarios para la configuración del módulo NestJS:

GoogleDriveConfig: Credenciales de cuenta de servicio de Google.
DatabaseModuleOptions: Configuración del Spreadsheet, carpeta base, zona horaria y estabilidad de conexión.
DatabaseModuleAsyncOptions: Opciones dinámicas para inyectar con ConfigService.
2. Estrategia de Nombres (src/sheetOdm/strategy/naming.strategy.ts)
Implementar NamingStrategy.formatSheetName(className: string): string que replique la lógica de pluralización predictiva de @Table para que la inicialización por defecto coincida plenamente.
Implementar NamingStrategy.formatColumnName(propName: string): string (convierte a mayúsculas y limpia caracteres).
3. El Repositorio Base (src/sheetOdm/repository/sheets.repository.ts)
Es el corazón de persistencia. Cada repositorio representará una entidad específica y contendrá:

La propiedad __isSheetsRepository = true (Symbol SHEETS_REPOSITORY_MARKER) para que el DatabaseConfigService lo detecte.
async initialize(sheetName: string): Promise<void>:
Obtiene el listado de pestañas del documento a través de GoogleAutenticarService.
Si la pestaña (ej. OBREROS) no existe: La crea mediante la API de Sheets y escribe los encabezados de las columnas (leídos de MetadataRegistry) en MAYÚSCULAS en la primera fila.
Si ya existe: Obtiene la primera fila actual, compara con los campos definidos en la clase TypeScript, y si hay columnas nuevas, las añade al final del encabezado (Auto-Migración).
Operaciones CRUD:
find(filter?): Descarga los renglones, descarta los eliminados lógicamente (leyendo getDeleteControlProperty), los transforma a instancias de clase mediante el mapa posicional e indexa por nombre de propiedad, aplicando filtros.
findById(id): Busca la fila cuyo valor en la columna primaria coincida con el ID y la devuelve hidratada.
create(data):
Valida con Joi de forma dinámica (generando un esquema a partir de ColumnOptions).
Genera la PK (uuid o increment según @Column).
Traduce el objeto a un array plano posicional según getColumnMap y lo inserta en Sheets.
update(id, data): Localiza la fila, valida el delta con Joi, actualiza la celda correspondiente y refresca la persistencia.
delete(id): Si se configuró Soft Delete, cambia la columna de control a true. Si no, limpia físicamente el renglón.
populate(entity, relationField): Carga recursivamente los hijos/relaciones indicados leyendo las opciones de @SubCollection.
4. Fábrica de Repositorios y Creador de Modelos (SheetsRepositoryFactory & createModel)
SheetsRepositoryFactory:
Fábrica inyectable que construye dinámicamente instancias de SheetsRepository<T> para una clase de entidad.
createModel(Entity, repository):
Para emular la inyección tipo Mongoose y que puedas inyectar la clase directamente (constructor(private readonly obreroModel: ObreroEntity)), createModel devolverá un Proxy de JavaScript que intercepta las llamadas hacia la clase y las redirige hacia los métodos de su repositorio correspondiente. ¡Esto hace que la inyección sea sumamente limpia, fluida y transparente!
5. Motores de Consulta (QueryEngine y afines)
Implementaremos un motor básico e inteligente en src/sheetOdm/engines/query.engine.ts que interprete filtros JSON (ej. { edad: 30, cargo: 'CAPATAZ' }) y soporte comparaciones sencillas para que tus repositorios tengan un motor de consultas funcional desde el día uno.
📂 Archivos a Crear y Modificar
Crearemos los archivos ordenados en sus respectivas carpetas bajo src/sheetOdm/:


src/sheetOdm/
├── constants/
│   └── metadata.constants.ts               # [NEW] Las constantes Symbols unificadas
├── decorators/
│   ├── column.decorator.ts                 # [NEW] Decorador @Column
│   ├── primarykey.decorator.ts             # [NEW] Decorador @PrimaryKey y Helper
│   ├── subcollection.decorator.ts          # [NEW] Decorador @SubCollection
│   └── table.decorator.ts                  # [NEW] Decorador @Table
├── interfaces/
│   └── database.options.interface.ts       # [NEW] Interfaces de configuración
├── strategy/
│   └── naming.strategy.ts                  # [NEW] Estrategia de nombres y pluralización
├── services/
│   ├── auth.google.service.ts              # [NEW] GoogleAutenticarService
│   ├── google-health.service.ts            # [NEW] GoogleHealthService
│   ├── database-config.service.ts          # [NEW] DatabaseConfigService
│   └── metadata-registry.service.ts        # [NEW] MetadataRegistry
├── repository/
│   ├── sheets.repository.ts                # [NEW] BaseRepository / SheetsRepository
│   ├── sheets-repository.factory.ts        # [NEW] SheetsRepositoryFactory
│   └── create-model.ts                     # [NEW] Creador de Modelos (Proxy Wrapper)
├── engines/
│   └── query.engine.ts                     # [NEW] QueryEngine para filtrados de registros
├── odm-sheet.module.ts                     # [NEW] OdmSheetModule unificado
└── index.ts                                # [NEW] Exportaciones globales del ODM
🎯 Plan de Verificación
Compilación Limpia: Nos aseguraremos de que todo el ODM y sus decoradores compilen perfectamente en TypeScript.
Levantamiento del Servidor: Integraremos el módulo en AppModule y arrancaremos el servidor para verificar que el DiscoveryService y el DatabaseConfigService descubren e inicializan de forma exitosa los repositorios a través de onModuleInit, realizando las migraciones de pestañas necesarias.
IMPORTANT

Aprobación Requerida: Este plan unifica tus componentes completados y diseña los faltantes. ¿Me das tu aprobación para comenzar con la creación de los archivos y la codificación de la base para poner todo en marcha?