import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { TransactionInterceptor } from '@sheetOdm/core/interceptors/TransactionInterceptor.js';


export function Transactional() {
  return applyDecorators(
    UseInterceptors(TransactionInterceptor)
  );
}