import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Scope
} from '@nestjs/common';
import { UnitOfWork } from '@sheetOdm/services/UnitOfWork.js';
import { Observable, catchError, tap, throwError } from 'rxjs';

// ⚠️ IMPORTANTE: Debe ser REQUEST scope para obtener la instancia correcta del UOW
@Injectable({ scope: Scope.REQUEST })
export class TransactionInterceptor implements NestInterceptor {
  constructor(private readonly uow: UnitOfWork) { }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    // Iniciamos la transacción automáticamente
    this.uow.startTransaction();

    return next.handle().pipe(
      tap(async () => {
        // commit() será nuestra futura conexión con el Outbox
        await this.uow.commit();
      }),
      catchError((err) => {
        this.uow.rollback();
        return throwError(() => err);
      }),
    );
  }
}