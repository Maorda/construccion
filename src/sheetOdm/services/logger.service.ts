// logger.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode, ErrorDictionary, LogLevel } from '@sheetOdm/core/interfaces/logger.types.js';

export interface FrontendLog {
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    context?: any;
    traceId?: string; // Muy útil para rastrear peticiones en Fly/Render
    code: ErrorCode;
    details?: any;
    action: string; // 🔥 Nueva propiedad sugerida por ti
    linkToDocs?: string;
}

@Injectable()
export class CustomLoggerService extends Logger {

    public createResponse(level: LogLevel, code: ErrorCode, details?: any): FrontendLog {
        const def = ErrorDictionary[code] || {
            message: 'Error inesperado',
            action: 'Contacta a soporte.'
        };

        return {
            timestamp: new Date().toISOString(),
            level,
            code,
            message: def.message,
            action: def.action,
            linkToDocs: def.linkToDocs, // Se añade la URL si existe
            details,
        };
    }
}