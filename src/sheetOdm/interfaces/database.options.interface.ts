import { ModuleMetadata, Type } from '@nestjs/common';

export interface GoogleDriveConfig {
    type: string;
    project_id?: string;
    private_key_id?: string;
    private_key?: string;
    client_email?: string;
    client_id?: string;
    auth_uri?: string;
    token_uri?: string;
    auth_provider_x509_cert_url?: string;
    client_x509_cert_url?: string;
    universe_domain?: string;
}

// Tiempos de estabilidad basados en realidades de red complejas
export const CONNECTION_STABILITY = {
    STABLE: 1500,     // Conexión óptima
    UNSTABLE: 3000,   // Conexión promedio/oscilante
    CRITICAL: 5000    // Conexión muy lenta (Satélite/Radio)
};

export interface DatabaseModuleOptions {
    /** Configuración completa del Service Account de Google (JSON) */
    googleDriveConfig: GoogleDriveConfig;

    /** ID de la carpeta raíz en Drive donde se gestionan los archivos */
    googleDriveBaseFolderId: string;

    /**
     * ID del Spreadsheet principal por defecto. 
     * Opcional si se prefiere inyectar dinámicamente en cada repositorio.
     */
    SPREADSHEET_ID?: string;

    /**
     * Configuración de salud inicial. 
     * Si es true, el HealthCheck se ejecuta al arrancar.
     */
    checkConnectionOnBoot?: boolean;

    /** Tiempo de espera máximo para respuestas de la API de Google (ms) */
    timeout?: number;
    timezone?: string; // Ejemplo: 'America/Lima', 'Asia/Tokyo', 'UTC'
    formatDates?: boolean;
    outboxPollingInterval?: number;
}

// Esta interfaz permite que el módulo reciba una fábrica para cargar opciones asíncronas
export interface DatabaseModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
    useFactory?: (...args: any[]) => Promise<DatabaseModuleOptions> | DatabaseModuleOptions;
    inject?: any[];
    useClass?: Type<DatabaseModuleOptionsFactory>;
    useExisting?: Type<DatabaseModuleOptionsFactory>;
}

// Interfaz auxiliar si se decide usar el patrón de clase para la configuración
export interface DatabaseModuleOptionsFactory {
    createDatabaseOptions(): Promise<DatabaseModuleOptions> | DatabaseModuleOptions;
}
