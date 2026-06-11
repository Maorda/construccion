//Cualquier cosa que no exportes en este archivo se considerará "privada"
// y el desarrollador no podrá importarla, protegiendo así tus motores internos (QueryEngine, PipelineOrchestrator, etc.).
// 1. Constantes
export * from './constants/metadata.constants.js';

// 2. Decoradores
export * from './decorators/table.decorator.js';
export * from './decorators/column.decorator.js';
export * from './decorators/primarykey.decorator.js';
export * from './decorators/subcollection.decorator.js';

// 3. Interfaces y Tipos
export * from './interfaces/database.options.interface.js';
export * from './types/query.types.js';

// 4. Servicios
export * from './services/auth.google.service.js';
export * from './services/google-health.service.js';
export * from './services/database-config.service.js';
export * from './services/metadata-registry.service.js';

// 5. Repositorio, Fábrica e Hydration Wrappers
export * from './repository/sheets.repository.js';
export * from './repository/sheets-repository.factory.js';
export * from './repository/create-model.js';


// 6. Estrategia de Nombres
export * from './strategy/naming.strategy.js';

// 7. Motores de Consulta
export * from './engines/projection.service.js';

export * from './engines/mutationEngine.js';

