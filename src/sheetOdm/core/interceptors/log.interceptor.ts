// log.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { CustomLoggerService } from '@sheetOdm/services/logger.service.js';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';


@Injectable()
export class LogInterceptor implements NestInterceptor {
    constructor(private readonly logger: CustomLoggerService) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle().pipe(
            tap((data) => {
                // Si el controlador devolvió un log, lo inyectamos en la respuesta final
                if (data && data.log) {
                    // El cliente recibirá { data: ..., log: ... }
                }
            }),
        );
    }
}