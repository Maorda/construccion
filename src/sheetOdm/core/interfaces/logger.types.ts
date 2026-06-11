// logger.types.ts

export enum LogLevel {
    INFO = 'info',
    WARN = 'warn',
    ERROR = 'error',
}

export enum ErrorCode {
    DATABASE_CONNECTION = 'ERR_DB_CONN',
    OUTBOX_SAVE_FAILED = 'ERR_OUTBOX_SAVE',
    SHEET_API_ERROR = 'ERR_SHEET_API',
    VALIDATION_ERROR = 'ERR_VALIDATION',
    UNKNOWN = 'ERR_UNKNOWN',
}

interface ErrorDefinition {
    message: string;
    action: string;
    linkToDocs?: string; // 🔥 Nueva propiedad para autoservicio
}

export const ErrorDictionary: Record<ErrorCode, ErrorDefinition> = {
    [ErrorCode.DATABASE_CONNECTION]: {
        message: 'No se pudo conectar con el servidor de base de datos.',
        action: 'Verifica que la base de datos esté encendida.',
        linkToDocs: 'https://docs.sheetodm.com/troubleshooting/db-connection',
    },
    [ErrorCode.OUTBOX_SAVE_FAILED]: {
        message: 'No pudimos registrar tu operación correctamente.',
        action: 'Asegúrate de que el documento cumpla con el esquema requerido.',
        linkToDocs: 'https://docs.sheetodm.com/guides/outbox-usage',
    },
    [ErrorCode.SHEET_API_ERROR]: {
        message: 'Error en la sincronización con la hoja de cálculo.',
        action: 'Revisa tus credenciales de Google Sheets.',
        linkToDocs: 'https://docs.sheetodm.com/setup/google-auth',
    },
    [ErrorCode.VALIDATION_ERROR]: {
        message: 'Los datos proporcionados no son válidos.',
        action: 'Corrige los campos indicados en el formulario.',
        linkToDocs: 'https://docs.sheetodm.com/validation-rules',
    },
    [ErrorCode.UNKNOWN]: undefined
};